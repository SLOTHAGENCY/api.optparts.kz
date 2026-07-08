import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateCatalogNameIndex1700000000025 implements MigrationInterface {
  name = 'CreateCatalogNameIndex1700000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'catalog_name_index',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'uuid_generate_v4()' },
          { name: 'kind', type: 'varchar', length: '16', isNullable: false },
          { name: 'catalogId', type: 'varchar', isNullable: false },
          { name: 'groupId', type: 'varchar', isNullable: true, default: null },
          { name: 'name', type: 'varchar', isNullable: false },
          { name: 'parentName', type: 'varchar', isNullable: true, default: null },
          { name: 'lang', type: 'varchar', isNullable: false, default: "'ru'" },
          { name: 'norm', type: 'varchar', isNullable: false },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()', isNullable: false },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'catalog_name_index',
      new TableIndex({ name: 'IDX_cat_name_idx_lang_kind', columnNames: ['lang', 'kind'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('catalog_name_index');
  }
}
