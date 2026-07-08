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
import { In, Repository } from 'typeorm';
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

/** Aggregate the order status from its sub-order statuses (Spec C §4.6). */
export function aggregateOrderStatus(
  statuses: SupplierOrderStatusValue[],
): OrderStatus {
  if (statuses.length > 0 && statuses.every((s) => s === 'PLACED')) {
    return OrderStatus.PLACED;
  }
  if (statuses.some((s) => s === 'FAILED')) {
    return OrderStatus.PARTIALLY_PLACED;
  }
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
    return orders.map(this.withLabel);
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
      status: OrderStatus.NEW,
      isTest,
      totalAmount: items.reduce(
        (sum, i) => sum + i.currentPrice * i.quantity,
        0,
      ),
      items: items.map((i) => this.buildOrderItem(i)),
    });
    const saved = await this.orderRepo.save(order);

    // §4.4-4.6 — group by supplier, place each group, aggregate status.
    const groups = new Map<string, CheckoutItem[]>();
    for (const item of items) {
      const list = groups.get(item.supplierCode) ?? [];
      list.push(item);
      groups.set(item.supplierCode, list);
    }
    const subOrders: SupplierOrder[] = [];
    for (const [supplierCode, groupItems] of groups) {
      subOrders.push(
        await this.placeSupplierOrder(saved.id, supplierCode, groupItems, isTest),
      );
    }
    saved.supplierOrders = subOrders;
    saved.status = isTest
      ? OrderStatus.NEW
      : aggregateOrderStatus(subOrders.map((s) => s.status));
    await this.orderRepo.save(saved);

    // §4.7 — analytics upsert + clear cart.
    for (const item of items) {
      await this.partnerProducts.recordOrder({
        supplierCode: item.supplierCode,
        article: item.article,
        brand: item.brand,
        name: item.productName,
        costPrice: item.costPrice,
        sellPrice: item.currentPrice,
      });
    }
    await this.cart.clearCart(userId);

    return this.withLabelPublic(saved);
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
    orderItem.raw = item.raw;
    orderItem.quantity = item.quantity;
    orderItem.subtotal = item.currentPrice * item.quantity;
    return orderItem;
  }

  private async placeSupplierOrder(
    orderId: string,
    supplierCode: string,
    items: CheckoutItem[],
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

  private toPlaceOrderItems(items: CheckoutItem[]): PlaceOrderItem[] {
    return items.map((i) => ({
      article: i.article,
      brand: i.brand,
      warehouseId: i.warehouseId,
      quantity: i.quantity,
      raw: i.raw,
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
  }> {
    const subs = await this.supplierOrderRepo.find({
      where: { status: In(POLLABLE_SUPPLIER_STATUSES) },
    });
    const touchedOrders = new Set<string>();
    let updated = 0;
    for (const sub of subs) {
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
    return { checked: subs.length, updated };
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
    const placeItems: PlaceOrderItem[] = groupItems.map((it) => ({
      article: it.article ?? '',
      brand: it.brand ?? '',
      warehouseId: it.warehouseId ?? '',
      quantity: it.quantity,
      raw: it.raw ?? {},
    }));
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
  /** Manager view: keeps costPrice (margin) on items. */
  private withLabel = (order: Order) => ({
    ...order,
    statusLabel: OrderStatusLabel[order.status],
    deliveryTypeLabel: DeliveryTypeLabel[order.deliveryType],
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
