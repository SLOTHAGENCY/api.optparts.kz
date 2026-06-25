import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderTestMode1700000000016 implements MigrationInterface {
  name = 'AddOrderTestMode1700000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "isTest" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "supplier_orders" ADD "isTest" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "supplier_orders" DROP COLUMN "isTest"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "isTest"`);
  }
}
