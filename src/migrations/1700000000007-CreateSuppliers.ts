import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateSuppliers1700000000007 implements MigrationInterface {
  name = 'CreateSuppliers1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'suppliers',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'code', type: 'varchar', length: '100', isUnique: true },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'isActive', type: 'boolean', default: true },
          {
            name: 'markupPercent',
            type: 'decimal',
            precision: 6,
            scale: 2,
            isNullable: true,
            default: null,
          },
          { name: 'config', type: 'jsonb', default: "'{}'" },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    // Seed Rossko partner (markupPercent NULL => global DEFAULT_MARKUP_PERCENT).
    await queryRunner.query(
      `INSERT INTO suppliers (code, name, "isActive", "markupPercent", config)
       VALUES ('rossko', 'Rossko', true, NULL, '{}')
       ON CONFLICT (code) DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('suppliers');
  }
}
