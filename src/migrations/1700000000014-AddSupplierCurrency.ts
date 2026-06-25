import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupplierCurrency1700000000014 implements MigrationInterface {
  name = 'AddSupplierCurrency1700000000014';
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" ADD "currency" character varying(8)`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "currency"`);
  }
}
