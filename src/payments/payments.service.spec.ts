import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentStatus } from './entities/payment.entity';
import { OrderStatus } from '../orders/entities/order.entity';

function makeDeps(over: { order?: any; payment?: any } = {}) {
  const order = over.order ?? {
    id: 'order-1',
    userId: 'user-1',
    status: OrderStatus.AWAITING_PAYMENT,
    totalAmount: 100000,
  };

  const payments: any[] = over.payment ? [over.payment] : [];
  const paymentRepo = {
    create: jest.fn((data: any) => ({ refundedAmount: 0, ...data })),
    save: jest.fn(async (p: any) => {
      p.id = p.id ?? 'pay-1';
      if (!payments.includes(p)) payments.push(p);
      return p;
    }),
    findOne: jest.fn(async ({ where }: any) => {
      return (
        payments.find(
          (p) =>
            (where.orderId && p.orderId === where.orderId) ||
            (where.invoiceId && p.invoiceId === where.invoiceId),
        ) ?? null
      );
    }),
    // Honest compare-and-set: only the FIRST caller whose row still matches every
    // column in `where` (crucially status === PENDING) mutates the row and gets
    // affected:1. Everyone after sees the already-flipped status and gets affected:0.
    // This models the DB's atomic conditional UPDATE — a mock that always returns
    // affected:1 would make the concurrency test below vacuous.
    update: jest.fn(async (where: any, patch: any) => {
      const p = payments.find(
        (x) =>
          (where.id === undefined || x.id === where.id) &&
          (where.orderId === undefined || x.orderId === where.orderId) &&
          (where.invoiceId === undefined || x.invoiceId === where.invoiceId) &&
          (where.status === undefined || x.status === where.status),
      );
      if (!p) return { affected: 0 };
      Object.assign(p, patch);
      return { affected: 1 };
    }),
  };

  const events: any[] = [];
  const eventRepo = {
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (e: any) => {
      events.push(e);
      return e;
    }),
    findOne: jest.fn(async ({ where }: any) =>
      events.find(
        (e) => e.type === where.type && e.transactionId === where.transactionId,
      ) ?? null,
    ),
  };

  const orderRepo = {
    findOne: jest.fn(async () => order),
    save: jest.fn(async (o: any) => o),
  };

  const orders = { placeWithSuppliers: jest.fn(async () => order) };
  const client = {
    publicTerminalId: 'pk_test',
    refund: jest.fn(async () => ({ Success: true, Message: null, Model: {} })),
  };

  const service = new PaymentsService(
    paymentRepo as any,
    eventRepo as any,
    orderRepo as any,
    orders as any,
    client as any,
  );

  return { service, paymentRepo, eventRepo, orderRepo, orders, client, order, payments, events };
}

describe('PaymentsService.init', () => {
  it('creates a pending payment with the amount taken from the order, not the caller', async () => {
    const { service, paymentRepo } = makeDeps();

    const res = await service.init('order-1', 'user-1');

    expect(res.amount).toBe(100000);
    expect(res.currency).toBe('KZT');
    expect(res.publicTerminalId).toBe('pk_test');
    expect(res.invoiceId).toMatch(/^OP-/);
    expect(paymentRepo.save).toHaveBeenCalled();
  });

  it('reuses the existing invoiceId when the customer retries with another card', async () => {
    const { service } = makeDeps();

    const first = await service.init('order-1', 'user-1');
    const second = await service.init('order-1', 'user-1');

    expect(second.invoiceId).toBe(first.invoiceId);
  });

  it('rejects a foreign order', async () => {
    const { service } = makeDeps();

    await expect(service.init('order-1', 'someone-else')).rejects.toThrow(ForbiddenException);
  });

  it('rejects an order that is not awaiting payment', async () => {
    const { service } = makeDeps({
      order: { id: 'order-1', userId: 'user-1', status: OrderStatus.PLACED, totalAmount: 100 },
    });

    await expect(service.init('order-1', 'user-1')).rejects.toThrow(BadRequestException);
  });
});

describe('PaymentsService.handlePayWebhook', () => {
  const payBody = {
    TransactionId: 455,
    Amount: 100000,
    Currency: 'KZT',
    InvoiceId: 'OP-ABC12345',
    AccountId: 'user-1',
    CardLastFour: '4242',
    CardType: 'Visa',
    Status: 'Completed',
  };

  function withPendingPayment() {
    return makeDeps({
      payment: {
        id: 'pay-1',
        orderId: 'order-1',
        invoiceId: 'OP-ABC12345',
        amount: 100000,
        currency: 'KZT',
        status: PaymentStatus.PENDING,
        refundedAmount: 0,
      },
    });
  }

  it('marks the payment paid and places the order with suppliers', async () => {
    const { service, orders, payments } = withPendingPayment();

    await service.handlePayWebhook(payBody);

    expect(payments[0].status).toBe(PaymentStatus.PAID);
    expect(payments[0].transactionId).toBe('455');
    expect(payments[0].cardLastFour).toBe('4242');
    expect(orders.placeWithSuppliers).toHaveBeenCalledWith('order-1');
  });

  // The single most dangerous bug in this integration: TipTopPay retries webhooks.
  it('does not place the order twice when the same webhook arrives again', async () => {
    const { service, orders } = withPendingPayment();

    await service.handlePayWebhook(payBody);
    await service.handlePayWebhook(payBody);

    expect(orders.placeWithSuppliers).toHaveBeenCalledTimes(1);
  });

  // Override requirement: two Pay deliveries racing must still place exactly once.
  // The paymentRepo.update mock models a real compare-and-set, so a check-then-act
  // implementation (both readers see an empty event log and both place) fails this;
  // the atomic PENDING->PAID claim passes it.
  it('places exactly once when two identical Pay webhooks arrive concurrently', async () => {
    const { service, orders } = withPendingPayment();

    await Promise.all([
      service.handlePayWebhook(payBody),
      service.handlePayWebhook(payBody),
    ]);

    expect(orders.placeWithSuppliers).toHaveBeenCalledTimes(1);
  });

  it('ignores a webhook whose invoiceId matches no payment', async () => {
    const { service, orders } = makeDeps();

    await service.handlePayWebhook({ ...payBody, InvoiceId: 'OP-NOPE' });

    expect(orders.placeWithSuppliers).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.handleFailWebhook', () => {
  it('marks the payment failed with the bank reason and leaves the order payable', async () => {
    const { service, payments, orders } = makeDeps({
      payment: {
        id: 'pay-1',
        orderId: 'order-1',
        invoiceId: 'OP-ABC12345',
        amount: 100000,
        status: PaymentStatus.PENDING,
        refundedAmount: 0,
      },
    });

    await service.handleFailWebhook({
      TransactionId: 456,
      InvoiceId: 'OP-ABC12345',
      Reason: 'InsufficientFunds',
    });

    expect(payments[0].status).toBe(PaymentStatus.FAILED);
    expect(payments[0].failReason).toBe('InsufficientFunds');
    expect(orders.placeWithSuppliers).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.refund', () => {
  function paid(refunded = 0) {
    return makeDeps({
      payment: {
        id: 'pay-1',
        orderId: 'order-1',
        invoiceId: 'OP-ABC12345',
        transactionId: '455',
        amount: 100000,
        status: refunded > 0 ? PaymentStatus.PARTIALLY_REFUNDED : PaymentStatus.PAID,
        refundedAmount: refunded,
      },
    });
  }

  it('refunds the full amount and marks the payment refunded', async () => {
    const { service, client, payments } = paid();

    await service.refund('order-1', 100000, 'supplier declined');

    expect(client.refund).toHaveBeenCalledWith('455', 100000);
    expect(payments[0].status).toBe(PaymentStatus.REFUNDED);
    expect(payments[0].refundedAmount).toBe(100000);
  });

  it('refunds partially and accumulates the refunded amount', async () => {
    const { service, payments } = paid(20000);

    await service.refund('order-1', 30000, null);

    expect(payments[0].refundedAmount).toBe(50000);
    expect(payments[0].status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
  });

  it('rejects a refund larger than the remaining amount', async () => {
    const { service } = paid(80000);

    await expect(service.refund('order-1', 30000, null)).rejects.toThrow(BadRequestException);
  });

  it('rejects a refund on a payment that was never paid', async () => {
    const { service } = makeDeps({
      payment: {
        id: 'pay-1',
        orderId: 'order-1',
        invoiceId: 'OP-1',
        amount: 100,
        status: PaymentStatus.PENDING,
        refundedAmount: 0,
      },
    });

    await expect(service.refund('order-1', 100, null)).rejects.toThrow(BadRequestException);
  });

  it('does not touch the local payment when TipTopPay declines the refund', async () => {
    const { service, client, payments } = paid();
    client.refund.mockResolvedValue({ Success: false, Message: 'Refund not allowed', Model: null });

    await expect(service.refund('order-1', 100000, null)).rejects.toThrow(BadRequestException);

    expect(payments[0].refundedAmount).toBe(0);
    expect(payments[0].status).toBe(PaymentStatus.PAID);
  });

  it('throws NotFound when the order has no payment', async () => {
    const { service } = makeDeps();

    await expect(service.refund('order-1', 100, null)).rejects.toThrow(NotFoundException);
  });
});
