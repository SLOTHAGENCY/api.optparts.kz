import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAppSettings1700000000013 implements MigrationInterface {
  name = 'CreateAppSettings1700000000013';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "app_settings" (
        "key" character varying(100) NOT NULL,
        "value" jsonb NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_settings" PRIMARY KEY ("key")
      )
    `);
    await q.query(`
      INSERT INTO "app_settings" ("key","value") VALUES
        ('DEFAULT_MARKUP_PERCENT', '20'::jsonb),
        ('FX_RATES', '{"KZT":1}'::jsonb),
        ('FX_BUFFER_PERCENT', '0'::jsonb)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "app_settings"`);
  }
}
