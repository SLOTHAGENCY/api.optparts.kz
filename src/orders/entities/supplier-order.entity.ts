import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
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

  @ApiProperty({ description: 'true, если этот под-заказ создан в тестовом режиме (размещение у поставщика пропущено)', example: false })
  @Column({ default: false })
  isTest: boolean;

  /**
   * When we last STARTED contacting this supplier — persisted BEFORE the connector call,
   * never after. A row that is still NEW but carries an attemptedAt is ambiguous: the
   * request may have reached the supplier and only the outcome write was lost. Such a row
   * must never be auto-re-sent (see OrdersService.retrySupplierOrder).
   */
  @ApiProperty({
    description:
      'Момент начала обращения к поставщику (пишется ДО вызова API). NEW + attemptedAt = неизвестно, дошёл ли заказ — повтор запрещён.',
    required: false,
    nullable: true,
  })
  @Column({ type: 'timestamp', nullable: true, default: null })
  attemptedAt: Date | null;

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
