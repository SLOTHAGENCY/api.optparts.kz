import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('news')
export class News {
  @ApiProperty({ example: 'b3f1...uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'Появились запчасти на китайские авто' })
  @Column({ length: 255 })
  title: string;

  @ApiProperty({ example: '<b>Огромный ассортимент</b> деталей...', description: 'HTML-контент новости' })
  @Column({ type: 'text' })
  body: string;

  @ApiProperty({ example: 'https://.../cover.jpg', nullable: true })
  @Column({ type: 'varchar', length: 1024, nullable: true, default: null })
  coverImage: string | null;

  @ApiProperty({ example: '2026-07-03T10:00:00.000Z' })
  @Column({ type: 'timestamp', default: () => 'now()' })
  publishedAt: Date;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
