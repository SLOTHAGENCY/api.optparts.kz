import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Address } from '../../addresses/entities/address.entity';
import { OrderItem } from './order-item.entity';

export enum OrderStatus {
  NEW = 'new',
  PAID = 'paid',
  PENDING = 'pending',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export const OrderStatusLabel: Record<OrderStatus, string> = {
  [OrderStatus.NEW]: 'Новый',
  [OrderStatus.PAID]: 'Оплачен',
  [OrderStatus.PENDING]: 'В обработке',
  [OrderStatus.DELIVERED]: 'Доставлено',
  [OrderStatus.CANCELLED]: 'Отменен',
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

  @Column({ type: 'varchar', default: OrderStatus.NEW })
  status: OrderStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalAmount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  get statusLabel(): string {
    return OrderStatusLabel[this.status];
  }
}