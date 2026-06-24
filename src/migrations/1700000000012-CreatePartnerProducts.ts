import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePartnerProducts1700000000012 implements MigrationInterface {
  name = 'CreatePartnerProducts1700000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "partner_products" (
        "id"                 uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "supplierCode"       varchar(100)  NOT NULL,
        "article"            varchar(100)  NOT NULL,
        "brand"              varchar(100)  NOT NULL,
        "name"               varchar(255)  NOT NULL,
        "firstSeenAt"        TIMESTAMP     NOT NULL DEFAULT now(),
        "lastSeenAt"         TIMESTAMP     NOT NULL DEFAULT now(),
        "lastKnownCostPrice" numeric(12,2) DEFAULT NULL,
        "lastKnownSellPrice" numeric(12,2) DEFAULT NULL,
        "timesOrdered"       int           NOT NULL DEFAULT 0,
        CONSTRAINT "PK_partner_products" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_partner_products_offer" UNIQUE ("supplierCode", "article", "brand")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "partner_products"`);
  }
}
