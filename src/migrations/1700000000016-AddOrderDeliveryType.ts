import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddOrderDeliveryType1700000000016 implements MigrationInterface {
  name = 'AddOrderDeliveryType1700000000016';
  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "orders" ADD "deliveryType" character varying NOT NULL DEFAULT 'delivery'`,
    );
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" DROP COLUMN "deliveryType"`);
  }
}
