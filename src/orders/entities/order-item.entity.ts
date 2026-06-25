import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from '../../products/entities/product.entity';
import { decimalTransformer } from '../../suppliers/entities/supplier.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn()
  order: Order;

  @Column()
  orderId: string;

  // Not eager: aggregator items have productId=null; eager-loading Product pulls
  // the self-referential Category tree and recurses. Load explicitly if ever needed.
  @ManyToOne(() => Product, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn()
  product: Product;

  @Column({ nullable: true })
  productId: string | null;

  // Snapshot fields — locked at time of order
  @Column({ length: 255 })
  productName: string;

  @Column({ length: 100 })
  productSku: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceAtOrder: number;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;

  // --- Aggregator offer snapshot (Spec C). Nullable: legacy product items leave these null. ---
  @Column({ type: 'varchar', length: 100, nullable: true })
  supplierCode: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  article: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  brand: string | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  costPrice: number | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  sellPrice: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  warehouseId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}