import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateSearchLog1700000000008 implements MigrationInterface {
  name = 'CreateSearchLog1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'search_log',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'userId', type: 'uuid', isNullable: true, default: null },
          { name: 'article', type: 'varchar', length: '255' },
          { name: 'brand', type: 'varchar', length: '255', isNullable: true, default: null },
          { name: 'totalResults', type: 'int' },
          { name: 'suppliersQueried', type: 'int' },
          { name: 'suppliersFailed', type: 'int' },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'search_log',
      new TableIndex({ name: 'IDX_search_log_createdAt', columnNames: ['createdAt'] }),
    );
    await queryRunner.createIndex(
      'search_log',
      new TableIndex({ name: 'IDX_search_log_article', columnNames: ['article'] }),
    );
    await queryRunner.createIndex(
      'search_log',
      new TableIndex({ name: 'IDX_search_log_userId', columnNames: ['userId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('search_log');
  }
}
