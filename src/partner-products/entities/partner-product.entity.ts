import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Unique,
  CreateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { decimalTransformer } from '../../suppliers/entities/supplier.entity';

@Entity('partner_products')
@Unique('UQ_partner_products_offer', ['supplierCode', 'article', 'brand'])
export class PartnerProduct {
  @ApiProperty({ description: 'Уникальный идентификатор записи' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Код поставщика' })
  @Column({ length: 100 })
  supplierCode: string;

  @ApiProperty({ description: 'Артикул (номер) детали' })
  @Column({ length: 100 })
  article: string;

  @ApiProperty({ description: 'Бренд (производитель)' })
  @Column({ length: 100 })
  brand: string;

  @ApiProperty({ description: 'Название товара' })
  @Column({ length: 255 })
  name: string;

  @ApiProperty({ description: 'Когда товар впервые встретился в выдаче поставщика' })
  @CreateDateColumn()
  firstSeenAt: Date;

  @ApiProperty({ description: 'Когда товар последний раз встречался в выдаче поставщика' })
  @Column({ type: 'timestamp', default: () => 'now()' })
  lastSeenAt: Date;

  @ApiProperty({ description: 'Последняя известная закупочная цена (может отсутствовать)', type: Number, nullable: true })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  lastKnownCostPrice: number | null;

  @ApiProperty({ description: 'Последняя известная цена продажи (может отсутствовать)', type: Number, nullable: true })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  lastKnownSellPrice: number | null;

  @ApiProperty({ description: 'Сколько раз этот товар заказывали' })
  @Column({ type: 'int', default: 0 })
  timesOrdered: number;
}
