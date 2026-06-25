import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendOrderItemSnapshot1700000000010 implements MigrationInterface {
  name = 'ExtendOrderItemSnapshot1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
        ADD COLUMN "supplierCode" varchar(100)  DEFAULT NULL,
        ADD COLUMN "article"      varchar(100)  DEFAULT NULL,
        ADD COLUMN "brand"        varchar(100)  DEFAULT NULL,
        ADD COLUMN "costPrice"    numeric(12,2) DEFAULT NULL,
        ADD COLUMN "sellPrice"    numeric(12,2) DEFAULT NULL,
        ADD COLUMN "warehouseId"  varchar(100)  DEFAULT NULL,
        ADD COLUMN "raw"          jsonb         DEFAULT NULL
    `);
    // productId is already nullable (created with DEFAULT NULL); ensure it explicitly.
    await queryRunner.query(
      `ALTER TABLE "order_items" ALTER COLUMN "productId" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
        DROP COLUMN "supplierCode",
        DROP COLUMN "article",
        DROP COLUMN "brand",
        DROP COLUMN "costPrice",
        DROP COLUMN "sellPrice",
        DROP COLUMN "warehouseId",
        DROP COLUMN "raw"
    `);
  }
}
