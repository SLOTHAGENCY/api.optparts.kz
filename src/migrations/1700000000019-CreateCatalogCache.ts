import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateCatalogCache1700000000019 implements MigrationInterface {
  name = 'CreateCatalogCache1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'catalog_cache',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'uuid_generate_v4()' },
          { name: 'provider', type: 'varchar', length: '32' },
          { name: 'endpoint', type: 'varchar', length: '255' },
          { name: 'paramsHash', type: 'varchar', length: '64' },
          { name: 'payload', type: 'jsonb' },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'expiresAt', type: 'timestamp' },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'catalog_cache',
      new TableIndex({
        name: 'UQ_catalog_cache_key',
        columnNames: ['provider', 'endpoint', 'paramsHash'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'catalog_cache',
      new TableIndex({ name: 'IDX_catalog_cache_expiresAt', columnNames: ['expiresAt'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('catalog_cache');
  }
}
