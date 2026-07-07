import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNews1700000000020 implements MigrationInterface {
  name = 'CreateNews1700000000020';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "news" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(255) NOT NULL,
        "body" text NOT NULL,
        "coverImage" character varying(1024),
        "publishedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_news" PRIMARY KEY ("id")
      )
    `);
    await q.query(`CREATE INDEX "IDX_news_publishedAt" ON "news" ("publishedAt")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "IDX_news_publishedAt"`);
    await q.query(`DROP TABLE "news"`);
  }
}
