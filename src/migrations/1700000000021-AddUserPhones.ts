import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPhones1700000000021 implements MigrationInterface {
  name = 'AddUserPhones1700000000021';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "users" ADD "phones" text NOT NULL DEFAULT ''`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" DROP COLUMN "phones"`);
  }
}
