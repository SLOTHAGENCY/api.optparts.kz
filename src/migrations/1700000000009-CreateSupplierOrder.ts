import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupplierOrder1700000000009 implements MigrationInterface {
  name = 'CreateSupplierOrder1700000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "supplier_orders" (
        "id"               uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "orderId"          uuid          NOT NULL,
        "supplierCode"     varchar(100)  NOT NULL,
        "externalOrderId"  varchar(255)  DEFAULT NULL,
        "status"           varchar       NOT NULL DEFAULT 'NEW',
        "errorMessage"     text          DEFAULT NULL,
        "returnStatus"     varchar(50)   DEFAULT NULL,
        "externalReturnId" varchar(255)  DEFAULT NULL,
        "createdAt"        TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_supplier_orders_orders" FOREIGN KEY ("orderId")
          REFERENCES "orders"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_supplier_orders_orderId" ON "supplier_orders" ("orderId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "supplier_orders"`);
  }
}
