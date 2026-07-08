import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Плоский снимок категорий и подгрупп PartsIndex для поиска по названию.
 * Не источник правды — целиком перестраивается кроном NameIndexBuilder
 * (delete-by-lang + insert в транзакции). norm — стеммленая форма для матчинга.
 */
@Entity('catalog_name_index')
@Index(['lang', 'kind'])
export class CatalogNameIndex {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: 'category' | 'group';

  @Column()
  catalogId: string;

  @Column({ type: 'varchar', nullable: true, default: null })
  groupId: string | null;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true, default: null })
  parentName: string | null;

  @Column({ default: 'ru' })
  lang: string;

  @Column()
  norm: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
