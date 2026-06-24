import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** TypeORM returns decimal columns as strings; normalize to number|null. */
export const decimalTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 100 })
  code: string;

  @Column({ length: 255 })
  name: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
    default: null,
    transformer: decimalTransformer,
  })
  markupPercent: number | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
