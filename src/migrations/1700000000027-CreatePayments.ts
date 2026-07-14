import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePayments1700000000027 implements MigrationInterface {
  name = 'CreatePayments1700000000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "orderId" uuid NOT NULL,
        "invoiceId" character varying(64) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "currency" character varying(8) NOT NULL DEFAULT 'KZT',
        "status" character varying NOT NULL DEFAULT 'pending',
        "transactionId" character varying(64),
        "cardLastFour" character varying(4),
        "cardType" character varying(32),
        "refundedAmount" numeric(12,2) NOT NULL DEFAULT '0',
        "failReason" text,
        "paidAt" TIMESTAMP,
        "raw" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_payments_invoiceId" UNIQUE ("invoiceId"),
        CONSTRAINT "UQ_payments_orderId" UNIQUE ("orderId"),
        CONSTRAINT "PK_payments" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD CONSTRAINT "FK_payments_order"
      FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE TABLE "payment_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" character varying(16) NOT NULL,
        "invoiceId" character varying(64),
        "transactionId" character varying(64),
        "hmacValid" boolean NOT NULL DEFAULT false,
        "body" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_payment_events_type_transaction"
      ON "payment_events" ("type", "transactionId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_payment_events_type_transaction"`);
    await queryRunner.query(`DROP TABLE "payment_events"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_payments_order"`);
    await queryRunner.query(`DROP TABLE "payments"`);
  }
}
