import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateBrandMarkups1700000000016 implements MigrationInterface {
  name = 'CreateBrandMarkups1700000000016';
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "brand_markups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "brand" character varying(100) NOT NULL,
        "markupPercent" numeric(6,2) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_brand_markups_brand" UNIQUE ("brand"),
        CONSTRAINT "PK_brand_markups" PRIMARY KEY ("id")
      )`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "brand_markups"`);
  }
}
