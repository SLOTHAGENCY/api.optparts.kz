import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSupplierDeliveryBuffer1700000000015 implements MigrationInterface {
  name = 'AddSupplierDeliveryBuffer1700000000015';
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" ADD "deliveryBufferDays" integer`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN "deliveryBufferDays"`);
  }
}
