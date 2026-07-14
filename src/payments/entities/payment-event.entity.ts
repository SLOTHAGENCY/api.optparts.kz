import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type PaymentEventType = 'check' | 'pay' | 'fail' | 'refund';

/**
 * Append-only log of every webhook TipTopPay sends us.
 *
 * Two jobs:
 *  1. Idempotency — TipTopPay retries webhooks; (type, transactionId) tells us whether
 *     we already acted on this one, so a retried Pay never places the order twice.
 *  2. Audit — hmacValid=false rows are attempted payment forgeries; keep them.
 */
@Entity('payment_events')
@Index(['type', 'transactionId'])
export class PaymentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  type: PaymentEventType;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  invoiceId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  transactionId: string | null;

  @Column({ type: 'boolean', default: false })
  hmacValid: boolean;

  @Column({ type: 'jsonb', nullable: true, default: null })
  body: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
