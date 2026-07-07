import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecipientFields1700000000022 implements MigrationInterface {
  name = 'AddOrderRecipientFields1700000000022';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "orders" ADD "recipientName" character varying(150)`,
    );
    await q.query(
      `ALTER TABLE "orders" ADD "recipientPhone" character varying(32)`,
    );
    await q.query(`ALTER TABLE "orders" ADD "customerComment" text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" DROP COLUMN "customerComment"`);
    await q.query(`ALTER TABLE "orders" DROP COLUMN "recipientPhone"`);
    await q.query(`ALTER TABLE "orders" DROP COLUMN "recipientName"`);
  }
}
