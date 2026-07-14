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
import { In, IsNull, Not, Repository } from 'typeorm';
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

/**
 * Aggregate the order status from its sub-order statuses (Spec C §4.6).
 *
 * Nothing placed (empty list, or every group failed) means the order is dead: the
 * customer has paid and the manager must see it as a refund candidate, so it lands in
 * CANCELLED rather than the misleading PARTIALLY_PLACED.
 */
export function aggregateOrderStatus(
  statuses: SupplierOrderStatusValue[],
): OrderStatus {
  if (statuses.length === 0) return OrderStatus.CANCELLED;
  if (statuses.every((s) => s === 'FAILED')) return OrderStatus.CANCELLED;
  if (statuses.some((s) => s === 'FAILED')) return OrderStatus.PARTIALLY_PLACED;
  return OrderStatus.PLACED;
}

/**
 * Sub-order statuses that are "in flight" at the supplier and worth polling.
 * NEW is not yet placed (no externalOrderId); FAILED is retried, not polled;
 * DELIVERED / CANCELLED are terminal.
 */
export const POLLABLE_SUPPLIER_STATUSES: SupplierOrderStatusValue[] = [
  'PLACED',
  'CONFIRMED',
  'SHIPPED',
];

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
   * Idempotent: a retried webhook finds the order already out of AWAITING_PAYMENT and
   * returns it untouched, so suppliers are never double-ordered.
   */
  async placeWithSuppliers(orderId: string): Promise<Order> {
    const order = await this.loadOrder(orderId);
    if (order.status !== OrderStatus.AWAITING_PAYMENT) {
      this.logger.warn(
        `placeWithSuppliers: order ${orderId} is already ${order.status} — skipping.`,
      );
      return order;
    }

    // §4.4-4.6 — group the order's own item snapshots (not the live cart — it may have
    // changed or been cleared since checkout), place each group, aggregate status.
    const groups = new Map<string, OrderItem[]>();
    for (const item of order.items ?? []) {
      const list = groups.get(item.supplierCode ?? '') ?? [];
      list.push(item);
      groups.set(item.supplierCode ?? '', list);
    }

    const subOrders: SupplierOrder[] = [];
    for (const [supplierCode, groupItems] of groups) {
      subOrders.push(
        await this.placeSupplierOrder(
          order.id,
          supplierCode,
          groupItems,
          order.isTest,
        ),
      );
    }

    order.supplierOrders = subOrders;
    order.status = order.isTest
      ? OrderStatus.PAID
      : aggregateOrderStatus(subOrders.map((s) => s.status));
    await this.orderRepo.save(order);

    // §4.7 — analytics upsert + clear cart, now that the money is in.
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
    await this.cart.clearCart(order.userId);

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

  private async placeSupplierOrder(
    orderId: string,
    supplierCode: string,
    items: OrderItem[],
    isTest = false,
  ): Promise<SupplierOrder> {
    const sub = this.supplierOrderRepo.create({
      orderId,
      supplierCode,
      status: 'NEW' as SupplierOrderStatusValue,
      externalOrderId: null,
      errorMessage: null,
      returnStatus: null,
      externalReturnId: null,
      isTest,
    });
    if (isTest) {
      // Test mode: persist the sub-order without contacting the partner.
      return this.supplierOrderRepo.save(sub);
    }
    try {
      const connector = await this.suppliersRegistry.getByCode(supplierCode);
      const supplier = await this.suppliersService.findByCode(supplierCode);
      const result = await this.rateLimiter.gate(
        supplierCode,
        supplier?.rateLimitRpm ?? null,
        () => connector.placeOrder(this.toPlaceOrderItems(items)),
      );
      sub.externalOrderId = result.externalOrderId;
      sub.status = result.status;
      sub.errorMessage = result.errorMessage ?? null;
    } catch (err) {
      sub.status = 'FAILED';
      sub.errorMessage =
        err instanceof NotImplementedException
          ? 'No order API for this partner — manual processing required.'
          : err?.message ?? 'placeOrder failed.';
    }
    return this.supplierOrderRepo.save(sub);
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
    order.status = aggregateOrderStatus(
      (order.supplierOrders ?? []).map((s) => s.status),
    );
    await this.orderRepo.save(order);
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
    if (sub.status !== 'FAILED') {
      throw new ConflictException('Only FAILED sub-orders can be retried.');
    }
    const order = await this.loadOrder(orderId);
    const groupItems = (order.items ?? []).filter(
      (it) => it.supplierCode === sub.supplierCode,
    );
    const placeItems: PlaceOrderItem[] = this.toPlaceOrderItems(groupItems);
    try {
      const connector = await this.suppliersRegistry.getByCode(sub.supplierCode);
      const supplier = await this.suppliersService.findByCode(sub.supplierCode);
      const result = await this.rateLimiter.gate(
        sub.supplierCode,
        supplier?.rateLimitRpm ?? null,
        () => connector.placeOrder(placeItems),
      );
      sub.externalOrderId = result.externalOrderId;
      sub.status = result.status;
      sub.errorMessage = result.errorMessage ?? null;
    } catch (err) {
      sub.status = 'FAILED';
      sub.errorMessage =
        err instanceof NotImplementedException
          ? 'No order API for this partner — manual processing required.'
          : err?.message ?? 'placeOrder failed.';
    }
    await this.supplierOrderRepo.save(sub);
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

  async updateStatus(id: string, status: OrderStatus): Promise<any> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Order not found.');
    order.status = status;
    const saved = await this.orderRepo.save(order);
    return this.withLabel(saved);
  }

  async cancel(id: string, userId: string): Promise<any> {
    const order = await this.orderRepo.findOne({ where: { id, userId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status === OrderStatus.DELIVERED) {
      throw new BadRequestException('Cannot cancel a delivered order.');
    }
    order.status = OrderStatus.CANCELLED;
    return this.withLabelPublic(await this.orderRepo.save(order));
  }

  async upsertComment(
    orderId: string,
    managerId: string,
    comment: string,
  ): Promise<any> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    order.managerComment = comment;
    order.commentedBy = managerId;
    return this.withLabel(await this.orderRepo.save(order));
  }

  async deleteComment(orderId: string, managerId: string): Promise<any> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.commentedBy !== managerId) {
      throw new ForbiddenException('You can only delete your own comment.');
    }
    order.managerComment = null;
    order.commentedBy = null;
    return this.withLabel(await this.orderRepo.save(order));
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
