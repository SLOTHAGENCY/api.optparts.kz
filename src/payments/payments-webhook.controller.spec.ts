import { createHmac } from 'crypto';
import { PaymentsWebhookController } from './payments-webhook.controller';

const SECRET = 'test_secret';

const sign = (body: string): string =>
  createHmac('sha256', SECRET).update(Buffer.from(body, 'utf8')).digest('base64');

function makeReq(body: Record<string, unknown>, signature?: string) {
  const raw = JSON.stringify(body);
  return {
    req: {
      rawBody: Buffer.from(raw, 'utf8'),
      headers: { 'x-content-hmac': signature ?? sign(raw) },
    } as any,
    body,
  };
}

function makeController() {
  const service = {
    handlePayWebhook: jest.fn(async () => undefined),
    handleFailWebhook: jest.fn(async () => undefined),
    logEvent: jest.fn(async () => undefined),
  };
  const client = { apiSecret: SECRET };
  const controller = new PaymentsWebhookController(service as any, client as any);
  return { controller, service };
}

describe('PaymentsWebhookController', () => {
  const payBody = { TransactionId: 455, InvoiceId: 'OP-1', Amount: 1000 };

  it('handles a Pay webhook with a valid signature and answers {code:0}', async () => {
    const { controller, service } = makeController();
    const { req, body } = makeReq(payBody);

    const res = await controller.pay(req, body);

    expect(service.handlePayWebhook).toHaveBeenCalledWith(body);
    expect(res).toEqual({ code: 0 });
  });

  it('rejects a forged signature, logs it and never touches the payment', async () => {
    const { controller, service } = makeController();
    const { req, body } = makeReq(payBody, 'Zm9yZ2Vk');

    await expect(controller.pay(req, body)).rejects.toMatchObject({ status: 403 });

    expect(service.handlePayWebhook).not.toHaveBeenCalled();
    expect(service.logEvent).toHaveBeenCalledWith('pay', body, false);
  });

  // Any non-200 makes TipTopPay retry forever; swallow our own failures.
  it('still answers {code:0} when the handler throws', async () => {
    const { controller, service } = makeController();
    service.handlePayWebhook.mockRejectedValue(new Error('db down'));
    const { req, body } = makeReq(payBody);

    const res = await controller.pay(req, body);

    expect(res).toEqual({ code: 0 });
  });

  it('handles a Fail webhook', async () => {
    const { controller, service } = makeController();
    const failBody = { TransactionId: 456, InvoiceId: 'OP-1', Reason: 'InsufficientFunds' };
    const { req, body } = makeReq(failBody);

    const res = await controller.fail(req, body);

    expect(service.handleFailWebhook).toHaveBeenCalledWith(body);
    expect(res).toEqual({ code: 0 });
  });

  it('approves a Check webhook with {code:0}', async () => {
    const { controller, service } = makeController();
    const { req, body } = makeReq(payBody);

    const res = await controller.check(req, body);

    expect(service.logEvent).toHaveBeenCalledWith('check', body, true);
    expect(res).toEqual({ code: 0 });
  });

  // logEvent hits the DB; a write failure must never turn the always-200 webhook into a 500.
  it('still answers {code:0} from Check when logEvent rejects', async () => {
    const { controller, service } = makeController();
    service.logEvent.mockRejectedValue(new Error('db down'));
    const { req, body } = makeReq(payBody);

    const res = await controller.check(req, body);

    expect(res).toEqual({ code: 0 });
  });

  // Forged requests must still be rejected with 403 even if we can't journal the forgery.
  it('still rejects a forged signature when logEvent rejects', async () => {
    const { controller, service } = makeController();
    service.logEvent.mockRejectedValue(new Error('db down'));
    const { req, body } = makeReq(payBody, 'Zm9yZ2Vk');

    await expect(controller.pay(req, body)).rejects.toMatchObject({ status: 403 });
  });
});
