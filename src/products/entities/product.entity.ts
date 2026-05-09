import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { Category } from '../../categories/entities/category.entity';
import { Brand } from '../../brands/entities/brand.entity';
import { ProductImage } from './product-image.entity';
import { ProductProperty } from './product-property.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 100 })
  sku: string;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  price: number;

  @ManyToOne(() => Category, (category) => category.products, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  category: Category;

  @Column({ nullable: true })
  categoryId: string;

  @ManyToOne(() => Brand, (brand) => brand.products, { eager: true, nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  brand: Brand;

  @Column({ nullable: true })
  brandId: string;

  @OneToMany(() => ProductImage, (img) => img.product, { cascade: true, eager: true })
  images: ProductImage[];

  @OneToMany(() => ProductProperty, (prop) => prop.product, { cascade: true, eager: true })
  properties: ProductProperty[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}