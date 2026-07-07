import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVehicles1700000000024 implements MigrationInterface {
  name = 'CreateVehicles1700000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "vehicles" (
        "id"        uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "vin"       varchar(32)   NOT NULL,
        "make"      varchar(100),
        "model"     varchar(100),
        "year"      integer,
        "trim"      varchar(120),
        "main"      boolean       NOT NULL DEFAULT false,
        "userId"    uuid          NOT NULL,
        "createdAt" TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vehicles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vehicles_users" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "vehicles"`);
  }
}
