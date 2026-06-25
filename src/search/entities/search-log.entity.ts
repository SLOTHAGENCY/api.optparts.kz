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
  @ApiProperty({ description: 'Идентификатор записи', example: 'b3f1...uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Кто выполнил поиск; null — для анонимного (неавторизованного) пользователя', nullable: true })
  @Index()
  @Column({ type: 'uuid', nullable: true, default: null })
  userId: string | null;

  @ApiProperty({ description: 'Артикул, который искали', example: '0451103316' })
  @Index()
  @Column({ length: 255 })
  article: string;

  @ApiProperty({ description: 'Бренд, который искали (если был указан)', example: 'BOSCH', nullable: true })
  @Column({ length: 255, nullable: true, default: null })
  brand: string | null;

  @ApiProperty({ description: 'Сколько всего предложений вернул поиск (точные + аналоги)', example: 3 })
  @Column({ type: 'int' })
  totalResults: number;

  @ApiProperty({ description: 'Сколько активных поставщиков было опрошено', example: 2 })
  @Column({ type: 'int' })
  suppliersQueried: number;

  @ApiProperty({ description: 'Сколько поставщиков не ответили или ответили с ошибкой', example: 1 })
  @Column({ type: 'int' })
  suppliersFailed: number;

  @ApiProperty({ description: 'Дата и время поиска' })
  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
