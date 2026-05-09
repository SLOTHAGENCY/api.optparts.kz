import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAddresses1700000000002 implements MigrationInterface {
  name = 'CreateAddresses1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "addresses" (
        "id"        uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "title"     varchar(100)  NOT NULL,
        "street"    varchar(255)  NOT NULL,
        "city"      varchar(100)  NOT NULL,
        "postcode"  varchar(20)   NOT NULL,
        "main"      boolean       NOT NULL DEFAULT false,
        "userId"    uuid          NOT NULL,
        "createdAt" TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_addresses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_addresses_users" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "addresses"`);
  }
}