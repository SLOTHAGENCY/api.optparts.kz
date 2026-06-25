import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { CartModule } from './cart/cart.module';
import { DocsModule } from './docs/docs.module';
import { AddressesModule } from './addresses/addresses.module';
import { Address } from './addresses/entities/address.entity';
import { User } from './users/entities/user.entity';
import { Product } from './products/entities/product.entity';
import { Cart } from './cart/entities/cart.entity';
import { CartItem } from './cart/entities/cart-item.entity';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CategoriesModule } from './categories/categories.module';
import { BrandsModule } from './brands/brands.module';
import { OrdersModule } from './orders/orders.module';
import { Category } from './categories/entities/category.entity';
import { Brand } from './brands/entities/brand.entity';
import { ProductImage } from './products/entities/product-image.entity';
import { ProductProperty } from './products/entities/product-property.entity';
import { Order } from './orders/entities/order.entity';
import { OrderItem } from './orders/entities/order-item.entity';
import { RosskoModule } from './rossko/rossko.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PricingModule } from './pricing/pricing.module';
import { SearchModule } from './search/search.module';
import { Supplier } from './suppliers/entities/supplier.entity';
import { SearchLog } from './search/entities/search-log.entity';
import { SupplierOrder } from './orders/entities/supplier-order.entity';
import { PartnerProduct } from './partner-products/entities/partner-product.entity';
import { PartnerProductsModule } from './partner-products/partner-products.module';
import { AppSetting } from './settings/entities/app-setting.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'nestjs_auth',
        entities: [User, Product, ProductImage, ProductProperty, Cart, CartItem, Address, Category, Brand, Order, OrderItem, Supplier, SearchLog, SupplierOrder, PartnerProduct, AppSetting],
        migrations: ['dist/migrations/*.js'],
        synchronize: process.env.NODE_ENV === 'development',
        logging: process.env.NODE_ENV === 'development',
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),
    // TEST FRONTEND — удалить вместе с папкой test-frontend/
    ...(process.env.SERVE_TEST_FRONTEND === 'true'
      ? [
          ServeStaticModule.forRoot({
            rootPath: join(__dirname, '..', 'test-frontend'),
            serveRoot: '/test',
          }),
        ]
      : []),
    AddressesModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    CartModule,
    DocsModule,
    CategoriesModule,
    BrandsModule,
    OrdersModule,
    PartnerProductsModule,
    RosskoModule,
    SuppliersModule,
    PricingModule,
    SearchModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        validationError: { target: false },
      }),
    },
  ],
})
export class AppModule {}
