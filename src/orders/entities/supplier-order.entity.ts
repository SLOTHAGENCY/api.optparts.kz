import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { SupplierOrderStatusValue } from '../../suppliers/types';

export type SupplierOrderReturnStatus =
  | 'REQUESTED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'REJECTED';

@Entity('supplier_orders')
export class SupplierOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.supplierOrders, {
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  order: Order;

  @Column()
  orderId: string;

  @Column({ length: 100 })
  supplierCode: string;

  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  externalOrderId: string | null;

  @Column({ type: 'varchar', default: 'NEW' })
  status: SupplierOrderStatusValue;

  @Column({ type: 'text', nullable: true, default: null })
  errorMessage: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  returnStatus: SupplierOrderReturnStatus | null;

  @Column({ type: 'varchar', length: 255, nullable: true, default: null })
  externalReturnId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
