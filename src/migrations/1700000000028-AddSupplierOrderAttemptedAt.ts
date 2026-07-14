import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupplierOrderAttemptedAt1700000000028
  implements MigrationInterface
{
  name = 'AddSupplierOrderAttemptedAt1700000000028';

  public async up(q: QueryRunner): Promise<void> {
    // Written BEFORE the connector call, so a NEW row that carries it may already be at
    // the supplier (the outcome write could have been lost) and must not be re-sent.
    await q.query(`ALTER TABLE "supplier_orders" ADD "attemptedAt" TIMESTAMP`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "supplier_orders" DROP COLUMN "attemptedAt"`);
  }
}
