import { Payment, PaymentStatus } from './payment.entity';
import { PaymentEvent } from './payment-event.entity';
import { OrderStatus, OrderStatusLabel } from '../../orders/entities/order.entity';

describe('Payment entity', () => {
  it('holds a paid card payment snapshot', () => {
    const payment = new Payment();
    payment.orderId = 'order-1';
    payment.invoiceId = 'OP-ABC12345';
    payment.amount = 100000;
    payment.currency = 'KZT';
    payment.status = PaymentStatus.PAID;
    payment.transactionId = '455';
    payment.cardLastFour = '4242';
    payment.cardType = 'Visa';
    payment.refundedAmount = 0;

    expect(payment.status).toBe('paid');
    expect(payment.invoiceId).toBe('OP-ABC12345');
    expect(payment.refundedAmount).toBe(0);
  });

  it('exposes the refundable remainder', () => {
    const payment = new Payment();
    payment.amount = 100000;
    payment.refundedAmount = 30000;

    expect(payment.refundableAmount).toBe(70000);
  });
});

describe('PaymentEvent entity', () => {
  it('records a webhook with its HMAC verdict', () => {
    const event = new PaymentEvent();
    event.type = 'pay';
    event.invoiceId = 'OP-ABC12345';
    event.transactionId = '455';
    event.hmacValid = true;
    event.body = { TransactionId: 455 };

    expect(event.type).toBe('pay');
    expect(event.hmacValid).toBe(true);
  });
});

describe('OrderStatus', () => {
  it('has an awaiting_payment state with a Russian label', () => {
    expect(OrderStatus.AWAITING_PAYMENT).toBe('awaiting_payment');
    expect(OrderStatusLabel[OrderStatus.AWAITING_PAYMENT]).toBe('Ожидает оплаты');
  });
});
