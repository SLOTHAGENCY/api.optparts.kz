import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCartItemSnapshot1700000000008 implements MigrationInterface {
  name = 'AddCartItemSnapshot1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Aggregator offers have no own product — productId becomes optional.
    // FK on productId is intentionally left in place (kept for future own products).
    await queryRunner.query(
      `ALTER TABLE "cart_items" ALTER COLUMN "productId" DROP NOT NULL`,
    );

    await queryRunner.addColumns('cart_items', [
      new TableColumn({ name: 'supplierCode', type: 'varchar', length: '100', isNullable: true }),
      new TableColumn({ name: 'article', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'brand', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'productName', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'priceAtAdd', type: 'decimal', precision: 12, scale: 2, isNullable: true }),
      new TableColumn({ name: 'costPrice', type: 'decimal', precision: 12, scale: 2, isNullable: true }),
      new TableColumn({ name: 'warehouseId', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'raw', type: 'jsonb', isNullable: true }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('cart_items', [
      'supplierCode',
      'article',
      'brand',
      'productName',
      'priceAtAdd',
      'costPrice',
      'warehouseId',
      'raw',
    ]);
    await queryRunner.query(
      `ALTER TABLE "cart_items" ALTER COLUMN "productId" SET NOT NULL`,
    );
  }
}
