import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSupplierApiConfig1700000000017 implements MigrationInterface {
  name = 'AddSupplierApiConfig1700000000017';
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" ADD "timeoutMs" integer`);
    await q.query(`ALTER TABLE "suppliers" ADD "rateLimitRpm" integer`);
    await q.query(`ALTER TABLE "suppliers" ADD "secretsEnc" text`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "secretsEnc"`);
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "rateLimitRpm"`);
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "timeoutMs"`);
  }
}
