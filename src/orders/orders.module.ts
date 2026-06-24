import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { SupplierOrder } from './entities/supplier-order.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PartnerProductsModule } from '../partner-products/partner-products.module';
import { CART_CHECKOUT, CartCheckoutStub } from './cart-checkout.contract';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, SupplierOrder]),
    SuppliersModule,
    PartnerProductsModule,
  ],
  providers: [
    OrdersService,
    // MERGE: replace with { provide: CART_CHECKOUT, useExisting: CartService }
    // and import CartModule once Spec B is merged.
    { provide: CART_CHECKOUT, useClass: CartCheckoutStub },
  ],
  controllers: [OrdersController],
})
export class OrdersModule {}
