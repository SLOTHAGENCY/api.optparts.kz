import {
  Entity, PrimaryGeneratedColumn, Column, OneToOne,
  JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Order } from '../../orders/entities/order.entity';
import { decimalTransformer } from '../../suppliers/entities/supplier.entity';

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

export const PaymentStatusLabel: Record<PaymentStatus, string> = {
  [PaymentStatus.PENDING]: 'Ожидает оплаты',
  [PaymentStatus.PAID]: 'Оплачен',
  [PaymentStatus.FAILED]: 'Отклонён',
  [PaymentStatus.REFUNDED]: 'Возвращён',
  [PaymentStatus.PARTIALLY_REFUNDED]: 'Возвращён частично',
};

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn()
  order: Order;

  @Column()
  orderId: string;

  @ApiProperty({ description: 'Номер счёта, известный TipTopPay и клиенту', example: 'OP-A1B2C3D4' })
  @Column({ type: 'varchar', length: 64, unique: true })
  invoiceId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, transformer: decimalTransformer })
  amount: number;

  @Column({ type: 'varchar', length: 8, default: 'KZT' })
  currency: string;

  @Column({ type: 'varchar', default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  transactionId: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true, default: null })
  cardLastFour: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  cardType: string | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  refundedAmount: number;

  @Column({ type: 'text', nullable: true, default: null })
  failReason: string | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  paidAt: Date | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  raw: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** How much of this payment can still be refunded. */
  get refundableAmount(): number {
    return Number(this.amount) - Number(this.refundedAmount);
  }

  get statusLabel(): string {
    return PaymentStatusLabel[this.status];
  }
}
