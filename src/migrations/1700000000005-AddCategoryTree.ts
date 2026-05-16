import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryTree1700000000005 implements MigrationInterface {
  name = 'AddCategoryTree1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE categories
        ADD COLUMN parentId CHAR(36) DEFAULT NULL,
        ADD COLUMN \`level\` INT NOT NULL DEFAULT 1,
        ADD CONSTRAINT FK_categories_parent
          FOREIGN KEY (parentId) REFERENCES categories(id) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE categories DROP FOREIGN KEY FK_categories_parent`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN parentId`);
    await queryRunner.query(`ALTER TABLE categories DROP COLUMN \`level\``);
  }
}