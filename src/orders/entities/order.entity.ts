import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { Address } from '../../addresses/entities/address.entity';
import { OrderItem } from './order-item.entity';
import { SupplierOrder } from './supplier-order.entity';

export enum OrderStatus {
  NEW = 'new',
  PAID = 'paid',
  PENDING = 'pending',
  PLACED = 'placed',
  PARTIALLY_PLACED = 'partially_placed',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export const OrderStatusLabel: Record<OrderStatus, string> = {
  [OrderStatus.NEW]: 'Новый',
  [OrderStatus.PAID]: 'Оплачен',
  [OrderStatus.PENDING]: 'В обработке',
  [OrderStatus.PLACED]: 'Размещён у партнёров',
  [OrderStatus.PARTIALLY_PLACED]: 'Размещён частично',
  [OrderStatus.DELIVERED]: 'Доставлено',
  [OrderStatus.CANCELLED]: 'Отменен',
};

export enum DeliveryType {
  DELIVERY = 'delivery',
  PICKUP = 'pickup',
}

export const DeliveryTypeLabel: Record<DeliveryType, string> = {
  [DeliveryType.DELIVERY]: 'Доставка',
  [DeliveryType.PICKUP]: 'Самовывоз',
};

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @ManyToOne(() => Address, { onDelete: 'SET NULL', nullable: true, eager: true })
  @JoinColumn()
  address: Address;

  @Column({ nullable: true })
  addressId: string;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true, eager: true })
  items: OrderItem[];

  @OneToMany(() => SupplierOrder, (so) => so.order, { cascade: true, eager: true })
  supplierOrders: SupplierOrder[];

  @Column({ type: 'varchar', default: OrderStatus.NEW })
  status: OrderStatus;

  @Column({ type: 'varchar', default: DeliveryType.DELIVERY })
  deliveryType: DeliveryType;

  @ApiProperty({ description: 'true, если заказ оформлен в тестовом режиме (не отправлен поставщикам)', example: false })
  @Column({ default: false })
  isTest: boolean;

  @Column({ type: 'text', nullable: true, default: null })
  managerComment: string | null;

  @Column({ nullable: true, default: null })
  commentedBy: string | null;  // stores manager userId

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalAmount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  get statusLabel(): string {
    return OrderStatusLabel[this.status];
  }

  get deliveryTypeLabel(): string {
    return DeliveryTypeLabel[this.deliveryType];
  }
}