import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

/** TypeORM returns decimal columns as strings; normalize to number|null. */
export const decimalTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};

@Entity('suppliers')
export class Supplier {
  @ApiProperty({ description: 'Идентификатор поставщика', example: 'b3f1...uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Уникальный код поставщика', example: 'rossko' })
  @Column({ unique: true, length: 100 })
  code: string;

  @ApiProperty({ description: 'Название поставщика', example: 'Rossko' })
  @Column({ length: 255 })
  name: string;

  @ApiProperty({ description: 'Участвует ли поставщик в поиске', example: true })
  @Column({ default: true })
  isActive: boolean;

  @ApiProperty({ description: 'Процент наценки поставщика; null означает «использовать наценку по умолчанию»', example: 20, nullable: true })
  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
    default: null,
    transformer: decimalTransformer,
  })
  markupPercent: number | null;

  @ApiProperty({ description: 'Код валюты поставщика по стандарту ISO-4217', example: 'KZT', nullable: true })
  @Column({ type: 'varchar', length: 8, nullable: true })
  currency: string | null;

  @ApiProperty({ description: 'Дополнительные дни, добавляемые к сроку доставки предложений этого поставщика', example: 2, nullable: true })
  @Column({ type: 'int', nullable: true })
  deliveryBufferDays: number | null;

  @ApiProperty({ description: 'Несекретные настройки подключения поставщика', example: {} })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, unknown>;

  @ApiProperty({ description: 'Дата создания записи', example: '2025-06-24T10:00:00Z' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: 'Дата последнего изменения записи', example: '2025-06-24T10:00:00Z' })
  @UpdateDateColumn()
  updatedAt: Date;
}
