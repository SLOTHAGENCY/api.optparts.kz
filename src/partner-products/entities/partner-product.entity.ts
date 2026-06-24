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
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ length: 100 })
  supplierCode: string;

  @ApiProperty()
  @Column({ length: 100 })
  article: string;

  @ApiProperty()
  @Column({ length: 100 })
  brand: string;

  @ApiProperty()
  @Column({ length: 255 })
  name: string;

  @ApiProperty()
  @CreateDateColumn()
  firstSeenAt: Date;

  @ApiProperty()
  @Column({ type: 'timestamp', default: () => 'now()' })
  lastSeenAt: Date;

  @ApiProperty({ type: Number, nullable: true })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  lastKnownCostPrice: number | null;

  @ApiProperty({ type: Number, nullable: true })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  lastKnownSellPrice: number | null;

  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  timesOrdered: number;
}
