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
  @ApiProperty({ example: 'b3f1...uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'rossko', description: 'Unique partner code' })
  @Column({ unique: true, length: 100 })
  code: string;

  @ApiProperty({ example: 'Rossko' })
  @Column({ length: 255 })
  name: string;

  @ApiProperty({ example: true })
  @Column({ default: true })
  isActive: boolean;

  @ApiProperty({ example: 20, nullable: true, description: 'null => DEFAULT_MARKUP_PERCENT' })
  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
    default: null,
    transformer: decimalTransformer,
  })
  markupPercent: number | null;

  @ApiProperty({ example: {}, description: 'Non-sensitive partner config' })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, unknown>;

  @ApiProperty({ example: '2025-06-24T10:00:00Z' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ example: '2025-06-24T10:00:00Z' })
  @UpdateDateColumn()
  updatedAt: Date;
}
