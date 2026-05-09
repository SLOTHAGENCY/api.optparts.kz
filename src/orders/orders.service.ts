import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderStatus, OrderStatusLabel } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { ProductsService } from '../products/products.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    private readonly productsService: ProductsService,
  ) {}

  async findAllByUser(userId: string): Promise<any[]> {
    const orders = await this.orderRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return orders.map(this.withLabel);
  }

  async findOne(id: string, userId: string): Promise<any> {
    const order = await this.orderRepo.findOne({ where: { id, userId } });
    if (!order) throw new NotFoundException('Order not found.');
    return this.withLabel(order);
  }

  async findAll(): Promise<any[]> {
    const orders = await this.orderRepo.find({ order: { createdAt: 'DESC' } });
    return orders.map(this.withLabel);
  }

  async create(userId: string, dto: CreateOrderDto): Promise<any> {
    if (!dto.items?.length) throw new BadRequestException('Order must have at least one item.');

    // Resolve products and lock in prices
    const resolvedItems = await Promise.all(
      dto.items.map(async (item) => {
        const product = await this.productsService.findById(item.productId);
        const priceAtOrder = Number(product.price);
        return {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          priceAtOrder,
          quantity: item.quantity,
          subtotal: priceAtOrder * item.quantity,
        };
      }),
    );

    const totalAmount = resolvedItems.reduce((sum, i) => sum + i.subtotal, 0);

    const order = this.orderRepo.create({
      userId,
      addressId: dto.addressId ?? null,
      status: OrderStatus.NEW,
      totalAmount,
      items: resolvedItems.map((i) => this.itemRepo.create(i)),
    });

    const saved = await this.orderRepo.save(order);
    return this.withLabel(saved);
  }

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
    return this.withLabel(await this.orderRepo.save(order));
  }

  private withLabel(order: Order) {
    return { ...order, statusLabel: OrderStatusLabel[order.status] };
  }
}