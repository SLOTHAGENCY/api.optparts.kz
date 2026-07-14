import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { SupplierOrder } from './entities/supplier-order.entity';
import { OrdersService } from './orders.service';
import { OrderStatusCron } from './order-status.cron';
import { OrdersController } from './orders.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PartnerProductsModule } from '../partner-products/partner-products.module';
import { CartModule } from '../cart/cart.module';
import { CartService } from '../cart/cart.service';
import { CART_CHECKOUT } from './cart-checkout.contract';
import { AddressesModule } from '../addresses/addresses.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, SupplierOrder]),
    SuppliersModule,
    PartnerProductsModule,
    CartModule,
    AddressesModule,
    SettingsModule,
  ],
  providers: [
    OrdersService,
    OrderStatusCron,
    // Cart checkout seam (Spec B): backed by the real CartService once merged.
    { provide: CART_CHECKOUT, useExisting: CartService },
  ],
  controllers: [OrdersController],
  // PaymentsModule injects OrdersService to place the order once the Pay webhook lands.
  exports: [OrdersService],
})
export class OrdersModule {}
