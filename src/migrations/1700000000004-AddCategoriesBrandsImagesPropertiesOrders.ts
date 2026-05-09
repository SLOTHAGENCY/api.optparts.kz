import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoriesBrandsImagesPropertiesOrders1700000000004 implements MigrationInterface {
  name = 'AddCategoriesBrandsImagesPropertiesOrders1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "name"        varchar(100)  NOT NULL,
        "description" varchar       DEFAULT NULL,
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_categories_name" UNIQUE ("name"),
        CONSTRAINT "PK_categories" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "brands" (
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "name"        varchar(100)  NOT NULL,
        "description" varchar       DEFAULT NULL,
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_brands_name" UNIQUE ("name"),
        CONSTRAINT "PK_brands" PRIMARY KEY ("id")
      )
    `);

    // Drop old string-based images column and add FK columns to products
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "images"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "brand"`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN "categoryId" uuid DEFAULT NULL`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN "brandId"    uuid DEFAULT NULL`);
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD CONSTRAINT "FK_products_categories" FOREIGN KEY ("categoryId")
          REFERENCES "categories"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_products_brands" FOREIGN KEY ("brandId")
          REFERENCES "brands"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "product_images" (
        "id"        uuid     NOT NULL DEFAULT uuid_generate_v4(),
        "filepath"  varchar  NOT NULL,
        "order"     int      NOT NULL DEFAULT 0,
        "productId" uuid     NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_images" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_images_products" FOREIGN KEY ("productId")
          REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "product_properties" (
        "id"        uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "key"       varchar(100)  NOT NULL,
        "value"     varchar(500)  NOT NULL,
        "productId" uuid          NOT NULL,
        "createdAt" TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_properties" PRIMARY KEY ("id"),
        CONSTRAINT "FK_product_properties_products" FOREIGN KEY ("productId")
          REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id"          uuid            NOT NULL DEFAULT uuid_generate_v4(),
        "userId"      uuid            NOT NULL,
        "addressId"   uuid            DEFAULT NULL,
        "status"      varchar         NOT NULL DEFAULT 'new',
        "totalAmount" numeric(10,2)   NOT NULL DEFAULT 0,
        "createdAt"   TIMESTAMP       NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_orders_users" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_orders_addresses" FOREIGN KEY ("addressId")
          REFERENCES "addresses"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id"          uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "orderId"     uuid          NOT NULL,
        "productId"   uuid          DEFAULT NULL,
        "productName" varchar(255)  NOT NULL,
        "productSku"  varchar(100)  NOT NULL,
        "priceAtOrder" numeric(10,2) NOT NULL,
        "quantity"    int           NOT NULL,
        "subtotal"    numeric(10,2) NOT NULL,
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_items_orders" FOREIGN KEY ("orderId")
          REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_items_products" FOREIGN KEY ("productId")
          REFERENCES "products"("id") ON DELETE SET NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TABLE "product_properties"`);
    await queryRunner.query(`DROP TABLE "product_images"`);
    await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "FK_products_categories"`);
    await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "FK_products_brands"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "categoryId"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "brandId"`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN "images" text NOT NULL DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN "brand"  varchar(100) NOT NULL DEFAULT ''`);
    await queryRunner.query(`DROP TABLE "brands"`);
    await queryRunner.query(`DROP TABLE "categories"`);
  }
}