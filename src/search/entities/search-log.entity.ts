import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('search_log')
export class SearchLog {
  @ApiProperty({ example: 'b3f1...uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ nullable: true, description: 'Author of the search, null for anonymous' })
  @Index()
  @Column({ type: 'uuid', nullable: true, default: null })
  userId: string | null;

  @ApiProperty({ example: '0451103316' })
  @Index()
  @Column({ length: 255 })
  article: string;

  @ApiProperty({ example: 'BOSCH', nullable: true })
  @Column({ length: 255, nullable: true, default: null })
  brand: string | null;

  @ApiProperty({ example: 3, description: 'Total offers returned (exact + analogs)' })
  @Column({ type: 'int' })
  totalResults: number;

  @ApiProperty({ example: 2, description: 'Active suppliers queried' })
  @Column({ type: 'int' })
  suppliersQueried: number;

  @ApiProperty({ example: 1, description: 'Suppliers that failed or timed out' })
  @Column({ type: 'int' })
  suppliersFailed: number;

  @ApiProperty()
  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
