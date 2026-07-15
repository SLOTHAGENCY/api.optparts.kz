import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentEvent } from './entities/payment-event.entity';
import { Order } from '../orders/entities/order.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { TipTopPayClient } from './tiptoppay.client';
import { UnpaidOrdersCron } from './unpaid-orders.cron';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, PaymentEvent, Order]),
    OrdersModule,
  ],
  providers: [
    PaymentsService,
    UnpaidOrdersCron,
    { provide: TipTopPayClient, useFactory: () => new TipTopPayClient() },
  ],
  controllers: [PaymentsController, PaymentsWebhookController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
