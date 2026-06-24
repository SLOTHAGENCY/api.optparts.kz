import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Cart } from './cart.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('cart_items')
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn()
  cart: Cart;

  @Column()
  cartId: string;

  // Own product — kept for future self-catalog offers; null for aggregator offers.
  @ManyToOne(() => Product, { eager: true, onDelete: 'CASCADE', nullable: true })
  @JoinColumn()
  product: Product | null;

  @Column({ type: 'uuid', nullable: true })
  productId: string | null;

  // --- aggregator offer snapshot ---
  @Column({ type: 'varchar', nullable: true })
  supplierCode: string;

  @Column({ type: 'varchar', nullable: true })
  article: string;

  @Column({ type: 'varchar', nullable: true })
  brand: string;

  @Column({ type: 'varchar', nullable: true })
  productName: string;

  // sellPrice at the moment of adding (TypeORM returns decimals as strings).
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  priceAtAdd: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  costPrice: string;

  @Column({ type: 'varchar', nullable: true })
  warehouseId: string;

  // Raw offer identifier (from search) needed for placeOrder.
  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown>;
  // --- end snapshot ---

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
