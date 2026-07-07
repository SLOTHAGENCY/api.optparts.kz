import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddSearchLogQueryType1700000000023 implements MigrationInterface {
  name = 'AddSearchLogQueryType1700000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'search_log',
      new TableColumn({
        name: 'queryType',
        type: 'varchar',
        length: '16',
        default: "'article'",
        isNullable: false,
      }),
    );

    await queryRunner.createIndex(
      'search_log',
      new TableIndex({ name: 'IDX_search_log_queryType', columnNames: ['queryType'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('search_log', 'IDX_search_log_queryType');
    await queryRunner.dropColumn('search_log', 'queryType');
  }
}
