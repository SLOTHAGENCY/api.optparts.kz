import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderComment1700000000006 implements MigrationInterface {
  name = 'AddOrderComment1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE orders
        ADD COLUMN managerComment TEXT    DEFAULT NULL,
        ADD COLUMN commentedBy    CHAR(36) DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN managerComment`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN commentedBy`);
  }
}