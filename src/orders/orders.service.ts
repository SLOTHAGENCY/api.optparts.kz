import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import {
  DeliveryType,
  DeliveryTypeLabel,
  Order,
  OrderStatus,
  OrderStatusLabel,
} from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { SupplierOrder } from './entities/supplier-order.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { RequestReturnDto } from './dto/request-return.dto';
import { ResolveAttemptDto } from './dto/resolve-attempt.dto';
import {
  CART_CHECKOUT,
  CartCheckoutContract,
  CheckoutItem,
} from './cart-checkout.contract';
import { SuppliersRegistry } from '../suppliers/suppliers.registry';
import { PartnerProductsService } from '../partner-products/partner-products.service';
import { AddressesService } from '../addresses/addresses.service';
import { SettingsService } from '../settings/settings.service';
import {
  PlaceOrderItem,
  ReturnItem,
  SupplierOrderStatusValue,
} from '../suppliers/types';
import { SuppliersService } from '../suppliers/suppliers.service';
import { RateLimiterRegistry } from '../suppliers/rate-limiter.registry';
import { IndeterminateSupplierError } from '../suppliers/indeterminate';

/**
 * How long a supplier send may legitimately be in flight — matches the connectors' request
 * timeout. A SENDING row younger than this may still be on the wire, so resolveSupplierAttempt
 * refuses to settle it (unless the admin forces it): settling → FAILED → retry while the first
 * request is still live would double-order.
 */
export const SUPPLIER_SEND_TIMEOUT_MS = 20000;

/**
 * Sub-order statuses that are NOT (yet) at the supplier:
 *  - NEW     — pre-created, never sent;
 *  - SENDING — a send is in flight, or its outcome write was lost (ambiguous);
 *  - FAILED  — sent and rejected.
 * Anything else (PLACED / CONFIRMED / SHIPPED / DELIVERED / CANCELLED) means the supplier
 * accepted the order at some point.
 */
const NOT_PLACED_SUPPLIER_STATUSES: SupplierOrderStatusValue[] = [
  'NEW',
  'SENDING',
  'FAILED',
];

/**
 * Aggregate the order status from its sub-order statuses (Spec C §4.6).
 *
 * Nothing placed (empty list, or every group failed) means the order is dead: the
 * customer has paid and the manager must see it as a refund candidate, so it lands in
 * CANCELLED rather than the misleading PARTIALLY_PLACED.
 *
 * A stuck SENDING group is NOT placed: it must never let the order read as fully PLACED,
 * or nobody would ever look at it again.
 */
export function aggregateOrderStatus(
  statuses: SupplierOrderStatusValue[],
): OrderStatus {
  if (statuses.length === 0) return OrderStatus.CANCELLED;
  if (statuses.every((s) => s === 'FAILED')) return OrderStatus.CANCELLED;
  if (statuses.some((s) => NOT_PLACED_SUPPLIER_STATUSES.includes(s))) {
    return OrderStatus.PARTIALLY_PLACED;
  }
  return OrderStatus.PLACED;
}

/**
 * Sub-order statuses that are "in flight" at the supplier and worth polling.
 * NEW is not yet placed (no externalOrderId); SENDING has no externalOrderId either (the
 * send is in flight or its outcome was lost — an admin resolves it, a poll cannot);
 * FAILED is retried, not polled; DELIVERED / CANCELLED are terminal.
 */
export const POLLABLE_SUPPLIER_STATUSES: SupplierOrderStatusValue[] = [
  'PLACED',
  'CONFIRMED',
  'SHIPPED',
];

/** Sub-order statuses a manager may (re-)send from. Everything else is at the supplier. */
const RETRYABLE_SUPPLIER_STATUSES: SupplierOrderStatusValue[] = ['NEW', 'FAILED'];

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(SupplierOrder)
    private readonly supplierOrderRepo: Repository<SupplierOrder>,
    @Inject(CART_CHECKOUT)
    private readonly cart: CartCheckoutContract,
    private readonly suppliersRegistry: SuppliersRegistry,
    private readonly partnerProducts: PartnerProductsService,
    private readonly suppliersService: SuppliersService,
    private readonly rateLimiter: RateLimiterRegistry,
    private readonly addresses: AddressesService,
    private readonly settings: SettingsService,
  ) {}

  // ---- Reads ----

  async findAllByUser(userId: string): Promise<any[]> {
    const orders = await this.orderRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return orders.map(this.withLabelPublic);
  }

  async findOne(id: string, userId: string): Promise<any> {
    const order = await this.orderRepo.findOne({ where: { id, userId } });
    if (!order) throw new NotFoundException('Order not found.');
    return this.withLabelPublic(order);
  }

  async findAll(): Promise<any[]> {
    const orders = await this.orderRepo.find({ order: { createdAt: 'DESC' } });
    const names = await this.supplierNameMap();
    return orders.map((o) => this.withLabel(o, names));
  }

  /** code -> human-readable supplier name, for labelling items in the admin view. */
  private async supplierNameMap(): Promise<Map<string, string>> {
    const suppliers = await this.suppliersService.findAll();
    return new Map(suppliers.map((s) => [s.code, s.name]));
  }

  private async loadOrder(id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  // ---- Checkout (Spec C §4) ----

  async create(userId: string, dto: CreateOrderDto): Promise<any> {
    // Resolve the delivery target. For delivery the address is mandatory and
    // must belong to the user; for pickup no address is stored.
    let addressId: string | null = null;
    if (dto.deliveryType === DeliveryType.DELIVERY) {
      if (!dto.addressId) {
        throw new BadRequestException('addressId is required for delivery.');
      }
      // Throws NotFound/Forbidden if the address is missing or not the user's.
      const address = await this.addresses.findOne(dto.addressId, userId);
      addressId = address.id;
    }

    const items = await this.cart.getCheckoutItems(userId);
    if (!items.length) {
      throw new ConflictException({ message: 'Cart is empty.', changes: [] });
    }

    // §4.2 — block when the live re-check found unavailable items or price changes.
    const changes = items
      .filter((i) => !i.available || i.priceChanged)
      .map((i) => ({
        supplierCode: i.supplierCode,
        article: i.article,
        brand: i.brand,
        available: i.available,
        priceChanged: i.priceChanged,
        priceAtAdd: i.priceAtAdd,
        currentPrice: i.currentPrice,
      }));
    if (changes.length) {
      throw new ConflictException({
        message:
          'Cart changed since last review. Confirm new prices or remove unavailable items.',
        changes,
      });
    }

    const isTest = (await this.settings.getOrderMode()) === 'test';

    // §4.3 — create Order + immutable order_item snapshots (prices from currentPrice).
    const order = this.orderRepo.create({
      userId,
      deliveryType: dto.deliveryType,
      addressId,
      recipientName: dto.recipientName ?? null,
      recipientPhone: dto.recipientPhone ?? null,
      customerComment: dto.customerComment ?? null,
      // Payment first: the order waits for the TipTopPay webhook before anything is sent
      // to suppliers. PaymentsService.handlePayWebhook() calls placeWithSuppliers().
      status: OrderStatus.AWAITING_PAYMENT,
      isTest,
      totalAmount: items.reduce(
        (sum, i) => sum + i.currentPrice * i.quantity,
        0,
      ),
      items: items.map((i) => this.buildOrderItem(i)),
    });
    const saved = await this.orderRepo.save(order);

    // The cart is NOT cleared here: the customer may abandon the payment, and their cart
    // must survive. It is cleared in placeWithSuppliers(), once the money is in.
    return this.withLabelPublic(saved);
  }

  /**
   * Place a paid order with its suppliers. Called from the TipTopPay `Pay` webhook —
   * never from checkout.
   *
   * Idempotent by construction: the order is *claimed* with a compare-and-set
   * (AWAITING_PAYMENT -> PAID) BEFORE any supplier is contacted. Only one caller can
   * win that UPDATE, so concurrent webhook deliveries — and retries after a mid-loop
   * crash, where the placement of supplier #1 is already on the wire — can never
   * double-order from a supplier.
   */
  async placeWithSuppliers(orderId: string): Promise<Order> {
    // ---- Transaction: claim + pre-create the sub-order rows, all or nothing. ----
    //
    // The claim alone is not enough: if we committed it and then died before/while the
    // sub-order rows were written, the order would sit at PAID with zero or partial rows.
    // The redelivered webhook would no-op on the claim, and the manager would have no row
    // to retry — money taken, items never ordered, nothing to click.
    //
    // Bundling both in ONE transaction removes that hole: a rollback returns the order to
    // AWAITING_PAYMENT with no rows, and the redelivered webhook simply claims it for the
    // first time.
    //
    // !!! LOAD-BEARING: the supplier sends MUST stay strictly OUTSIDE and AFTER this
    // transaction commits. Nothing inside this block may talk to a supplier. If someone
    // moves sendSupplierOrder() in here, a rollback would un-claim an order whose supplier
    // was ALREADY contacted, the redelivered webhook would claim it as fresh, and that
    // supplier would receive the same order twice. Real money, real goods. Do not.
    const claim = await this.orderRepo.manager.transaction(async (manager) => {
      // Atomic claim: a conditional UPDATE, not a read-check-write. The DB decides the
      // winner; everyone else sees affected = 0.
      const claimed = await manager
        .getRepository(Order)
        .update(
          { id: orderId, status: OrderStatus.AWAITING_PAYMENT },
          { status: OrderStatus.PAID },
        );
      if (!claimed.affected) return null;

      const order = await manager
        .getRepository(Order)
        .findOne({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Order not found.');

      // §4.4-4.6 — group the order's own item snapshots (not the live cart — it may have
      // changed or been cleared since checkout), place each group, aggregate status.
      const groups = this.groupBySupplier(order);

      // Every group gets a persisted sub-order row (status NEW) BEFORE any supplier is
      // contacted. If we die halfway through the placement loop below, the un-reached
      // groups are still visible to the manager as retryable NEW rows — otherwise they
      // would have no row at all, the order would be stuck at PAID, and the customer's
      // money would be taken for items nobody ever ordered.
      const subOrders = await this.createSubOrders(
        manager,
        order.id,
        groups,
        order.isTest,
      );
      return { order, subOrders };
    });

    if (!claim) {
      // Someone already claimed this order — a concurrent or replayed Pay webhook.
      // Return it untouched: suppliers must never be contacted twice.
      this.logger.warn(
        `placeWithSuppliers: order ${orderId} is already claimed — skipping.`,
      );
      return this.loadOrder(orderId);
    }

    // ---- Committed. Only now may a supplier hear from us. ----
    const { order, subOrders } = claim;
    const groups = this.groupBySupplier(order);

    // Test mode: the rows exist, but no partner is ever contacted.
    if (!order.isTest) {
      for (const sub of subOrders) {
        await this.sendSupplierOrder(sub, groups.get(sub.supplierCode) ?? []);
      }
    }

    // Aggregate from the DB, not from the send loop's in-memory copies. The moment a
    // concurrent manager retry touches a row, our `subOrders` array is stale — re-reading the
    // persisted rows is the only source of truth. (See CRITICAL 1: the parent cascade save
    // that used to run here would UPDATE every child from that stale array, reverting a row a
    // concurrent retry had just advanced to PLACED and destroying the evidence.)
    const freshSubs = await this.supplierOrderRepo.find({
      where: { orderId: order.id },
    });
    const status = order.isTest
      ? OrderStatus.PAID
      : aggregateOrderStatus(freshSubs.map((s) => s.status));
    // Narrow, NON-cascading write: only the order's own status column. Never persist the
    // parent with its eager supplierOrders attached, or the cascade clobbers the children.
    await this.orderRepo.update({ id: order.id }, { status });
    order.status = status;
    order.supplierOrders = freshSubs;

    // §4.7 — analytics upsert + clear cart, now that the money is in and the placement
    // is committed. These are side effects, not part of the money path: if they throw,
    // the webhook must still return 2xx, because a retry would (correctly) hit the
    // idempotency claim above and no-op.
    //
    // They get SEPARATE try/catches on purpose: a failing analytics write must not skip
    // the cart clear. The customer has paid for these items — leaving them in the cart
    // invites an accidental second purchase, and no retry will ever come back to fix it.
    try {
      for (const item of order.items ?? []) {
        await this.partnerProducts.recordOrder({
          supplierCode: item.supplierCode ?? '',
          article: item.article ?? item.productSku,
          brand: item.brand ?? '',
          name: item.productName,
          costPrice: Number(item.costPrice ?? 0),
          sellPrice: Number(item.sellPrice ?? item.priceAtOrder),
        });
      }
    } catch (err) {
      this.logger.warn(
        `partner-product analytics failed for order ${orderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    try {
      await this.cart.clearCart(order.userId);
    } catch (err) {
      this.logger.warn(
        `clearCart failed for paid order ${orderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return order;
  }

  private buildOrderItem(item: CheckoutItem): OrderItem {
    const orderItem = new OrderItem();
    orderItem.productId = null;
    orderItem.productName = item.productName;
    // Legacy NOT NULL columns — fill from the snapshot for aggregator items.
    orderItem.productSku = item.article;
    orderItem.priceAtOrder = item.currentPrice;
    // Aggregator snapshot.
    orderItem.supplierCode = item.supplierCode;
    orderItem.article = item.article;
    orderItem.brand = item.brand;
    orderItem.costPrice = item.costPrice;
    orderItem.sellPrice = item.currentPrice;
    orderItem.warehouseId = item.warehouseId;
    orderItem.deliveryDays = item.deliveryDays ?? null;
    orderItem.raw = item.raw;
    orderItem.quantity = item.quantity;
    orderItem.subtotal = item.currentPrice * item.quantity;
    return orderItem;
  }

  /** Group the order's immutable item snapshots by supplier code. */
  private groupBySupplier(order: Order): Map<string, OrderItem[]> {
    const groups = new Map<string, OrderItem[]>();
    for (const item of order.items ?? []) {
      const list = groups.get(item.supplierCode ?? '') ?? [];
      list.push(item);
      groups.set(item.supplierCode ?? '', list);
    }
    return groups;
  }

  /**
   * Phase 1 of placement: persist one sub-order row per supplier group, all in status
   * NEW with no externalOrderId, before a single supplier is contacted.
   *
   * Runs inside the claim transaction (hence the explicit `manager`): either the order is
   * claimed AND every group has a row, or neither happened.
   *
   * This is what makes a mid-placement crash recoverable: whatever happens next, every
   * group the customer paid for has a row a manager can see and retry.
   */
  private async createSubOrders(
    manager: EntityManager,
    orderId: string,
    groups: Map<string, OrderItem[]>,
    isTest: boolean,
  ): Promise<SupplierOrder[]> {
    const repo = manager.getRepository(SupplierOrder);
    const subs: SupplierOrder[] = [];
    for (const supplierCode of groups.keys()) {
      const sub = repo.create({
        orderId,
        supplierCode,
        status: 'NEW' as SupplierOrderStatusValue,
        externalOrderId: null,
        attemptedAt: null,
        errorMessage: null,
        returnStatus: null,
        externalReturnId: null,
        isTest,
      });
      subs.push(await repo.save(sub));
    }
    return subs;
  }

  /**
   * Phase 2 of placement: contact one supplier and transition its ALREADY PERSISTED
   * sub-order row in place (NEW -> PLACED / FAILED / whatever the connector returns).
   * Never creates a row — the row is the pre-committed evidence that this group is owed.
   */
  private async sendSupplierOrder(
    sub: SupplierOrder,
    items: OrderItem[],
  ): Promise<SupplierOrder> {
    // ---- Atomic claim of the SEND, the exact mirror of the order-level claim. ----
    //
    // A conditional UPDATE (…WHERE id = ? AND status = ?), never save() — save() is an
    // unconditional `UPDATE … WHERE id`, so two senders would both "win" it and the
    // supplier would receive the order twice. Here the DB picks the single winner; every
    // other sender sees affected = 0 and walks away without touching the connector.
    //
    // This closes both holes at once:
    //  - a concurrent retry (double-clicked button, two managers) loses the CAS;
    //  - a placement loop working from its in-memory array loses the CAS too, because the
    //    row it holds is stale the moment somebody else claims it;
    //  - and if the outcome write below is lost (crash, DB gone), the row is left in
    //    SENDING — a status NOTHING re-sends automatically. Only an admin who has phoned
    //    the supplier can resolve it (resolveSupplierAttempt).
    //
    // Deliberately outside the try/catch: losing the claim, or failing to write it, means
    // we have contacted NOBODY, so the row must not be marked FAILED.
    const attemptedAt = new Date();
    const claimed = await this.supplierOrderRepo.update(
      { id: sub.id, status: sub.status },
      { status: 'SENDING' as SupplierOrderStatusValue, attemptedAt },
    );
    if (!claimed.affected) {
      // Someone else is already sending (or has already sent) this sub-order. Refresh our
      // stale in-memory copy so the caller aggregates on the truth, and contact nobody.
      this.logger.warn(
        `sendSupplierOrder: sub-order ${sub.id} (${sub.supplierCode}) is already being sent by someone else — skipping.`,
      );
      const fresh = await this.supplierOrderRepo.findOne({
        where: { id: sub.id },
      });
      if (fresh) Object.assign(sub, fresh);
      return sub;
    }
    sub.status = 'SENDING';
    sub.attemptedAt = attemptedAt;

    // Compute the terminal outcome. A connector that RETURNS a result gives a definite answer
    // (PLACED, or a supplier decline -> FAILED). A connector that THROWS is either an
    // INDETERMINATE transport failure — the supplier may already have the order, so we leave
    // the row SENDING and let an admin resolve it — or a hard local failure (no order API),
    // which is a definite FAILED.
    let outcome: {
      status: SupplierOrderStatusValue;
      externalOrderId: string | null;
      errorMessage: string | null;
    };
    try {
      const connector = await this.suppliersRegistry.getByCode(
        sub.supplierCode,
      );
      const supplier = await this.suppliersService.findByCode(sub.supplierCode);
      const result = await this.rateLimiter.gate(
        sub.supplierCode,
        supplier?.rateLimitRpm ?? null,
        () => connector.placeOrder(this.toPlaceOrderItems(items)),
      );
      outcome = {
        status: result.status,
        externalOrderId: result.externalOrderId,
        errorMessage: result.errorMessage ?? null,
      };
    } catch (err) {
      if (err instanceof IndeterminateSupplierError) {
        // We contacted the supplier and never learned the outcome. The row is ALREADY on
        // disk as SENDING (the claim above) — write no terminal outcome, so nothing
        // auto-re-sends it. Only resolveSupplierAttempt() (admin, after phoning the
        // supplier) can settle it.
        this.logger.warn(
          `sendSupplierOrder: sub-order ${sub.id} (${sub.supplierCode}) outcome is UNKNOWN ` +
            `(${err.message}) — leaving it SENDING for an admin to resolve.`,
        );
        return sub;
      }
      outcome = {
        status: 'FAILED',
        externalOrderId: null,
        errorMessage:
          err instanceof NotImplementedException
            ? 'No order API for this partner — manual processing required.'
            : (err as any)?.message ?? 'placeOrder failed.',
      };
    }

    // Terminal write as a CONDITIONAL update (never save()): only a sender still holding the
    // SENDING row may record the outcome. If a resolve-attempt (admin) claimed the row while
    // we were on the wire, it now owns the verdict — we lose the CAS and must not overwrite it.
    const settled = await this.supplierOrderRepo.update(
      { id: sub.id, status: 'SENDING' as SupplierOrderStatusValue },
      {
        status: outcome.status,
        externalOrderId: outcome.externalOrderId,
        errorMessage: outcome.errorMessage,
      },
    );
    if (!settled.affected) {
      const fresh = await this.supplierOrderRepo.findOne({
        where: { id: sub.id },
      });
      if (fresh) Object.assign(sub, fresh);
      return sub;
    }
    sub.status = outcome.status;
    sub.externalOrderId = outcome.externalOrderId;
    sub.errorMessage = outcome.errorMessage;
    return sub;
  }

  /** Map immutable order-item snapshots to the connector's placeOrder payload. */
  private toPlaceOrderItems(items: OrderItem[]): PlaceOrderItem[] {
    return items.map((i) => ({
      article: i.article ?? i.productSku,
      brand: i.brand ?? '',
      warehouseId: i.warehouseId ?? '',
      quantity: i.quantity,
      raw: i.raw ?? {},
    }));
  }

  // ---- Manager sub-order controls (Spec C §5) ----

  private async getSubOrder(
    orderId: string,
    supplierOrderId: string,
  ): Promise<SupplierOrder> {
    const sub = await this.supplierOrderRepo.findOne({
      where: { id: supplierOrderId, orderId },
    });
    if (!sub) throw new NotFoundException('Supplier sub-order not found.');
    return sub;
  }

  private async reaggregate(orderId: string): Promise<void> {
    const order = await this.loadOrder(orderId);
    const subs = order.supplierOrders ?? [];
    // aggregateOrderStatus([]) is CANCELLED by design (nothing placed => refund
    // candidate), but that verdict is only meaningful right after placement. Re-running
    // it on an order that has no sub-orders loaded/persisted (e.g. AWAITING_PAYMENT, or
    // a relation that simply was not selected) would silently kill a live order.
    if (!subs.length) return;
    const status = aggregateOrderStatus(subs.map((s) => s.status));
    // Non-cascading write: persist only the order's own status. Saving the eager-loaded
    // parent would cascade-UPDATE its children from this in-memory copy, reverting a row a
    // concurrent send/retry advanced in the meantime (CRITICAL 1).
    await this.orderRepo.update({ id: orderId }, { status });
    order.status = status;
  }

  async refreshSupplierStatus(
    orderId: string,
    supplierOrderId: string,
  ): Promise<any> {
    const sub = await this.getSubOrder(orderId, supplierOrderId);
    if (!sub.externalOrderId) {
      throw new ConflictException('No external order id to refresh.');
    }
    const connector = await this.suppliersRegistry.getByCode(sub.supplierCode);
    sub.status = await connector.getOrderStatus(sub.externalOrderId);
    await this.supplierOrderRepo.save(sub);
    await this.reaggregate(orderId);
    return this.withLabel(await this.loadOrder(orderId));
  }

  /**
   * Poll every in-flight sub-order against its supplier and persist any status
   * change, then re-aggregate the parent orders that moved. Designed to be
   * driven by a scheduled job; one failing supplier never aborts the batch.
   */
  async pollActiveSupplierStatuses(): Promise<{
    checked: number;
    updated: number;
    failed: number;
  }> {
    // Only sub-orders actually placed at the supplier are pollable — filter out
    // rows without an externalOrderId in SQL rather than skipping them in the loop.
    const subs = await this.supplierOrderRepo.find({
      where: {
        status: In(POLLABLE_SUPPLIER_STATUSES),
        externalOrderId: Not(IsNull()),
      },
    });
    const touchedOrders = new Set<string>();
    let updated = 0;
    let failed = 0;
    for (const sub of subs) {
      // Belt-and-suspenders: the query already excludes null externalOrderId,
      // but guard here too so a sub is never polled without an order id.
      if (!sub.externalOrderId) continue;
      try {
        const connector = await this.suppliersRegistry.getByCode(
          sub.supplierCode,
        );
        const next = await connector.getOrderStatus(sub.externalOrderId);
        if (next !== sub.status) {
          sub.status = next;
          await this.supplierOrderRepo.save(sub);
          touchedOrders.add(sub.orderId);
          updated++;
        }
      } catch (err) {
        failed++;
        this.logger.warn(
          `status poll failed for sub-order ${sub.id} (${sub.supplierCode}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    for (const orderId of touchedOrders) {
      await this.reaggregate(orderId);
    }
    return { checked: subs.length, updated, failed };
  }

  async retrySupplierOrder(
    orderId: string,
    supplierOrderId: string,
  ): Promise<any> {
    const sub = await this.getSubOrder(orderId, supplierOrderId);
    // A test-mode sub-order is created NEW and deliberately never sent. Retrying it would
    // place a REAL order with a REAL partner off the back of a test run.
    if (sub.isTest) {
      throw new ConflictException(
        'This is a test-mode sub-order — it is never sent to the supplier and cannot be retried.',
      );
    }
    // SENDING is AMBIGUOUS: a send is in flight right now, or its outcome write was lost
    // and the supplier may already have the order. Re-sending would duplicate real goods.
    // Only a human who has phoned the supplier can settle it — point them at the endpoint
    // that actually exists for that.
    if (sub.status === 'SENDING' || (sub.status === 'NEW' && sub.attemptedAt)) {
      throw new ConflictException(
        'This sub-order is already being sent to the supplier, or was sent once and the result was never saved. ' +
          'The supplier may already have it, so it cannot be re-sent from here. ' +
          'Confirm with the supplier by phone, then record the answer via ' +
          'POST /orders/:id/suppliers/:sid/resolve-attempt (admin): delivered=true marks it PLACED, ' +
          'delivered=false marks it FAILED and re-opens the retry.',
      );
    }
    // NEW = pre-created but never sent (the placement loop died before reaching this
    // group); FAILED = sent and rejected. Both are owed to a paying customer and safe to
    // (re-)send — and sendSupplierOrder() claims the row atomically, so even a double
    // click can only produce ONE call to the supplier. Anything else already lives at the
    // supplier — re-sending would duplicate the order there.
    if (!RETRYABLE_SUPPLIER_STATUSES.includes(sub.status)) {
      throw new ConflictException(
        'Only NEW or FAILED sub-orders can be retried.',
      );
    }
    const order = await this.loadOrder(orderId);
    const groupItems = (order.items ?? []).filter(
      (it) => it.supplierCode === sub.supplierCode,
    );
    await this.sendSupplierOrder(sub, groupItems);
    await this.reaggregate(orderId);
    return this.withLabel(await this.loadOrder(orderId));
  }

  /**
   * Settle an AMBIGUOUS sub-order — one left in SENDING (or a legacy NEW + attemptedAt):
   * we started talking to the supplier and never learned the outcome, so nothing may
   * touch that row automatically. A human phones the supplier; this endpoint records what
   * they said, and it is the ONLY exit from the ambiguous state.
   *
   *  - delivered: true  -> the supplier does have the order  -> PLACED (goods are coming;
   *                        the admin may supply the supplier's own order id).
   *  - delivered: false -> the supplier never got it         -> FAILED, which re-opens the
   *                        normal retry path.
   *
   * ADMIN only, and the admin's id is logged: this is a manual override of the one rule
   * that protects the customer's money.
   */
  async resolveSupplierAttempt(
    orderId: string,
    supplierOrderId: string,
    dto: ResolveAttemptDto,
    adminId: string,
  ): Promise<any> {
    const sub = await this.getSubOrder(orderId, supplierOrderId);
    const isAmbiguous =
      sub.status === 'SENDING' || (sub.status === 'NEW' && !!sub.attemptedAt);
    if (!isAmbiguous) {
      throw new ConflictException(
        'Only an ambiguous sub-order (SENDING, i.e. sent to the supplier with no saved outcome) can be resolved this way.',
      );
    }

    // Age guard: a row whose attempt started less than the send timeout ago may still be
    // legitimately in flight. Settling it now (delivered:false -> FAILED -> retry) would fire
    // a second send while the first is still on the wire — the exact double-order we prevent.
    // An admin who has confirmed the outcome out of band can override with force:true.
    const attemptedMs = sub.attemptedAt
      ? new Date(sub.attemptedAt).getTime()
      : 0;
    if (
      !dto.force &&
      attemptedMs &&
      Date.now() - attemptedMs < SUPPLIER_SEND_TIMEOUT_MS
    ) {
      throw new ConflictException(
        'Эта попытка отправки началась только что и ещё может выполняться. ' +
          'Подождите завершения таймаута отправки или передайте force=true, ' +
          'если вы уже подтвердили результат у поставщика.',
      );
    }

    const next: SupplierOrderStatusValue = dto.delivered ? 'PLACED' : 'FAILED';
    // Conditional update again: if the in-flight send finished between our read and this
    // write, it — not us — owns the outcome, and we must not overwrite it.
    const resolved = await this.supplierOrderRepo.update(
      { id: sub.id, status: sub.status },
      {
        status: next,
        externalOrderId: dto.delivered
          ? dto.externalOrderId ?? sub.externalOrderId ?? null
          : null,
        errorMessage: dto.delivered
          ? null
          : dto.comment ??
            'Supplier confirmed they never received this order — resolved manually by an admin.',
      },
    );
    if (!resolved.affected) {
      throw new ConflictException(
        'This sub-order changed while you were resolving it — reload it and check its current status.',
      );
    }
    this.logger.warn(
      `resolve-attempt: sub-order ${sub.id} (${sub.supplierCode}, order ${orderId}) ` +
        `resolved as ${next} by admin ${adminId}` +
        (dto.comment ? `: ${dto.comment}` : ''),
    );

    await this.reaggregate(orderId);
    return this.withLabel(await this.loadOrder(orderId));
  }

  async requestSupplierReturn(
    orderId: string,
    supplierOrderId: string,
    dto: RequestReturnDto,
  ): Promise<any> {
    const sub = await this.getSubOrder(orderId, supplierOrderId);
    const returnItems: ReturnItem[] = dto.items.map((line) => ({
      externalOrderId: sub.externalOrderId ?? '',
      article: line.article,
      quantity: line.quantity,
    }));
    try {
      const connector = await this.suppliersRegistry.getByCode(sub.supplierCode);
      const result = await connector.requestReturn(
        sub.externalOrderId ?? '',
        returnItems,
      );
      sub.returnStatus = result.returnStatus;
      sub.externalReturnId = result.externalReturnId ?? null;
    } catch (err) {
      if (err instanceof NotImplementedException) {
        // Semi-automatic: no return API — record a manual return request.
        sub.returnStatus = 'REQUESTED';
      } else {
        throw err;
      }
    }
    await this.supplierOrderRepo.save(sub);
    return this.withLabel(await this.loadOrder(orderId));
  }

  // ---- Status / cancel / manager comments (existing) ----

  /**
   * Statuses owned by the payment flow, not by a human. AWAITING_PAYMENT is the
   * idempotency token placeWithSuppliers() claims: letting a manager set it back would
   * re-arm placement for any later webhook delivery and re-order everything from the
   * suppliers. PAID is the claimed state and is only ever written by that claim.
   */
  private static readonly PAYMENT_OWNED_STATUSES: OrderStatus[] = [
    OrderStatus.AWAITING_PAYMENT,
    OrderStatus.PAID,
  ];

  async updateStatus(id: string, status: OrderStatus): Promise<any> {
    if (OrdersService.PAYMENT_OWNED_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Status "${status}" is owned by the payment flow and cannot be set manually — ` +
          'it would re-arm supplier placement and risk double-ordering.',
      );
    }
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Order not found.');
    // Non-cascading write: never persist the eager-loaded parent (it would clobber the
    // children); write only the status column (CRITICAL 1).
    await this.orderRepo.update({ id }, { status });
    order.status = status;
    return this.withLabel(order);
  }

  async cancel(id: string, userId: string): Promise<any> {
    const order = await this.orderRepo.findOne({ where: { id, userId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status === OrderStatus.DELIVERED) {
      throw new BadRequestException('Cannot cancel a delivered order.');
    }
    // Non-cascading write: only the order's own status column (CRITICAL 1).
    await this.orderRepo.update({ id }, { status: OrderStatus.CANCELLED });
    order.status = OrderStatus.CANCELLED;
    return this.withLabelPublic(order);
  }

  async upsertComment(
    orderId: string,
    managerId: string,
    comment: string,
  ): Promise<any> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    // Non-cascading write: only the comment columns, never the eager children (CRITICAL 1).
    await this.orderRepo.update(
      { id: orderId },
      { managerComment: comment, commentedBy: managerId },
    );
    order.managerComment = comment;
    order.commentedBy = managerId;
    return this.withLabel(order);
  }

  async deleteComment(orderId: string, managerId: string): Promise<any> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.commentedBy !== managerId) {
      throw new ForbiddenException('You can only delete your own comment.');
    }
    // Non-cascading write: only the comment columns, never the eager children (CRITICAL 1).
    await this.orderRepo.update(
      { id: orderId },
      { managerComment: null, commentedBy: null },
    );
    order.managerComment = null;
    order.commentedBy = null;
    return this.withLabel(order);
  }

  // Arrow properties so they keep `this` when passed to Array.map.
  /**
   * Manager view: keeps costPrice (margin) on items and stamps a readable
   * supplierName onto each item / sub-order (falls back to the raw code).
   */
  private withLabel = (order: Order, names?: Map<string, string>) => ({
    ...order,
    statusLabel: OrderStatusLabel[order.status],
    deliveryTypeLabel: DeliveryTypeLabel[order.deliveryType],
    items: (order.items ?? []).map((it) => ({
      ...it,
      supplierName: names?.get(it.supplierCode) ?? it.supplierCode,
    })),
    supplierOrders: (order.supplierOrders ?? []).map((so) => ({
      ...so,
      supplierName: names?.get(so.supplierCode) ?? so.supplierCode,
    })),
  });

  /** Buyer view: strips costPrice from items so we never expose our margin. */
  private withLabelPublic = (order: Order) => {
    const labeled: any = this.withLabel(order);
    labeled.items = (labeled.items ?? []).map((it: any) => {
      const { costPrice, ...rest } = it;
      return rest;
    });
    return labeled;
  };
}
