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
          (where.status === undefined || x.status === where.status) &&
          (where.refundedAmount === undefined ||
            Number(x.refundedAmount) === Number(where.refundedAmount)),
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

  // Honest model of OrdersService.placeWithSuppliers' order-level compare-and-set claim:
  // the order is claimed AWAITING_PAYMENT -> PAID exactly once, and only that first caller
  // "contacts a supplier". Replays / concurrent deliveries find it already claimed and
  // no-op. supplierContacts is the TRUE invariant the concurrency tests must assert against
  // (no double supplier contact) — placeWithSuppliers itself may legitimately be CALLED more
  // than once now, it just no-ops the second time.
  const supplierContacts: string[] = [];
  const orders = {
    placeWithSuppliers: jest.fn(async (orderId: string) => {
      if (order.status === OrderStatus.AWAITING_PAYMENT) {
        order.status = OrderStatus.PAID;
        supplierContacts.push(orderId);
      }
      return order;
    }),
    supplierContacts,
  };
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

  return { service, paymentRepo, eventRepo, orderRepo, orders, client, order, payments, events, supplierContacts };
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

  // FINDING A (double charge): payment-first checkout. handlePayWebhook commits the payment
  // PENDING -> PAID, then placeWithSuppliers claims the order in a transaction; if that
  // transaction throws (DB fault) the order rolls back to AWAITING_PAYMENT while the payment
  // stays committed PAID. The order is now AWAITING_PAYMENT yet already PAID. A customer
  // clicking "Оплатить" again must NOT reset that PAID payment to PENDING and open the widget
  // — that would charge a second time for an already-paid order. init must refuse.
  it('refuses to re-initiate when the payment is already PAID (rollback edge — no double charge)', async () => {
    const { service, payments, paymentRepo } = makeDeps({
      order: { id: 'order-1', userId: 'user-1', status: OrderStatus.AWAITING_PAYMENT, totalAmount: 100000 },
      payment: {
        id: 'pay-1',
        orderId: 'order-1',
        invoiceId: 'OP-ABC12345',
        amount: 100000,
        currency: 'KZT',
        status: PaymentStatus.PAID,
        transactionId: '455',
        refundedAmount: 0,
      },
    });

    await expect(service.init('order-1', 'user-1')).rejects.toThrow(BadRequestException);
    // The PAID payment must be left untouched — no reset to PENDING, no save.
    expect(payments[0].status).toBe(PaymentStatus.PAID);
    expect(paymentRepo.save).not.toHaveBeenCalled();
  });

  it('refuses to re-initiate a REFUNDED or PARTIALLY_REFUNDED payment', async () => {
    for (const status of [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED]) {
      const { service, payments, paymentRepo } = makeDeps({
        order: { id: 'order-1', userId: 'user-1', status: OrderStatus.AWAITING_PAYMENT, totalAmount: 100000 },
        payment: {
          id: 'pay-1',
          orderId: 'order-1',
          invoiceId: 'OP-ABC12345',
          amount: 100000,
          currency: 'KZT',
          status,
          refundedAmount: status === PaymentStatus.PARTIALLY_REFUNDED ? 40000 : 100000,
        },
      });

      await expect(service.init('order-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(payments[0].status).toBe(status);
      expect(paymentRepo.save).not.toHaveBeenCalled();
    }
  });

  it('re-initiates a FAILED payment back to PENDING for a retry after decline', async () => {
    const { service, payments } = makeDeps({
      payment: {
        id: 'pay-1',
        orderId: 'order-1',
        invoiceId: 'OP-ABC12345',
        amount: 100000,
        currency: 'KZT',
        status: PaymentStatus.FAILED,
        failReason: 'InsufficientFunds',
        refundedAmount: 0,
      },
    });

    const res = await service.init('order-1', 'user-1');

    expect(res.invoiceId).toBe('OP-ABC12345');
    expect(res.amount).toBe(100000);
    expect(payments[0].status).toBe(PaymentStatus.PENDING);
    expect(payments[0].failReason).toBeNull();
  });

  it('still returns widget params for a PENDING payment (first attempt in flight)', async () => {
    const { service, payments } = makeDeps({
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

    const res = await service.init('order-1', 'user-1');

    expect(res.invoiceId).toBe('OP-ABC12345');
    expect(payments[0].status).toBe(PaymentStatus.PENDING);
  });
});

describe('PaymentsService.getByOrder', () => {
  function withPayment() {
    return makeDeps({
      payment: {
        id: 'pay-1',
        orderId: 'order-1',
        invoiceId: 'OP-ABC12345',
        amount: 100000,
        status: PaymentStatus.PAID,
        refundedAmount: 0,
      },
    });
  }

  it('returns the payment for the order owner', async () => {
    const { service, payments } = withPayment();

    const res = await service.getByOrder('order-1', 'user-1', false);

    expect(res).toBe(payments[0]);
  });

  it('denies a non-owner who is not staff', async () => {
    const { service } = withPayment();

    await expect(service.getByOrder('order-1', 'intruder', false)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets staff read any payment, bypassing the owner check', async () => {
    const { service, orderRepo, payments } = withPayment();

    const res = await service.getByOrder('order-1', 'not-the-owner', true);

    expect(res).toBe(payments[0]);
    // Staff bypass short-circuits before the order lookup.
    expect(orderRepo.findOne).not.toHaveBeenCalled();
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
  // The redelivery now re-drives placeWithSuppliers (it may recover a paid-but-unplaced
  // order), so the invariant is NOT "called once" but "the supplier is contacted at most
  // once" — enforced by placeWithSuppliers' own order-level claim, modeled by the mock.
  it('does not contact the supplier twice when the same webhook arrives again', async () => {
    const { service, supplierContacts } = withPendingPayment();

    await service.handlePayWebhook(payBody);
    await service.handlePayWebhook(payBody);

    expect(supplierContacts).toEqual(['order-1']);
  });

  // Override requirement: two Pay deliveries racing must never double-contact a supplier.
  // The paymentRepo.update mock models a real compare-and-set, and placeWithSuppliers is
  // modeled with its own order-level claim; a check-then-act implementation (both readers
  // see an empty event log and both place) would contact the supplier twice.
  it('contacts the supplier exactly once when two identical Pay webhooks race', async () => {
    const { service, supplierContacts } = withPendingPayment();

    await Promise.all([
      service.handlePayWebhook(payBody),
      service.handlePayWebhook(payBody),
    ]);

    expect(supplierContacts).toEqual(['order-1']);
  });

  // FINDING 2: a placement failure must be recoverable by a redelivered Pay. The first
  // delivery commits PENDING -> PAID, then placeWithSuppliers throws (supplier hiccup); the
  // order rolls back to AWAITING_PAYMENT. TipTopPay redelivers the Pay: it now sees the
  // payment already PAID (affected:0) but MUST still re-drive placement. The pre-fix code
  // returned early on affected:0, so placeWithSuppliers was called only once and the paid
  // order was never placed — this test fails against it (called once, supplier never
  // contacted). After the fix the redelivery re-drives placement.
  it('re-drives placement on redelivery when the first placement failed', async () => {
    const { service, orders, payments, supplierContacts } = withPendingPayment();
    orders.placeWithSuppliers.mockRejectedValueOnce(new Error('supplier unavailable'));

    await expect(service.handlePayWebhook(payBody)).rejects.toThrow('supplier unavailable');
    expect(payments[0].status).toBe(PaymentStatus.PAID);
    expect(supplierContacts).toEqual([]); // placement threw — nobody contacted yet

    await service.handlePayWebhook(payBody);

    expect(orders.placeWithSuppliers).toHaveBeenCalledTimes(2);
    expect(supplierContacts).toEqual(['order-1']);
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

  // FINDING 1: invoiceIds are reused, so a stale Fail can be redelivered after the SAME
  // invoice was retried and PAID (and placed). An unconditional write would flip that PAID,
  // placed, money-captured order to FAILED and block any refund. The guarded update must
  // leave a non-pending payment untouched. Fails against the pre-fix unconditional save.
  it('never overwrites a payment that is already PAID (late/redelivered Fail)', async () => {
    const { service, payments, orders } = makeDeps({
      payment: {
        id: 'pay-1',
        orderId: 'order-1',
        invoiceId: 'OP-ABC12345',
        amount: 100000,
        transactionId: '455',
        status: PaymentStatus.PAID,
        refundedAmount: 0,
      },
    });

    await service.handleFailWebhook({
      TransactionId: 456,
      InvoiceId: 'OP-ABC12345',
      Reason: 'InsufficientFunds',
    });

    expect(payments[0].status).toBe(PaymentStatus.PAID);
    expect(payments[0].failReason).toBeUndefined();
    // The paid order is still refundable (refund requires PAID/PARTIALLY_REFUNDED).
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

  // FINDING 4: two managers refunding the same order concurrently both pass the
  // remaining-amount check (both read refundedAmount:0). A read-modify-write save() would
  // let the second overwrite the first — 60000 + 60000 recorded as 60000-then-60000, and
  // over-refunding past the 100000 remaining. The guarded compare-and-set on refundedAmount
  // lets exactly one win; the loser is rejected, so the ledger never exceeds the amount.
  it('does not over-refund when two refunds run concurrently', async () => {
    const { service, payments, client } = paid();

    const results = await Promise.allSettled([
      service.refund('order-1', 60000, null),
      service.refund('order-1', 60000, null),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(payments[0].refundedAmount).toBe(60000);
    expect(payments[0].refundedAmount).toBeLessThanOrEqual(100000);
    expect(payments[0].status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    // Both attempts passed the amount check and hit TipTopPay (TipTopPay-first is preserved),
    // but only one is recorded locally.
    expect(client.refund).toHaveBeenCalledTimes(2);
  });
});
