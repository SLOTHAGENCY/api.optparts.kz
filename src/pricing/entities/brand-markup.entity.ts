import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { decimalTransformer } from '../../suppliers/entities/supplier.entity';

@Entity('brand_markups')
export class BrandMarkup {
  @ApiProperty({ example: 'b3f1...uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'BOSCH', description: 'Stored uppercased/trimmed; unique' })
  @Column({ unique: true, length: 100 })
  brand: string;

  @ApiProperty({ example: 25, description: 'Markup percent applied to offers of this brand' })
  @Column({ type: 'decimal', precision: 6, scale: 2, transformer: decimalTransformer })
  markupPercent: number;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
