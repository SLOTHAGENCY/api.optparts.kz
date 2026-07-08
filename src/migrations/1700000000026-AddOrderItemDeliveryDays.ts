import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderItemDeliveryDays1700000000026
  implements MigrationInterface
{
  name = 'AddOrderItemDeliveryDays1700000000026';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "order_items" ADD "deliveryDays" integer`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "order_items" DROP COLUMN "deliveryDays"`);
  }
}
