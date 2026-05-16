import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryTree1700000000005 implements MigrationInterface {
  name = 'AddCategoryTree1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" ADD COLUMN "parentId" UUID DEFAULT NULL`);
    await queryRunner.query(`ALTER TABLE "categories" ADD COLUMN "level"    INT  NOT NULL DEFAULT 1`);
    await queryRunner.query(`
      ALTER TABLE "categories"
        ADD CONSTRAINT "FK_categories_parent"
          FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "categories" DROP CONSTRAINT "FK_categories_parent"`);
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "parentId"`);
    await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "level"`);
  }
}