import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasswordResets1700000000029 implements MigrationInterface {
  name = 'CreatePasswordResets1700000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "password_resets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "tokenHash" character varying(64) NOT NULL,
        "expiresAt" TIMESTAMP NOT NULL,
        "usedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_password_resets" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "password_resets"
      ADD CONSTRAINT "FK_password_resets_user"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_password_resets_tokenHash"
      ON "password_resets" ("tokenHash")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_password_resets_tokenHash"`);
    await queryRunner.query(`ALTER TABLE "password_resets" DROP CONSTRAINT "FK_password_resets_user"`);
    await queryRunner.query(`DROP TABLE "password_resets"`);
  }
}
