# TipTopPay Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Клиент оплачивает заказ картой через виджет TipTopPay, и только после подтверждённой оплаты (вебхук `Pay`) заказ уходит поставщикам; сайт приводится в соответствие требованиям эквайринга.

**Architecture:** Новый модуль `src/payments/` (клиент TipTopPay, сущности `Payment` / `PaymentEvent`, контроллер с вебхуками, крон авто-отмены). `OrdersService.create()` перестаёт размещать заказ у поставщиков — размещение выносится в публичный метод `placeWithSuppliers(orderId)`, который вызывает `PaymentsService` из обработчика вебхука `Pay`. Фронт открывает виджет TipTopPay после `POST /orders`, страница `/success` опрашивает статус платежа.

**Tech Stack:** NestJS 10, TypeORM 0.3, Postgres, axios, jest + ts-jest (бэкенд). React 19, Vite, react-router (HashRouter), TanStack Query, Tailwind (фронт, `/home/mans/projects/Dana/front`).

**Спека:** `docs/superpowers/specs/2026-07-14-tiptoppay-payments-design.md`

## Global Constraints

- **Схема платежа — одностадийная (`Single`), на полную сумму заказа.** Никаких `auth`/`confirm`/`void`.
- **Сумма никогда не приходит с фронта.** Всегда берётся из `Order.totalAmount` на сервере.
- **Вебхук всегда отвечает `200 OK` с телом `{"code": 0}`** — даже при внутренней ошибке. Любой другой ответ TipTopPay считает сбоем и ретраит.
- **`ApiSecret` не логируется и не отдаётся на фронт.** На фронт уходит только `publicTerminalId`.
- **Идемпотентность вебхуков обязательна:** повторный `Pay` с тем же `TransactionId` не должен второй раз размещать заказ у поставщиков.
- **HMAC считается по сырому телу запроса** (`rawBody`), а не по разобранному JSON.
- **База URL API:** `https://api.tiptoppay.kz`. **Виджет:** `https://widget.tiptoppay.kz/bundles/widget.js`.
- **Валюта:** `KZT`.
- **Язык кода:** комментарии и сообщения об ошибках — как в существующем коде (английские комментарии в бэкенде, русские тексты в API-описаниях и на фронте).
- **Тесты:** jest, файлы `*.spec.ts` рядом с исходником (как везде в `src/`).
- **Коммиты:** после каждой задачи. Формат — как в репозитории (`feat(payments): ...`, `test(payments): ...`).

---

## File Structure

**Бэкенд (`/home/mans/projects/Dana/api.optparts.kz`)**

| файл | ответственность |
|---|---|
| `src/payments/entities/payment.entity.ts` | сущность `Payment` (1:1 с заказом) |
| `src/payments/entities/payment-event.entity.ts` | журнал вебхуков (идемпотентность + аудит) |
| `src/payments/tiptoppay.client.ts` | HTTP-клиент TipTopPay: Basic Auth, `X-Request-ID`, `refund`, `get` |
| `src/payments/tiptoppay.hmac.ts` | чистая функция проверки подписи `X-Content-HMAC` |
| `src/payments/payments.service.ts` | `init`, `getByOrder`, `handlePayWebhook`, `handleFailWebhook`, `refund` |
| `src/payments/payments.controller.ts` | `/payments/init`, `/payments/:orderId`, `/payments/:orderId/refund` |
| `src/payments/payments-webhook.controller.ts` | `/payments/webhook/check`\|`pay`\|`fail` — публичные, HMAC |
| `src/payments/dto/refund.dto.ts` | DTO возврата |
| `src/payments/unpaid-orders.cron.ts` | авто-отмена заказов в `awaiting_payment` старше 30 мин |
| `src/payments/payments.module.ts` | сборка модуля |
| `src/migrations/1700000000027-CreatePayments.ts` | таблицы `payments`, `payment_events` |
| `src/orders/orders.service.ts` | **правка:** `create()` не размещает; новый `placeWithSuppliers()`; `aggregateOrderStatus()` → `cancelled` при полном провале |
| `src/orders/entities/order.entity.ts` | **правка:** `OrderStatus.AWAITING_PAYMENT` |
| `src/main.ts` | **правка:** `rawBody` для `/api/payments/webhook` |
| `src/app.module.ts` | **правка:** регистрация сущностей и `PaymentsModule` |

**Фронт (`/home/mans/projects/Dana/front`)**

| файл | ответственность |
|---|---|
| `src/data/company.ts` | реквизиты ИП — единственный источник правды |
| `src/pages/legal/Offer.tsx`, `Privacy.tsx`, `Delivery.tsx`, `Returns.tsx`, `Contacts.tsx` | юридические страницы |
| `src/pages/legal/LegalPage.tsx` | общая обёртка (заголовок + типографика) |
| `src/hooks/useTipTopPay.ts` | ленивая загрузка `widget.js`, запуск виджета |
| `src/api.ts` | **правка:** `paymentsApi` |
| `src/pages/Checkout.tsx` | **правка:** чекбокс оферты + запуск виджета после создания заказа |
| `src/pages/OrderSuccess.tsx` | **правка:** опрос статуса платежа |
| `src/components/Footer.tsx` | **правка:** ссылки на юр-страницы, логотипы Visa/MC, строка про 3-D Secure |
| `src/App.tsx` | **правка:** роуты `/offer`, `/privacy`, `/delivery`, `/returns`, `/contacts` |
| `src/lib/api.ts` | **правка:** `paymentsAdminApi.refund` |
| `src/pages/admin/tabs/OrdersTab.tsx` | **правка:** блок платежа + кнопка «Возврат» |

---

## Task 1: Конфиг и HTTP-клиент TipTopPay

**Files:**
- Create: `src/payments/tiptoppay.client.ts`
- Create: `src/payments/tiptoppay.client.spec.ts`
- Modify: `.env` (добавить переменные)

**Interfaces:**
- Consumes: ничего.
- Produces:
  ```ts
  export interface TipTopPayConfig {
    publicTerminalId: string;
    apiSecret: string;
    baseUrl: string; // default 'https://api.tiptoppay.kz'
  }
  export interface TipTopPayResponse<T = Record<string, unknown>> {
    Success: boolean;
    Message: string | null;
    Model: T | null;
  }
  export class TipTopPayClient {
    constructor(config?: Partial<TipTopPayConfig>);
    get publicTerminalId(): string;
    refund(transactionId: string, amount: number): Promise<TipTopPayResponse>;
    getTransaction(transactionId: string): Promise<TipTopPayResponse>;
  }
  ```

- [ ] **Step 1: Написать падающий тест**

Создать `src/payments/tiptoppay.client.spec.ts`:

```ts
import axios from 'axios';
import { TipTopPayClient } from './tiptoppay.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TipTopPayClient', () => {
  const config = {
    publicTerminalId: 'pk_test',
    apiSecret: 'secret',
    baseUrl: 'https://api.tiptoppay.kz',
  };

  beforeEach(() => jest.clearAllMocks());

  it('posts refund with Basic auth, X-Request-ID and the TipTopPay payload shape', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { Success: true, Message: null, Model: { TransactionId: 455 } },
    });

    const client = new TipTopPayClient(config);
    const res = await client.refund('455', 1500.5);

    expect(res.Success).toBe(true);

    const [url, body, options] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://api.tiptoppay.kz/payments/refund');
    expect(body).toEqual({ TransactionId: '455', Amount: 1500.5 });
    expect(options.auth).toEqual({ username: 'pk_test', password: 'secret' });
    expect(options.headers['X-Request-ID']).toEqual(expect.any(String));
    expect(options.headers['X-Request-ID'].length).toBeGreaterThan(0);
  });

  it('returns the failed response instead of throwing when Success is false', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { Success: false, Message: 'Insufficient funds', Model: null },
    });

    const client = new TipTopPayClient(config);
    const res = await client.refund('455', 100);

    expect(res.Success).toBe(false);
    expect(res.Message).toBe('Insufficient funds');
  });

  it('throws a readable error when the HTTP call itself fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('ECONNRESET'));

    const client = new TipTopPayClient(config);

    await expect(client.refund('455', 100)).rejects.toThrow('TipTopPay request failed');
  });

  it('reads credentials from env when no config is passed', () => {
    process.env.TIPTOPPAY_PUBLIC_ID = 'pk_env';
    process.env.TIPTOPPAY_API_SECRET = 'secret_env';

    const client = new TipTopPayClient();

    expect(client.publicTerminalId).toBe('pk_env');
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `npx jest src/payments/tiptoppay.client.spec.ts`
Expected: FAIL — `Cannot find module './tiptoppay.client'`

- [ ] **Step 3: Реализовать клиент**

Создать `src/payments/tiptoppay.client.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import axios from 'axios';

export interface TipTopPayConfig {
  publicTerminalId: string;
  apiSecret: string;
  baseUrl: string;
}

export interface TipTopPayResponse<T = Record<string, unknown>> {
  Success: boolean;
  Message: string | null;
  Model: T | null;
}

const DEFAULT_BASE_URL = 'https://api.tiptoppay.kz';

/**
 * Thin HTTP wrapper over the TipTopPay REST API.
 *
 * Auth is HTTP Basic: PublicTerminalId as the user, ApiSecret as the password.
 * X-Request-ID makes the call idempotent on TipTopPay's side (cached 1 hour), so a
 * retried refund never double-refunds.
 *
 * The charge itself is initiated by the widget in the browser — the backend never sees
 * card data and therefore never calls /payments/cards/charge.
 */
@Injectable()
export class TipTopPayClient {
  private readonly logger = new Logger(TipTopPayClient.name);
  private readonly config: TipTopPayConfig;

  constructor(config: Partial<TipTopPayConfig> = {}) {
    this.config = {
      publicTerminalId:
        config.publicTerminalId ?? process.env.TIPTOPPAY_PUBLIC_ID ?? '',
      apiSecret: config.apiSecret ?? process.env.TIPTOPPAY_API_SECRET ?? '',
      baseUrl: config.baseUrl ?? process.env.TIPTOPPAY_BASE_URL ?? DEFAULT_BASE_URL,
    };
  }

  get publicTerminalId(): string {
    return this.config.publicTerminalId;
  }

  get apiSecret(): string {
    return this.config.apiSecret;
  }

  async refund(transactionId: string, amount: number): Promise<TipTopPayResponse> {
    return this.post('/payments/refund', {
      TransactionId: transactionId,
      Amount: amount,
    });
  }

  async getTransaction(transactionId: string): Promise<TipTopPayResponse> {
    return this.post('/payments/get', { TransactionId: transactionId });
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<TipTopPayResponse> {
    const url = `${this.config.baseUrl}${path}`;
    try {
      const { data } = await axios.post<TipTopPayResponse>(url, body, {
        auth: {
          username: this.config.publicTerminalId,
          password: this.config.apiSecret,
        },
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': randomUUID(),
        },
        timeout: 20_000,
      });
      if (!data.Success) {
        // Not an exception: a declined operation is a normal business outcome.
        this.logger.warn(`TipTopPay ${path} declined: ${data.Message}`);
      }
      return data;
    } catch (err) {
      // Never let the secret reach the logs.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`TipTopPay ${path} transport error: ${message}`);
      throw new Error(`TipTopPay request failed: ${message}`);
    }
  }
}
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `npx jest src/payments/tiptoppay.client.spec.ts`
Expected: PASS, 4 теста

- [ ] **Step 5: Добавить переменные в `.env`**

Дописать в конец `.env` (значения-плейсхолдеры до получения боевых ключей):

```
# TipTopPay (https://developers.tiptoppay.kz)
TIPTOPPAY_PUBLIC_ID=pk_test_replace_me
TIPTOPPAY_API_SECRET=secret_replace_me
TIPTOPPAY_BASE_URL=https://api.tiptoppay.kz
```

- [ ] **Step 6: Коммит**

```bash
git add src/payments/tiptoppay.client.ts src/payments/tiptoppay.client.spec.ts
git commit -m "feat(payments): TipTopPay HTTP client with basic auth and idempotency key"
```

---

## Task 2: Проверка подписи вебхука (HMAC)

**Files:**
- Create: `src/payments/tiptoppay.hmac.ts`
- Create: `src/payments/tiptoppay.hmac.spec.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `export function isValidHmac(rawBody: Buffer | string, headerValue: string | undefined, apiSecret: string): boolean`

- [ ] **Step 1: Написать падающий тест**

Создать `src/payments/tiptoppay.hmac.spec.ts`:

```ts
import { createHmac } from 'crypto';
import { isValidHmac } from './tiptoppay.hmac';

const SECRET = 'test_secret';
const BODY = '{"TransactionId":455,"Amount":1000,"InvoiceId":"OP-1"}';

const sign = (body: string, secret = SECRET): string =>
  createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('base64');

describe('isValidHmac', () => {
  it('accepts a signature computed from the raw body with the api secret', () => {
    expect(isValidHmac(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it('accepts a raw Buffer body', () => {
    expect(isValidHmac(Buffer.from(BODY, 'utf8'), sign(BODY), SECRET)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(isValidHmac(BODY, sign(BODY, 'other_secret'), SECRET)).toBe(false);
  });

  it('rejects when the body was tampered with', () => {
    const signature = sign(BODY);
    const tampered = '{"TransactionId":455,"Amount":1,"InvoiceId":"OP-1"}';
    expect(isValidHmac(tampered, signature, SECRET)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(isValidHmac(BODY, undefined, SECRET)).toBe(false);
  });

  it('rejects garbage in the header without throwing', () => {
    expect(isValidHmac(BODY, 'not-base64-@@@', SECRET)).toBe(false);
  });

  it('rejects when the api secret is not configured', () => {
    expect(isValidHmac(BODY, sign(BODY), '')).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `npx jest src/payments/tiptoppay.hmac.spec.ts`
Expected: FAIL — `Cannot find module './tiptoppay.hmac'`

- [ ] **Step 3: Реализовать**

Создать `src/payments/tiptoppay.hmac.ts`:

```ts
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Validates the X-Content-HMAC header TipTopPay sends with every webhook.
 *
 * The signature is HMAC-SHA256 of the RAW request body (not the re-serialized JSON —
 * key order and whitespace would differ) keyed with the ApiSecret, base64-encoded.
 *
 * Comparison is constant-time: a fast string compare would leak the expected signature
 * byte by byte to anyone able to time our responses.
 */
export function isValidHmac(
  rawBody: Buffer | string,
  headerValue: string | undefined,
  apiSecret: string,
): boolean {
  if (!headerValue || !apiSecret) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const expected = createHmac('sha256', apiSecret).update(body).digest();

  let received: Buffer;
  try {
    received = Buffer.from(headerValue, 'base64');
  } catch {
    return false;
  }

  // timingSafeEqual throws on length mismatch — check first.
  if (received.length !== expected.length) return false;

  return timingSafeEqual(received, expected);
}
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `npx jest src/payments/tiptoppay.hmac.spec.ts`
Expected: PASS, 7 тестов

- [ ] **Step 5: Коммит**

```bash
git add src/payments/tiptoppay.hmac.ts src/payments/tiptoppay.hmac.spec.ts
git commit -m "feat(payments): constant-time HMAC validation for TipTopPay webhooks"
```

---

## Task 3: Сущности, миграция, новый статус заказа

**Files:**
- Create: `src/payments/entities/payment.entity.ts`
- Create: `src/payments/entities/payment-event.entity.ts`
- Create: `src/payments/entities/payment.entity.spec.ts`
- Create: `src/migrations/1700000000027-CreatePayments.ts`
- Modify: `src/orders/entities/order.entity.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  ```ts
  export enum PaymentStatus {
    PENDING = 'pending',
    PAID = 'paid',
    FAILED = 'failed',
    REFUNDED = 'refunded',
    PARTIALLY_REFUNDED = 'partially_refunded',
  }
  export class Payment { /* поля см. ниже */ }
  export type PaymentEventType = 'check' | 'pay' | 'fail' | 'refund';
  export class PaymentEvent { /* поля см. ниже */ }
  // и OrderStatus.AWAITING_PAYMENT = 'awaiting_payment'
  ```

- [ ] **Step 1: Написать падающий тест**

Создать `src/payments/entities/payment.entity.spec.ts`:

```ts
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
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `npx jest src/payments/entities/payment.entity.spec.ts`
Expected: FAIL — `Cannot find module './payment.entity'`

- [ ] **Step 3: Создать `Payment`**

Создать `src/payments/entities/payment.entity.ts`:

```ts
import {
  Entity, PrimaryGeneratedColumn, Column, OneToOne,
  JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Order } from '../../orders/entities/order.entity';
import { decimalTransformer } from '../../suppliers/entities/supplier.entity';

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

export const PaymentStatusLabel: Record<PaymentStatus, string> = {
  [PaymentStatus.PENDING]: 'Ожидает оплаты',
  [PaymentStatus.PAID]: 'Оплачен',
  [PaymentStatus.FAILED]: 'Отклонён',
  [PaymentStatus.REFUNDED]: 'Возвращён',
  [PaymentStatus.PARTIALLY_REFUNDED]: 'Возвращён частично',
};

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn()
  order: Order;

  @Column()
  orderId: string;

  @ApiProperty({ description: 'Номер счёта, известный TipTopPay и клиенту', example: 'OP-A1B2C3D4' })
  @Column({ type: 'varchar', length: 64, unique: true })
  invoiceId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, transformer: decimalTransformer })
  amount: number;

  @Column({ type: 'varchar', length: 8, default: 'KZT' })
  currency: string;

  @Column({ type: 'varchar', default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  transactionId: string | null;

  @Column({ type: 'varchar', length: 4, nullable: true, default: null })
  cardLastFour: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  cardType: string | null;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  refundedAmount: number;

  @Column({ type: 'text', nullable: true, default: null })
  failReason: string | null;

  @Column({ type: 'timestamp', nullable: true, default: null })
  paidAt: Date | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  raw: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /** How much of this payment can still be refunded. */
  get refundableAmount(): number {
    return Number(this.amount) - Number(this.refundedAmount);
  }

  get statusLabel(): string {
    return PaymentStatusLabel[this.status];
  }
}
```

- [ ] **Step 4: Создать `PaymentEvent`**

Создать `src/payments/entities/payment-event.entity.ts`:

```ts
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type PaymentEventType = 'check' | 'pay' | 'fail' | 'refund';

/**
 * Append-only log of every webhook TipTopPay sends us.
 *
 * Two jobs:
 *  1. Idempotency — TipTopPay retries webhooks; (type, transactionId) tells us whether
 *     we already acted on this one, so a retried Pay never places the order twice.
 *  2. Audit — hmacValid=false rows are attempted payment forgeries; keep them.
 */
@Entity('payment_events')
@Index(['type', 'transactionId'])
export class PaymentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  type: PaymentEventType;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  invoiceId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  transactionId: string | null;

  @Column({ type: 'boolean', default: false })
  hmacValid: boolean;

  @Column({ type: 'jsonb', nullable: true, default: null })
  body: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 5: Добавить статус заказа**

В `src/orders/entities/order.entity.ts` — в enum `OrderStatus` добавить первым значением и подписать в `OrderStatusLabel`:

```ts
export enum OrderStatus {
  NEW = 'new',
  AWAITING_PAYMENT = 'awaiting_payment',
  PAID = 'paid',
  PENDING = 'pending',
  PLACED = 'placed',
  PARTIALLY_PLACED = 'partially_placed',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export const OrderStatusLabel: Record<OrderStatus, string> = {
  [OrderStatus.NEW]: 'Новый',
  [OrderStatus.AWAITING_PAYMENT]: 'Ожидает оплаты',
  [OrderStatus.PAID]: 'Оплачен',
  [OrderStatus.PENDING]: 'В обработке',
  [OrderStatus.PLACED]: 'Размещён у партнёров',
  [OrderStatus.PARTIALLY_PLACED]: 'Размещён частично',
  [OrderStatus.DELIVERED]: 'Доставлено',
  [OrderStatus.CANCELLED]: 'Отменен',
};
```

- [ ] **Step 6: Запустить тест и убедиться, что проходит**

Run: `npx jest src/payments/entities/payment.entity.spec.ts`
Expected: PASS, 4 теста

- [ ] **Step 7: Написать миграцию**

Создать `src/migrations/1700000000027-CreatePayments.ts`:

```ts
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
```

Статус заказа хранится как `varchar`, а не как enum-тип Postgres (см. `@Column({ type: 'varchar', default: OrderStatus.NEW })`), поэтому новое значение `awaiting_payment` миграции не требует.

- [ ] **Step 8: Зарегистрировать сущности в `app.module.ts`**

Добавить импорты и вписать в массив `entities`:

```ts
import { Payment } from './payments/entities/payment.entity';
import { PaymentEvent } from './payments/entities/payment-event.entity';
```

В `entities: [...]` дописать в конец: `, Payment, PaymentEvent`

- [ ] **Step 9: Прогнать миграцию и убедиться, что таблицы созданы**

Run:
```bash
npm run build && npm run migration:run
```
Expected: в выводе `Migration CreatePayments1700000000027 has been executed successfully.`

Проверить:
```bash
docker exec optparts_smoke_db psql -U postgres -d nestjs_auth -c '\d payments'
```
Expected: таблица с колонками `invoiceId`, `amount`, `status`, `refundedAmount`.

- [ ] **Step 10: Коммит**

```bash
git add src/payments/entities src/migrations/1700000000027-CreatePayments.ts src/orders/entities/order.entity.ts src/app.module.ts
git commit -m "feat(payments): Payment/PaymentEvent entities, migration, awaiting_payment order status"
```

---

## Task 4: `create()` больше не размещает заказ; размещение выносится в `placeWithSuppliers()`

Это самая рискованная задача: она меняет существующее поведение оформления заказа. Существующие тесты `orders.service.spec.ts` на размещение внутри `create()` **должны упасть** — это ожидаемо, их надо переписать под новое поведение.

**Files:**
- Modify: `src/orders/orders.service.ts:41-52` (`aggregateOrderStatus`), `:120-211` (`create`)
- Modify: `src/orders/orders.service.spec.ts`

**Interfaces:**
- Consumes: `OrderStatus.AWAITING_PAYMENT` (Task 3).
- Produces:
  ```ts
  // OrdersService
  async placeWithSuppliers(orderId: string): Promise<Order>;
  // aggregateOrderStatus: пустой список или все FAILED → OrderStatus.CANCELLED
  export function aggregateOrderStatus(statuses: SupplierOrderStatusValue[]): OrderStatus;
  ```

- [ ] **Step 1: Написать падающие тесты**

В `src/orders/orders.service.spec.ts` заменить блок тестов про `create()` на новый набор (хелперы `makeCheckoutItem` / `makeDeps` в файле уже есть — использовать их как есть):

```ts
describe('aggregateOrderStatus', () => {
  it('returns PLACED when every sub-order was placed', () => {
    expect(aggregateOrderStatus(['PLACED', 'PLACED'])).toBe(OrderStatus.PLACED);
  });

  it('returns PARTIALLY_PLACED when some placed and some failed', () => {
    expect(aggregateOrderStatus(['PLACED', 'FAILED'])).toBe(OrderStatus.PARTIALLY_PLACED);
  });

  // Money is on the line: nothing was placed, so the order is dead and the manager
  // must see it as a refund candidate — not as "partially placed".
  it('returns CANCELLED when every sub-order failed', () => {
    expect(aggregateOrderStatus(['FAILED', 'FAILED'])).toBe(OrderStatus.CANCELLED);
  });

  it('returns CANCELLED for an empty list', () => {
    expect(aggregateOrderStatus([])).toBe(OrderStatus.CANCELLED);
  });
});

describe('OrdersService.create — payment first', () => {
  it('creates the order in awaiting_payment and does NOT contact suppliers', async () => {
    const connector = new MockConnector();
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service, cart, supplierOrderRepo } = makeDeps(
      [makeCheckoutItem()],
      { mock: connector },
    );

    const order = await service.create('user-1', {
      deliveryType: DeliveryType.DELIVERY,
      addressId: 'addr-1',
    } as any);

    expect(order.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(placeSpy).not.toHaveBeenCalled();
    expect(supplierOrderRepo.save).not.toHaveBeenCalled();
  });

  // The customer may close the tab before paying — their cart must survive.
  it('does not clear the cart at creation time', async () => {
    const { service, cart } = makeDeps([makeCheckoutItem()], { mock: new MockConnector() });

    await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    expect(cart.clearCart).not.toHaveBeenCalled();
  });
});

describe('OrdersService.placeWithSuppliers', () => {
  it('places every supplier group, clears the cart and marks the order placed', async () => {
    const connector = new MockConnector();
    const { service, cart, supplierOrderRepo, partnerProducts } = makeDeps(
      [makeCheckoutItem()],
      { mock: connector },
    );

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    const placed = await service.placeWithSuppliers(created.id);

    expect(supplierOrderRepo.save).toHaveBeenCalled();
    expect(placed.status).toBe(OrderStatus.PLACED);
    expect(cart.clearCart).toHaveBeenCalledWith('user-1');
    expect(partnerProducts.recordOrder).toHaveBeenCalled();
  });

  it('cancels the order when every supplier fails', async () => {
    const connector = new MockConnector();
    jest.spyOn(connector, 'placeOrder').mockRejectedValue(new Error('supplier down'));
    const { service } = makeDeps([makeCheckoutItem()], { mock: connector });

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    const placed = await service.placeWithSuppliers(created.id);

    expect(placed.status).toBe(OrderStatus.CANCELLED);
  });

  it('is a no-op when the order was already placed (webhook retry)', async () => {
    const connector = new MockConnector();
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service } = makeDeps([makeCheckoutItem()], { mock: connector });

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);

    await service.placeWithSuppliers(created.id);
    const callsAfterFirst = placeSpy.mock.calls.length;
    await service.placeWithSuppliers(created.id);

    expect(placeSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('skips suppliers in test mode', async () => {
    const connector = new MockConnector();
    const placeSpy = jest.spyOn(connector, 'placeOrder');
    const { service } = makeDeps([makeCheckoutItem()], { mock: connector }, 'test');

    const created = await service.create('user-1', {
      deliveryType: DeliveryType.PICKUP,
    } as any);
    await service.placeWithSuppliers(created.id);

    expect(placeSpy).not.toHaveBeenCalled();
  });
});
```

`makeDeps` возвращает объект с моками — убедиться, что он отдаёт `cart`, `supplierOrderRepo`, `partnerProducts` (если каких-то нет в возвращаемом объекте, дописать их в `return`).

`placeWithSuppliers` перечитывает позиции заказа из `order.items`, а не из корзины (корзина уже могла измениться) — моку `orderRepo.findOne` нужно возвращать сохранённый заказ вместе с `items`. В `makeDeps` `orderRepo.findOne` уже отдаёт `saved[0]`, а `create()` кладёт туда объект с `items` — этого достаточно.

- [ ] **Step 2: Запустить тесты и убедиться, что падают**

Run: `npx jest src/orders/orders.service.spec.ts`
Expected: FAIL — `service.placeWithSuppliers is not a function`, и падение теста `create` (сейчас он возвращает `placed`, а не `awaiting_payment`).

- [ ] **Step 3: Переписать `aggregateOrderStatus`**

В `src/orders/orders.service.ts` заменить функцию (строки 41-52):

```ts
/**
 * Aggregate the order status from its sub-order statuses.
 *
 * Nothing placed (empty list, or every group failed) means the order is dead: the
 * customer has paid and the manager must see it as a refund candidate, so it lands in
 * CANCELLED rather than the misleading PARTIALLY_PLACED.
 */
export function aggregateOrderStatus(
  statuses: SupplierOrderStatusValue[],
): OrderStatus {
  if (statuses.length === 0) return OrderStatus.CANCELLED;
  if (statuses.every((s) => s === 'FAILED')) return OrderStatus.CANCELLED;
  if (statuses.some((s) => s === 'FAILED')) return OrderStatus.PARTIALLY_PLACED;
  return OrderStatus.PLACED;
}
```

- [ ] **Step 4: Разделить `create()` и `placeWithSuppliers()`**

В `src/orders/orders.service.ts` заменить хвост `create()` (строки 176-211) так, чтобы метод заканчивался сразу после сохранения заказа:

```ts
    const order = this.orderRepo.create({
      userId,
      deliveryType: dto.deliveryType,
      addressId,
      recipientName: dto.recipientName ?? null,
      recipientPhone: dto.recipientPhone ?? null,
      customerComment: dto.customerComment ?? null,
      // Payment first: the order waits for the TipTopPay webhook before anything is sent
      // to suppliers. PaymentsService.handlePayWebhook() calls placeWithSuppliers().
      status: OrderStatus.AWAITING_PAYMENT,
      isTest,
      totalAmount: items.reduce(
        (sum, i) => sum + i.currentPrice * i.quantity,
        0,
      ),
      items: items.map((i) => this.buildOrderItem(i)),
    });
    const saved = await this.orderRepo.save(order);

    // The cart is NOT cleared here: the customer may abandon the payment, and their cart
    // must survive. It is cleared in placeWithSuppliers(), once the money is in.
    return this.withLabelPublic(saved);
  }

  /**
   * Place a paid order with its suppliers. Called from the TipTopPay `Pay` webhook —
   * never from checkout.
   *
   * Idempotent: a retried webhook finds the order already out of AWAITING_PAYMENT and
   * returns it untouched, so suppliers are never double-ordered.
   */
  async placeWithSuppliers(orderId: string): Promise<Order> {
    const order = await this.loadOrder(orderId);
    if (order.status !== OrderStatus.AWAITING_PAYMENT) {
      this.logger.warn(
        `placeWithSuppliers: order ${orderId} is already ${order.status} — skipping.`,
      );
      return order;
    }

    // Group the order's own item snapshots (not the live cart — it may have changed).
    const groups = new Map<string, OrderItem[]>();
    for (const item of order.items) {
      const list = groups.get(item.supplierCode ?? '') ?? [];
      list.push(item);
      groups.set(item.supplierCode ?? '', list);
    }

    const subOrders: SupplierOrder[] = [];
    for (const [supplierCode, groupItems] of groups) {
      subOrders.push(
        await this.placeSupplierOrder(
          order.id,
          supplierCode,
          groupItems,
          order.isTest,
        ),
      );
    }

    order.supplierOrders = subOrders;
    order.status = order.isTest
      ? OrderStatus.PAID
      : aggregateOrderStatus(subOrders.map((s) => s.status));
    await this.orderRepo.save(order);

    for (const item of order.items) {
      await this.partnerProducts.recordOrder({
        supplierCode: item.supplierCode ?? '',
        article: item.article ?? item.productSku,
        brand: item.brand ?? '',
        name: item.productName,
        costPrice: Number(item.costPrice ?? 0),
        sellPrice: Number(item.sellPrice ?? item.priceAtOrder),
      });
    }
    await this.cart.clearCart(order.userId);

    return order;
  }
```

- [ ] **Step 5: Переключить `placeSupplierOrder` и `toPlaceOrderItems` на `OrderItem`**

`placeSupplierOrder` и `toPlaceOrderItems` сейчас принимают `CheckoutItem[]`. Теперь им приходит `OrderItem[]`. Поменять сигнатуры и маппинг:

```ts
  private async placeSupplierOrder(
    orderId: string,
    supplierCode: string,
    items: OrderItem[],
    isTest = false,
  ): Promise<SupplierOrder> {
```

и

```ts
  private toPlaceOrderItems(items: OrderItem[]): PlaceOrderItem[] {
    return items.map((i) => ({
      article: i.article ?? i.productSku,
      brand: i.brand ?? '',
      warehouseId: i.warehouseId ?? '',
      quantity: i.quantity,
      raw: i.raw ?? {},
    }));
  }
```

Сверить поля `PlaceOrderItem` с `src/suppliers/types.ts` и, если набор полей отличается, привести маппинг к нему (тело `placeSupplierOrder` менять не нужно — оно работает с результатом `toPlaceOrderItems`).

`retrySupplierOrder()` уже строит `PlaceOrderItem[]` из `order.items` — проверить, что он использует тот же `toPlaceOrderItems`, и если да, ничего не менять.

- [ ] **Step 6: Запустить тесты и убедиться, что проходят**

Run: `npx jest src/orders`
Expected: PASS. Если падают старые тесты, ожидавшие размещение внутри `create()` — они устарели, удалить их (новые из Step 1 покрывают то же поведение).

- [ ] **Step 7: Проверить сборку**

Run: `npm run build`
Expected: сборка без ошибок TypeScript.

- [ ] **Step 8: Коммит**

```bash
git add src/orders/orders.service.ts src/orders/orders.service.spec.ts
git commit -m "feat(orders): checkout no longer places with suppliers; add placeWithSuppliers()"
```

---

## Task 5: `PaymentsService` — init, статус, обработка вебхуков

**Files:**
- Create: `src/payments/payments.service.ts`
- Create: `src/payments/payments.service.spec.ts`

**Interfaces:**
- Consumes: `TipTopPayClient` (Task 1), `Payment` / `PaymentStatus` / `PaymentEvent` (Task 3), `OrdersService.placeWithSuppliers()` (Task 4).
- Produces:
  ```ts
  export interface PaymentInitResponse {
    publicTerminalId: string;
    invoiceId: string;
    amount: number;
    currency: string;
    accountId: string;
    description: string;
  }
  export interface TipTopPayWebhookBody {
    TransactionId?: string | number;
    Amount?: string | number;
    Currency?: string;
    InvoiceId?: string;
    AccountId?: string;
    CardLastFour?: string;
    CardType?: string;
    Status?: string;
    Reason?: string;
  }
  export class PaymentsService {
    init(orderId: string, userId: string): Promise<PaymentInitResponse>;
    getByOrder(orderId: string, userId: string, isStaff: boolean): Promise<Payment>;
    handlePayWebhook(body: TipTopPayWebhookBody): Promise<void>;
    handleFailWebhook(body: TipTopPayWebhookBody): Promise<void>;
    logEvent(type: PaymentEventType, body: TipTopPayWebhookBody, hmacValid: boolean): Promise<void>;
    refund(orderId: string, amount: number, reason: string | null): Promise<Payment>;
  }
  ```

- [ ] **Step 1: Написать падающие тесты**

Создать `src/payments/payments.service.spec.ts`:

```ts
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
```

- [ ] **Step 2: Запустить тесты и убедиться, что падают**

Run: `npx jest src/payments/payments.service.spec.ts`
Expected: FAIL — `Cannot find module './payments.service'`

- [ ] **Step 3: Реализовать сервис**

Создать `src/payments/payments.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentEvent, PaymentEventType } from './entities/payment-event.entity';
import { TipTopPayClient } from './tiptoppay.client';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { OrdersService } from '../orders/orders.service';

export interface PaymentInitResponse {
  publicTerminalId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  accountId: string;
  description: string;
}

/** Body TipTopPay POSTs to our webhooks. Field names are PascalCase, values are loosely typed. */
export interface TipTopPayWebhookBody {
  TransactionId?: string | number;
  Amount?: string | number;
  Currency?: string;
  InvoiceId?: string;
  AccountId?: string;
  CardLastFour?: string;
  CardType?: string;
  Status?: string;
  Reason?: string;
}

const CURRENCY = 'KZT';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentEvent)
    private readonly eventRepo: Repository<PaymentEvent>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly orders: OrdersService,
    private readonly client: TipTopPayClient,
  ) {}

  /**
   * Prepare the widget parameters for an order awaiting payment.
   *
   * The amount is read from the order — never from the request — so a tampered client
   * cannot buy a turbocharger for 100 ₸.
   */
  async init(orderId: string, userId: string): Promise<PaymentInitResponse> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден.');
    if (order.userId !== userId) throw new ForbiddenException('Это не ваш заказ.');
    if (order.status !== OrderStatus.AWAITING_PAYMENT) {
      throw new BadRequestException('Заказ не ожидает оплаты.');
    }

    // Reuse the pending payment so a retry with another card keeps the same invoice.
    let payment = await this.paymentRepo.findOne({ where: { orderId } });
    if (!payment) {
      payment = this.paymentRepo.create({
        orderId,
        invoiceId: `OP-${randomUUID().slice(0, 8).toUpperCase()}`,
        amount: Number(order.totalAmount),
        currency: CURRENCY,
        status: PaymentStatus.PENDING,
        refundedAmount: 0,
      });
    } else {
      // The order can't change after creation, but keep the amount authoritative anyway.
      payment.amount = Number(order.totalAmount);
      payment.status = PaymentStatus.PENDING;
      payment.failReason = null;
    }
    await this.paymentRepo.save(payment);

    return {
      publicTerminalId: this.client.publicTerminalId,
      invoiceId: payment.invoiceId,
      amount: Number(payment.amount),
      currency: CURRENCY,
      accountId: order.userId,
      description: `Оплата заказа ${payment.invoiceId} на optparts.kz`,
    };
  }

  async getByOrder(
    orderId: string,
    userId: string,
    isStaff: boolean,
  ): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({ where: { orderId } });
    if (!payment) throw new NotFoundException('Платёж не найден.');
    if (!isStaff) {
      const order = await this.orderRepo.findOne({ where: { id: orderId } });
      if (!order || order.userId !== userId) {
        throw new ForbiddenException('Нет доступа к этому платежу.');
      }
    }
    return payment;
  }

  /** Append-only webhook log. Also the idempotency ledger — see wasHandled(). */
  async logEvent(
    type: PaymentEventType,
    body: TipTopPayWebhookBody,
    hmacValid: boolean,
  ): Promise<void> {
    await this.eventRepo.save(
      this.eventRepo.create({
        type,
        invoiceId: body.InvoiceId ?? null,
        transactionId: body.TransactionId != null ? String(body.TransactionId) : null,
        hmacValid,
        body: body as unknown as Record<string, unknown>,
      }),
    );
  }

  private async wasHandled(
    type: PaymentEventType,
    body: TipTopPayWebhookBody,
  ): Promise<boolean> {
    const transactionId =
      body.TransactionId != null ? String(body.TransactionId) : null;
    if (!transactionId) return false;
    const existing = await this.eventRepo.findOne({
      where: { type, transactionId },
    });
    return !!existing;
  }

  /**
   * Money is in. Mark the payment paid, then place the order with suppliers.
   *
   * TipTopPay retries webhooks, so this must be idempotent: (type=pay, transactionId)
   * already in payment_events means we've been here — return without re-placing.
   */
  async handlePayWebhook(body: TipTopPayWebhookBody): Promise<void> {
    const alreadyHandled = await this.wasHandled('pay', body);
    await this.logEvent('pay', body, true);
    if (alreadyHandled) {
      this.logger.warn(
        `Duplicate Pay webhook for transaction ${body.TransactionId} — ignoring.`,
      );
      return;
    }

    const payment = await this.paymentRepo.findOne({
      where: { invoiceId: body.InvoiceId ?? '' },
    });
    if (!payment) {
      this.logger.error(`Pay webhook for unknown invoice ${body.InvoiceId}.`);
      return;
    }

    payment.status = PaymentStatus.PAID;
    payment.transactionId =
      body.TransactionId != null ? String(body.TransactionId) : null;
    payment.cardLastFour = body.CardLastFour ?? null;
    payment.cardType = body.CardType ?? null;
    payment.paidAt = new Date();
    payment.raw = body as unknown as Record<string, unknown>;
    await this.paymentRepo.save(payment);

    await this.orders.placeWithSuppliers(payment.orderId);
  }

  /** Bank declined. The order stays in awaiting_payment — the customer may retry. */
  async handleFailWebhook(body: TipTopPayWebhookBody): Promise<void> {
    await this.logEvent('fail', body, true);

    const payment = await this.paymentRepo.findOne({
      where: { invoiceId: body.InvoiceId ?? '' },
    });
    if (!payment) {
      this.logger.error(`Fail webhook for unknown invoice ${body.InvoiceId}.`);
      return;
    }

    payment.status = PaymentStatus.FAILED;
    payment.failReason = body.Reason ?? body.Status ?? 'Отказ банка';
    payment.raw = body as unknown as Record<string, unknown>;
    await this.paymentRepo.save(payment);
  }

  /** Manager-initiated refund (full or partial). */
  async refund(
    orderId: string,
    amount: number,
    reason: string | null,
  ): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({ where: { orderId } });
    if (!payment) throw new NotFoundException('Платёж не найден.');
    if (
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw new BadRequestException('Возврат возможен только по оплаченному заказу.');
    }
    if (!payment.transactionId) {
      throw new BadRequestException('У платежа нет транзакции в TipTopPay.');
    }

    const remaining = Number(payment.amount) - Number(payment.refundedAmount);
    if (amount <= 0 || amount > remaining) {
      throw new BadRequestException(
        `Сумма возврата должна быть от 0.01 до ${remaining}.`,
      );
    }

    const result = await this.client.refund(payment.transactionId, amount);
    if (!result.Success) {
      throw new BadRequestException(
        `TipTopPay отклонил возврат: ${result.Message ?? 'причина не указана'}`,
      );
    }

    payment.refundedAmount = Number(payment.refundedAmount) + amount;
    payment.status =
      payment.refundedAmount >= Number(payment.amount)
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;
    await this.paymentRepo.save(payment);

    this.logger.log(
      `Refunded ${amount} ${payment.currency} on order ${orderId}. Reason: ${reason ?? '—'}`,
    );

    return payment;
  }
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что проходят**

Run: `npx jest src/payments/payments.service.spec.ts`
Expected: PASS, 14 тестов

- [ ] **Step 5: Коммит**

```bash
git add src/payments/payments.service.ts src/payments/payments.service.spec.ts
git commit -m "feat(payments): PaymentsService with idempotent webhook handling and refunds"
```

---

## Task 6: Контроллеры — init, статус, возврат, вебхуки

**Files:**
- Create: `src/payments/dto/refund.dto.ts`
- Create: `src/payments/payments.controller.ts`
- Create: `src/payments/payments-webhook.controller.ts`
- Create: `src/payments/payments-webhook.controller.spec.ts`
- Create: `src/payments/payments.module.ts`
- Modify: `src/main.ts`
- Modify: `src/app.module.ts`
- Modify: `src/orders/orders.module.ts` (экспорт `OrdersService`)

**Interfaces:**
- Consumes: `PaymentsService` (Task 5), `isValidHmac` (Task 2), `TipTopPayClient` (Task 1).
- Produces: HTTP-эндпоинты `/api/payments/*`, экспортируемый `PaymentsModule`.

- [ ] **Step 1: Написать падающий тест контроллера вебхуков**

Создать `src/payments/payments-webhook.controller.spec.ts`:

```ts
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
    const { controller } = makeController();
    const { req, body } = makeReq(payBody);

    const res = await controller.check(req, body);

    expect(res).toEqual({ code: 0 });
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `npx jest src/payments/payments-webhook.controller.spec.ts`
Expected: FAIL — `Cannot find module './payments-webhook.controller'`

- [ ] **Step 3: Реализовать контроллер вебхуков**

Создать `src/payments/payments-webhook.controller.ts`:

```ts
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PaymentsService, TipTopPayWebhookBody } from './payments.service';
import { PaymentEventType } from './entities/payment-event.entity';
import { TipTopPayClient } from './tiptoppay.client';
import { isValidHmac } from './tiptoppay.hmac';

/** Express request with the raw body captured in main.ts (needed for HMAC). */
type RawRequest = Request & { rawBody?: Buffer };

const OK = { code: 0 };

/**
 * TipTopPay webhooks. Public by necessity — the only auth is the HMAC signature.
 *
 * Every handler answers 200 {"code":0}, even when our own processing blows up: any other
 * response makes TipTopPay treat the callback as failed and retry it indefinitely. A
 * forged signature is the one exception — that gets a 403 and a loud log.
 */
@ApiExcludeController()
@Controller('payments/webhook')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly client: TipTopPayClient,
  ) {}

  @Public()
  @Post('check')
  @HttpCode(HttpStatus.OK)
  async check(@Req() req: RawRequest, @Body() body: TipTopPayWebhookBody) {
    await this.verify(req, 'check', body);
    // Pre-authorization probe: we allow every payment that reached us with a valid
    // signature. Availability was already re-checked at checkout.
    return OK;
  }

  @Public()
  @Post('pay')
  @HttpCode(HttpStatus.OK)
  async pay(@Req() req: RawRequest, @Body() body: TipTopPayWebhookBody) {
    await this.verify(req, 'pay', body);
    try {
      await this.payments.handlePayWebhook(body);
    } catch (err) {
      this.logger.error(
        `Pay webhook processing failed for invoice ${body.InvoiceId}; money is IN, order needs manual attention.`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return OK;
  }

  @Public()
  @Post('fail')
  @HttpCode(HttpStatus.OK)
  async fail(@Req() req: RawRequest, @Body() body: TipTopPayWebhookBody) {
    await this.verify(req, 'fail', body);
    try {
      await this.payments.handleFailWebhook(body);
    } catch (err) {
      this.logger.error(
        `Fail webhook processing failed for invoice ${body.InvoiceId}.`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return OK;
  }

  private async verify(
    req: RawRequest,
    type: PaymentEventType,
    body: TipTopPayWebhookBody,
  ): Promise<void> {
    const signature = req.headers['x-content-hmac'] as string | undefined;
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(body), 'utf8');

    if (!isValidHmac(raw, signature, this.client.apiSecret)) {
      this.logger.error(
        `Forged ${type} webhook rejected: bad X-Content-HMAC for invoice ${body.InvoiceId}.`,
      );
      await this.payments.logEvent(type, body, false);
      throw new ForbiddenException('Invalid signature.');
    }
  }
}
```

Проверить, что декоратор `@Public()` существует по пути `src/auth/decorators/public.decorator.ts` (глобальный `JwtAuthGuard` в `app.module.ts` иначе закроет вебхуки). Если декоратора нет — найти, как в проекте помечаются публичные роуты (`grep -rn "IS_PUBLIC\|@Public" src/auth`), и использовать существующий механизм.

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `npx jest src/payments/payments-webhook.controller.spec.ts`
Expected: PASS, 5 тестов

- [ ] **Step 5: DTO возврата**

Создать `src/payments/dto/refund.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RefundDto {
  @ApiProperty({ description: 'Сумма возврата в тенге', example: 30000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Причина возврата (для журнала)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
```

- [ ] **Step 6: Основной контроллер**

Создать `src/payments/payments.controller.ts`:

```ts
import {
  Body, Controller, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Post, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { RefundDto } from './dto/refund.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { User, UserRole } from '../users/entities/user.entity';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(RolesGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('init')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Подготовить оплату заказа',
    description:
      'Возвращает параметры для платёжного виджета TipTopPay по заказу, ожидающему оплаты: ' +
      'идентификатор терминала, номер счёта и сумму. Сумма берётся из самого заказа — ' +
      'передать свою нельзя. Требует авторизации; заказ должен принадлежать пользователю.',
  })
  @ApiResponse({ status: 400, description: 'Заказ не ожидает оплаты.' })
  @ApiResponse({ status: 403, description: 'Это не ваш заказ.' })
  init(@CurrentUser() user: User, @Body('orderId', ParseUUIDPipe) orderId: string) {
    return this.payments.init(orderId, user.id);
  }

  @Get(':orderId')
  @ApiOperation({
    summary: 'Статус оплаты заказа',
    description:
      'Возвращает платёж по заказу: статус, сумму, сумму возврата, последние 4 цифры карты. ' +
      'Свой заказ видит владелец, любой — менеджер и администратор.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  getByOrder(
    @CurrentUser() user: User,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    const isStaff = user.roles.some(
      (r) => r === UserRole.ADMIN || r === UserRole.MANAGER,
    );
    return this.payments.getByOrder(orderId, user.id, isStaff);
  }

  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Post(':orderId/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Вернуть деньги по заказу (менеджер/админ)',
    description:
      'Делает возврат на карту клиента через TipTopPay — полный или частичный. ' +
      'Используется, когда поставщик не смог выполнить заказ. Сумма не может превышать ' +
      'невозвращённый остаток платежа. Доступно только менеджеру или администратору.',
  })
  @ApiParam({ name: 'orderId', format: 'uuid' })
  @ApiResponse({ status: 400, description: 'Заказ не оплачен или сумма больше остатка.' })
  refund(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: RefundDto) {
    return this.payments.refund(orderId, dto.amount, dto.reason ?? null);
  }
}
```

Сверить с `src/users/entities/user.entity.ts`, как хранятся роли (`user.roles` — массив или одно поле `role`), и привести проверку `isStaff` к фактической форме. Пример проверки в существующем коде: `grep -rn "UserRole.ADMIN" src/auth src/orders | head`.

- [ ] **Step 7: Модуль**

Создать `src/payments/payments.module.ts`:

```ts
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
```

`UnpaidOrdersCron` создаётся в Task 7 — пока закомментировать его импорт и запись в `providers`, а в Task 7 раскомментировать.

- [ ] **Step 8: Экспортировать `OrdersService` из `OrdersModule`**

В `src/orders/orders.module.ts` добавить в декоратор:

```ts
  exports: [OrdersService],
```

- [ ] **Step 9: Подключить `PaymentsModule` в `app.module.ts`**

Добавить импорт `import { PaymentsModule } from './payments/payments.module';` и вписать `PaymentsModule` в массив `imports` (после `OrdersModule`).

- [ ] **Step 10: Включить `rawBody` для вебхуков в `main.ts`**

В `src/main.ts` заменить создание приложения и добавить middleware **до** `app.listen`:

```ts
import 'dotenv/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
import * as express from 'express';
import type { Request } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // TipTopPay signs webhooks with an HMAC over the RAW request body. Express would hand us
  // only the parsed object, and re-serializing it changes key order/whitespace — the
  // signature would never match. Capture the raw buffer, but ONLY on the webhook path.
  app.use(
    '/api/payments/webhook',
    express.json({
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );
  // TipTopPay may also post application/x-www-form-urlencoded.
  app.use(
    '/api/payments/webhook',
    express.urlencoded({
      extended: true,
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );
  ...
```

Остальную часть `bootstrap()` (useContainer, setGlobalPrefix, Swagger, pipes, CORS, listen) оставить без изменений.

- [ ] **Step 11: Собрать и прогнать все тесты**

Run: `npm run build && npx jest`
Expected: сборка чистая, все тесты зелёные.

- [ ] **Step 12: Поднять API и проверить, что вебхук отбивает подделку**

Run:
```bash
kill $(ss -ltnp | grep ':3100' | sed -E 's/.*pid=([0-9]+).*/\1/') 2>/dev/null
PORT=3100 setsid nohup node dist/main > /tmp/optparts-api.log 2>&1 < /dev/null &
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3100/api/payments/webhook/pay \
  -H 'Content-Type: application/json' \
  -H 'X-Content-HMAC: forged' \
  -d '{"TransactionId":1,"InvoiceId":"OP-NOPE"}'
```
Expected: `403`

Проверить, что в `payment_events` появилась строка с `hmacValid=false`:
```bash
docker exec optparts_smoke_db psql -U postgres -d nestjs_auth -c 'SELECT type, "hmacValid" FROM payment_events ORDER BY "createdAt" DESC LIMIT 1;'
```
Expected: `pay | f`

- [ ] **Step 13: Коммит**

```bash
git add src/payments src/main.ts src/app.module.ts src/orders/orders.module.ts
git commit -m "feat(payments): init/status/refund endpoints and HMAC-verified TipTopPay webhooks"
```

---

## Task 7: Крон авто-отмены неоплаченных заказов

**Files:**
- Create: `src/payments/unpaid-orders.cron.ts`
- Create: `src/payments/unpaid-orders.cron.spec.ts`
- Modify: `src/payments/payments.module.ts` (раскомментировать провайдер)

**Interfaces:**
- Consumes: `Order`, `OrderStatus.AWAITING_PAYMENT`.
- Produces: `class UnpaidOrdersCron { handle(): Promise<number> }` — возвращает число отменённых заказов.

- [ ] **Step 1: Написать падающий тест**

Создать `src/payments/unpaid-orders.cron.spec.ts`:

```ts
import { UnpaidOrdersCron, UNPAID_ORDER_TTL_MINUTES } from './unpaid-orders.cron';
import { OrderStatus } from '../orders/entities/order.entity';

function makeCron(stale: any[]) {
  const orderRepo = {
    find: jest.fn(async () => stale),
    save: jest.fn(async (orders: any[]) => orders),
  };
  return { cron: new UnpaidOrdersCron(orderRepo as any), orderRepo };
}

describe('UnpaidOrdersCron', () => {
  it('cancels orders left unpaid past the TTL', async () => {
    const stale = [
      { id: 'o1', status: OrderStatus.AWAITING_PAYMENT },
      { id: 'o2', status: OrderStatus.AWAITING_PAYMENT },
    ];
    const { cron, orderRepo } = makeCron(stale);

    const cancelled = await cron.handle();

    expect(cancelled).toBe(2);
    expect(stale[0].status).toBe(OrderStatus.CANCELLED);
    expect(stale[1].status).toBe(OrderStatus.CANCELLED);
    expect(orderRepo.save).toHaveBeenCalledWith(stale);
  });

  it('queries only awaiting_payment orders older than the TTL', async () => {
    const { cron, orderRepo } = makeCron([]);

    await cron.handle();

    const where = orderRepo.find.mock.calls[0][0].where;
    expect(where.status).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(where.createdAt).toBeDefined();
  });

  it('does nothing when there is nothing to cancel', async () => {
    const { cron, orderRepo } = makeCron([]);

    const cancelled = await cron.handle();

    expect(cancelled).toBe(0);
    expect(orderRepo.save).not.toHaveBeenCalled();
  });

  it('uses a 30 minute TTL', () => {
    expect(UNPAID_ORDER_TTL_MINUTES).toBe(30);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `npx jest src/payments/unpaid-orders.cron.spec.ts`
Expected: FAIL — `Cannot find module './unpaid-orders.cron'`

- [ ] **Step 3: Реализовать**

Создать `src/payments/unpaid-orders.cron.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Order, OrderStatus } from '../orders/entities/order.entity';

/** How long an order may sit unpaid before it is cancelled. */
export const UNPAID_ORDER_TTL_MINUTES = 30;

/**
 * Cancels orders the customer created but never paid for.
 *
 * Without this the orders table fills up with abandoned carts, and "Мои заказы" shows the
 * customer a growing pile of dead orders with a live "Оплатить" button on stale prices.
 */
@Injectable()
export class UnpaidOrdersCron {
  private readonly logger = new Logger(UnpaidOrdersCron.name);
  private running = false;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'cancel-unpaid-orders' })
  async handleCron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cancelled = await this.handle();
      if (cancelled > 0) {
        this.logger.log(`Cancelled ${cancelled} unpaid order(s).`);
      }
    } catch (err) {
      this.logger.error(
        'Unpaid-order sweep failed.',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.running = false;
    }
  }

  async handle(): Promise<number> {
    const cutoff = new Date(Date.now() - UNPAID_ORDER_TTL_MINUTES * 60_000);
    const stale = await this.orderRepo.find({
      where: {
        status: OrderStatus.AWAITING_PAYMENT,
        createdAt: LessThan(cutoff),
      },
    });
    if (stale.length === 0) return 0;

    for (const order of stale) {
      order.status = OrderStatus.CANCELLED;
    }
    await this.orderRepo.save(stale);
    return stale.length;
  }
}
```

- [ ] **Step 4: Подключить в модуле**

В `src/payments/payments.module.ts` раскомментировать импорт `UnpaidOrdersCron` и его запись в `providers`.

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `npx jest src/payments && npm run build`
Expected: PASS, сборка чистая.

- [ ] **Step 6: Коммит**

```bash
git add src/payments/unpaid-orders.cron.ts src/payments/unpaid-orders.cron.spec.ts src/payments/payments.module.ts
git commit -m "feat(payments): cancel orders left unpaid for 30 minutes"
```

---

## Task 8: Фронт — реквизиты и юридические страницы

Тестов на фронте нет (в `package.json` нет тест-раннера) — проверка через `npm run lint` (это `tsc --noEmit`) и глазами в браузере.

**Files:**
- Create: `src/data/company.ts`
- Create: `src/pages/legal/LegalPage.tsx`
- Create: `src/pages/legal/Offer.tsx`
- Create: `src/pages/legal/Privacy.tsx`
- Create: `src/pages/legal/Delivery.tsx`
- Create: `src/pages/legal/Returns.tsx`
- Create: `src/pages/legal/Contacts.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Footer.tsx`

Все пути — относительно `/home/mans/projects/Dana/front`.

**Interfaces:**
- Consumes: ничего.
- Produces: `export const COMPANY` (см. ниже), компоненты страниц, роуты `/offer`, `/privacy`, `/delivery`, `/returns`, `/contacts`.

- [ ] **Step 1: Реквизиты**

Создать `src/data/company.ts`:

```ts
/**
 * Реквизиты продавца — единственный источник правды.
 * Используются в юридических страницах и футере. Правятся только здесь.
 */
export const COMPANY = {
  legalName: 'ИП «Балпуков Бауыржан Жанбырбекович»',
  shortName: 'OptParts',
  bin: '840207301018',
  address: 'Республика Казахстан, г. Астана, ул. 23-15, дом 9/3, кв./офис 25',
  phone: '+7 717 123 45 56',
  phoneHref: 'tel:+77171234556',
  email: 'support@optparts.kz',
  workingHours: 'Пн–Пт, 9:00–18:00',
  site: 'optparts.kz',
  bank: {
    name: 'АО «Kaspi Bank»',
    bik: 'CASPKZKA',
    kbe: '19',
    iik: 'KZ34722S000012791299',
  },
} as const;
```

- [ ] **Step 2: Обёртка юр-страницы**

Создать `src/pages/legal/LegalPage.tsx`:

```tsx
import React from 'react';

interface LegalPageProps {
  title: string;
  updatedAt?: string;
  children: React.ReactNode;
}

/**
 * Общий каркас юридических страниц: заголовок, дата редакции и типографика текста.
 * Заголовки/абзацы/списки внутри children стилизуются здесь, чтобы страницы содержали
 * только текст, а не разметку.
 */
export const LegalPage: React.FC<LegalPageProps> = ({ title, updatedAt, children }) => (
  <div className="bg-slate-50 min-h-screen py-8">
    <div className="max-w-3xl mx-auto px-4 md:px-6">
      <div className="bg-white border border-slate-200 rounded-lg p-6 sm:p-10">
        <h1 className="text-[22px] sm:text-[26px] font-bold text-slate-900 mb-2">{title}</h1>
        {updatedAt && (
          <p className="text-[12px] text-slate-400 mb-6">Редакция от {updatedAt}</p>
        )}
        <div
          className="
            text-[14px] leading-relaxed text-slate-700 space-y-4
            [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-8 [&_h2]:mb-2
            [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1
            [&_a]:text-orange-500 [&_a]:font-semibold
            [&_dl]:grid [&_dl]:gap-1
          "
        >
          {children}
        </div>
      </div>
    </div>
  </div>
);
```

- [ ] **Step 3: Публичная оферта**

Создать `src/pages/legal/Offer.tsx`:

```tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { LegalPage } from './LegalPage';
import { COMPANY } from '../../data/company';

export const Offer: React.FC = () => (
  <LegalPage title="Публичный договор-оферта" updatedAt="14 июля 2026 г.">
    <p>
      Настоящий документ является официальным публичным предложением (офертой) {COMPANY.legalName}
      {' '}(далее — «Продавец») заключить договор купли-продажи автозапчастей дистанционным способом
      на условиях, изложенных ниже. Оформление заказа на сайте {COMPANY.site} означает полное и
      безоговорочное принятие условий настоящей оферты (акцепт).
    </p>

    <h2>1. Предмет договора</h2>
    <p>
      Продавец обязуется передать в собственность Покупателю автозапчасти и сопутствующие товары
      (далее — «Товар»), а Покупатель обязуется принять и оплатить Товар на условиях настоящей
      оферты. Товар поставляется от партнёров-поставщиков Продавца; наличие, цена и срок поставки
      каждой позиции проверяются в момент оформления заказа.
    </p>

    <h2>2. Оформление заказа</h2>
    <ul>
      <li>Покупатель формирует корзину и оформляет заказ на сайте, указывая способ получения (доставка или самовывоз), адрес, имя и телефон получателя.</li>
      <li>Перед созданием заказа система повторно сверяет наличие и цену каждой позиции у поставщика. Если наличие или цена изменились, заказ не создаётся, и Покупателю предлагается пересмотреть корзину.</li>
      <li>Заказ считается принятым к исполнению после поступления оплаты.</li>
    </ul>

    <h2>3. Цена и порядок оплаты</h2>
    <ul>
      <li>Цены на сайте указаны в тенге (₸) и включают все применимые налоги.</li>
      <li>Оплата производится онлайн банковской картой Visa или Mastercard через платёжный сервис TipTop Pay с обязательной аутентификацией 3-D Secure.</li>
      <li>Данные банковской карты вводятся на защищённой странице платёжного сервиса и Продавцу не передаются и им не хранятся.</li>
      <li>Заказ передаётся поставщикам только после подтверждения оплаты.</li>
      <li>Если после оплаты часть позиций не может быть поставлена, Продавец информирует Покупателя и возвращает денежные средства за непоставленные позиции в порядке, описанном в разделе <Link to="/returns">«Возврат и обмен»</Link>.</li>
    </ul>

    <h2>4. Доставка и передача Товара</h2>
    <p>
      Способы получения, сроки и стоимость доставки описаны в разделе{' '}
      <Link to="/delivery">«Доставка и оплата»</Link>. Срок поставки каждой позиции зависит от
      поставщика и указывается при оформлении заказа. Право собственности на Товар переходит к
      Покупателю в момент его передачи.
    </p>

    <h2>5. Права и обязанности сторон</h2>
    <ul>
      <li>Продавец обязуется передать Товар надлежащего качества, в согласованном количестве и в согласованный срок.</li>
      <li>Покупатель обязуется предоставить достоверные данные для доставки и связи, принять и оплатить Товар.</li>
      <li>Покупатель обязан проверить комплектность и внешнее состояние Товара при получении.</li>
      <li>Продавец не несёт ответственности за неверный подбор Товара, если Покупатель самостоятельно выбрал позицию без учёта совместимости со своим транспортным средством.</li>
    </ul>

    <h2>6. Возврат Товара и денежных средств</h2>
    <p>
      Возврат осуществляется в соответствии с Законом Республики Казахстан «О защите прав
      потребителей». Порядок и сроки — в разделе <Link to="/returns">«Возврат и обмен»</Link>.
    </p>

    <h2>7. Персональные данные</h2>
    <p>
      Оформляя заказ, Покупатель даёт согласие на обработку своих персональных данных на условиях,
      описанных в <Link to="/privacy">Политике конфиденциальности</Link>.
    </p>

    <h2>8. Реквизиты Продавца</h2>
    <ul>
      <li>Наименование: {COMPANY.legalName}</li>
      <li>ИИН/БИН: {COMPANY.bin}</li>
      <li>Адрес: {COMPANY.address}</li>
      <li>Телефон: {COMPANY.phone}</li>
      <li>Email: {COMPANY.email}</li>
      <li>Банк: {COMPANY.bank.name}, БИК {COMPANY.bank.bik}, КБе {COMPANY.bank.kbe}</li>
      <li>ИИК: {COMPANY.bank.iik}</li>
    </ul>
  </LegalPage>
);
```

- [ ] **Step 4: Политика конфиденциальности**

Создать `src/pages/legal/Privacy.tsx`:

```tsx
import React from 'react';
import { LegalPage } from './LegalPage';
import { COMPANY } from '../../data/company';

export const Privacy: React.FC = () => (
  <LegalPage title="Политика конфиденциальности" updatedAt="14 июля 2026 г.">
    <p>
      {COMPANY.legalName} (далее — «Оператор») уважает право пользователей на приватность и
      обрабатывает персональные данные в соответствии с Законом Республики Казахстан
      «О персональных данных и их защите».
    </p>

    <h2>1. Какие данные мы собираем</h2>
    <ul>
      <li>Имя и фамилия — для оформления заказа и обращения к получателю.</li>
      <li>Номер телефона — для связи по заказу и доставке.</li>
      <li>Адрес электронной почты — для регистрации, входа и уведомлений о заказе.</li>
      <li>Адрес доставки — для передачи Товара.</li>
      <li>История заказов и содержимое корзины — для обслуживания заказов и поддержки.</li>
      <li>Технические данные (IP-адрес, тип браузера) — для безопасности и работоспособности сайта.</li>
    </ul>

    <h2>2. Данные банковской карты</h2>
    <p>
      <strong>Мы не собираем, не обрабатываем и не храним данные вашей банковской карты.</strong>{' '}
      Номер карты, срок действия и CVV вводятся на защищённой странице платёжного сервиса
      TipTop Pay и передаются напрямую ему. Оператор получает от платёжного сервиса только
      результат платежа, тип карты и последние четыре цифры её номера — этого достаточно для
      идентификации платежа и возврата.
    </p>

    <h2>3. Цели обработки</h2>
    <ul>
      <li>Оформление, оплата и исполнение заказов, включая передачу необходимых данных поставщикам и службам доставки.</li>
      <li>Связь с пользователем по вопросам заказа.</li>
      <li>Исполнение требований законодательства.</li>
    </ul>

    <h2>4. Передача третьим лицам</h2>
    <p>
      Данные передаются только в объёме, необходимом для исполнения заказа: поставщикам запчастей
      (артикул, количество, данные для отгрузки), службам доставки (имя, телефон, адрес) и
      платёжному сервису TipTop Pay (сумма и номер счёта). Мы не продаём и не передаём персональные
      данные в рекламных целях.
    </p>

    <h2>5. Срок хранения</h2>
    <p>
      Данные заказов хранятся в течение срока, установленного законодательством для документов
      бухгалтерского и налогового учёта. Данные учётной записи хранятся до её удаления
      пользователем.
    </p>

    <h2>6. Права пользователя</h2>
    <p>
      Пользователь вправе запросить доступ к своим персональным данным, их исправление,
      блокирование или удаление, а также отозвать согласие на обработку. Для этого напишите на{' '}
      <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> или позвоните по телефону{' '}
      <a href={COMPANY.phoneHref}>{COMPANY.phone}</a>.
    </p>

    <h2>7. Защита данных</h2>
    <p>
      Сайт работает по протоколу HTTPS. Пароли хранятся в виде необратимых хешей. Доступ к
      персональным данным имеют только сотрудники, которым он необходим для обслуживания заказов.
    </p>

    <h2>8. Контакты оператора</h2>
    <ul>
      <li>{COMPANY.legalName}</li>
      <li>ИИН/БИН: {COMPANY.bin}</li>
      <li>{COMPANY.address}</li>
      <li><a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a></li>
    </ul>
  </LegalPage>
);
```

- [ ] **Step 5: Доставка и оплата**

Создать `src/pages/legal/Delivery.tsx`:

```tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { LegalPage } from './LegalPage';
import { COMPANY } from '../../data/company';

export const Delivery: React.FC = () => (
  <LegalPage title="Доставка и оплата" updatedAt="14 июля 2026 г.">
    <h2>Способы получения</h2>
    <ul>
      <li><strong>Доставка</strong> — по адресу, указанному при оформлении заказа. Стоимость и срок рассчитываются при оформлении.</li>
      <li><strong>Самовывоз</strong> — из пункта выдачи по адресу: {COMPANY.address}. Режим работы: {COMPANY.workingHours}.</li>
    </ul>

    <h2>Сроки поставки</h2>
    <p>
      Запчасти поставляются от партнёров-поставщиков, поэтому срок зависит от конкретной позиции и
      склада, с которого она отгружается. Ожидаемый срок в днях показывается для каждой позиции при
      выборе предложения и фиксируется в заказе. После оплаты заказ передаётся поставщикам, и вы
      можете отслеживать его статус в разделе «Мои заказы».
    </p>

    <h2>Оплата</h2>
    <ul>
      <li>Оплата производится онлайн банковской картой <strong>Visa</strong> или <strong>Mastercard</strong>.</li>
      <li>Платежи обрабатывает сервис <strong>TipTop Pay</strong>. Ввод карты происходит на защищённой странице платёжного сервиса; данные карты нам не передаются и у нас не хранятся.</li>
      <li>Все платежи проходят обязательную аутентификацию <strong>3-D Secure</strong> — банк-эмитент подтверждает операцию кодом.</li>
      <li>Цены указаны в тенге (₸) и включают все применимые налоги.</li>
      <li>Заказ передаётся поставщикам только после подтверждения оплаты.</li>
    </ul>

    <h2>Если позицию не удалось заказать</h2>
    <p>
      Если после оплаты поставщик не смог подтвердить какую-либо позицию, мы связываемся с вами и
      возвращаем деньги за непоставленные позиции. Порядок описан в разделе{' '}
      <Link to="/returns">«Возврат и обмен»</Link>.
    </p>

    <h2>Вопросы</h2>
    <p>
      Телефон: <a href={COMPANY.phoneHref}>{COMPANY.phone}</a>, email:{' '}
      <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>. {COMPANY.workingHours}.
    </p>
  </LegalPage>
);
```

- [ ] **Step 6: Возврат и обмен**

Создать `src/pages/legal/Returns.tsx`:

```tsx
import React from 'react';
import { LegalPage } from './LegalPage';
import { COMPANY } from '../../data/company';

export const Returns: React.FC = () => (
  <LegalPage title="Возврат и обмен" updatedAt="14 июля 2026 г.">
    <p>
      Возврат и обмен Товара осуществляются в соответствии с Законом Республики Казахстан
      «О защите прав потребителей».
    </p>

    <h2>1. Возврат Товара надлежащего качества</h2>
    <ul>
      <li>Покупатель вправе отказаться от Товара надлежащего качества в течение <strong>14 календарных дней</strong> с момента получения, если Товар не был в употреблении, сохранены его товарный вид, потребительские свойства, упаковка, пломбы и ярлыки, а также документ, подтверждающий покупку.</li>
      <li>Не подлежат возврату Товары, изготовленные или заказанные индивидуально под транспортное средство Покупателя, а также электротехнические изделия со вскрытой упаковкой, если это прямо оговорено при заказе.</li>
    </ul>

    <h2>2. Возврат Товара ненадлежащего качества</h2>
    <ul>
      <li>При обнаружении недостатков Покупатель вправе требовать замены Товара, соразмерного уменьшения цены или возврата уплаченной суммы.</li>
      <li>Требование предъявляется в течение гарантийного срока, установленного производителем, а при его отсутствии — в разумный срок, но не более двух лет со дня передачи Товара.</li>
      <li>Товар может быть направлен на проверку качества; срок проверки согласовывается с Покупателем.</li>
    </ul>

    <h2>3. Если позицию не удалось заказать у поставщика</h2>
    <p>
      Заказ передаётся поставщикам только после оплаты. Если поставщик не смог подтвердить какую-либо
      позицию, мы связываемся с Покупателем и возвращаем денежные средства за непоставленные позиции
      — полностью или частично, в зависимости от того, что именно не удалось поставить. Отдельного
      заявления от Покупателя для этого не требуется.
    </p>

    <h2>4. Порядок возврата денежных средств</h2>
    <ul>
      <li>Денежные средства возвращаются <strong>на ту же банковскую карту</strong>, с которой была произведена оплата. Возврат другим способом или на другую карту невозможен.</li>
      <li>Возврат инициируется в течение <strong>3 рабочих дней</strong> с момента согласования возврата.</li>
      <li>Срок зачисления средств на карту зависит от банка-эмитента и обычно составляет <strong>от 3 до 10 рабочих дней</strong> с момента инициирования возврата.</li>
    </ul>

    <h2>5. Как оформить возврат</h2>
    <p>
      Напишите на <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> или позвоните по телефону{' '}
      <a href={COMPANY.phoneHref}>{COMPANY.phone}</a> ({COMPANY.workingHours}), указав номер заказа и
      причину возврата. Менеджер согласует с вами порядок передачи Товара и оформит возврат.
    </p>
  </LegalPage>
);
```

- [ ] **Step 7: Контакты**

Создать `src/pages/legal/Contacts.tsx`:

```tsx
import React from 'react';
import { LegalPage } from './LegalPage';
import { COMPANY } from '../../data/company';

export const Contacts: React.FC = () => (
  <LegalPage title="Контакты">
    <h2>Связаться с нами</h2>
    <ul>
      <li>Телефон: <a href={COMPANY.phoneHref}>{COMPANY.phone}</a></li>
      <li>Email: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a></li>
      <li>Режим работы: {COMPANY.workingHours}</li>
      <li>Адрес: {COMPANY.address}</li>
    </ul>

    <h2>Реквизиты продавца</h2>
    <ul>
      <li>Наименование: {COMPANY.legalName}</li>
      <li>ИИН/БИН: {COMPANY.bin}</li>
      <li>Юридический адрес: {COMPANY.address}</li>
      <li>Банк: {COMPANY.bank.name}</li>
      <li>БИК: {COMPANY.bank.bik}</li>
      <li>КБе: {COMPANY.bank.kbe}</li>
      <li>ИИК: {COMPANY.bank.iik}</li>
    </ul>
  </LegalPage>
);
```

- [ ] **Step 8: Роуты**

В `src/App.tsx` добавить импорты и роуты рядом с `/about`:

```tsx
import { Offer } from './pages/legal/Offer';
import { Privacy } from './pages/legal/Privacy';
import { Delivery } from './pages/legal/Delivery';
import { Returns } from './pages/legal/Returns';
import { Contacts } from './pages/legal/Contacts';
```

```tsx
          <Route path="/offer" element={<Offer />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/delivery" element={<Delivery />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/contacts" element={<Contacts />} />
```

Существующий роут `<Route path="/contact" element={<About />} />` заменить на `<Route path="/contact" element={<Contacts />} />`, чтобы старая ссылка вела на настоящие контакты.

- [ ] **Step 9: Футер**

В `src/components/Footer.tsx`:

1. Заменить ссылки в блоке «Обслуживание клиентов» (сейчас четыре из них ведут на `/about`):

```tsx
              <li><Link to="/profile" className="block py-2 hover:text-orange-500 transition-colors">Мой аккаунт</Link></li>
              <li><Link to="/profile" className="block py-2 hover:text-orange-500 transition-colors">История заказов</Link></li>
              <li><Link to="/delivery" className="block py-2 hover:text-orange-500 transition-colors">Доставка и оплата</Link></li>
              <li><Link to="/returns" className="block py-2 hover:text-orange-500 transition-colors">Возврат и обмен</Link></li>
              <li><Link to="/contacts" className="block py-2 hover:text-orange-500 transition-colors">Связаться с нами</Link></li>
```

2. Заменить нижние ссылки:

```tsx
            <Link to="/privacy" className="hover:text-white transition-colors">Политика конфиденциальности</Link>
            <Link to="/offer" className="hover:text-white transition-colors">Публичный договор-оферта</Link>
```

3. Добавить над нижними ссылками блок платёжных систем (SVG-логотипы инлайном, без внешних запросов):

```tsx
          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-5 py-4 border-t border-slate-800">
            <div className="flex items-center gap-3">
              <svg viewBox="0 0 48 16" className="h-5 w-auto" aria-label="Visa" role="img">
                <text x="0" y="13" fill="#ffffff" fontFamily="Arial, sans-serif" fontSize="14" fontWeight="700" fontStyle="italic">VISA</text>
              </svg>
              <svg viewBox="0 0 40 24" className="h-5 w-auto" aria-label="Mastercard" role="img">
                <circle cx="15" cy="12" r="9" fill="#EB001B" />
                <circle cx="25" cy="12" r="9" fill="#F79E1B" fillOpacity="0.85" />
              </svg>
            </div>
            <p className="text-[11px] text-slate-400 text-center sm:text-left">
              Оплата защищена 3-D Secure. Данные карты не сохраняются на нашем сайте — их
              обрабатывает платёжный сервис TipTop Pay.
            </p>
          </div>
```

4. Добавить строку с реквизитами в самый низ футера, импортировав `COMPANY`:

```tsx
import { COMPANY } from '../data/company';
```

```tsx
          <p className="text-[11px] text-slate-500 pt-3">
            {COMPANY.legalName} · ИИН/БИН {COMPANY.bin} · {COMPANY.address}
          </p>
```

- [ ] **Step 10: Проверить типы и посмотреть глазами**

Run (из `/home/mans/projects/Dana/front`):
```bash
npm run lint
```
Expected: без ошибок.

Открыть в браузере `http://localhost:3000/#/offer`, `/#/privacy`, `/#/delivery`, `/#/returns`, `/#/contacts` — страницы открываются **без авторизации**, реквизиты видны, ссылки в футере ведут куда надо.

- [ ] **Step 11: Коммит**

```bash
git add src/data/company.ts src/pages/legal src/App.tsx src/components/Footer.tsx
git commit -m "feat(legal): offer, privacy, delivery, returns and contacts pages required by the acquirer"
```

---

## Task 9: Фронт — виджет оплаты на чекауте

**Files:**
- Create: `src/hooks/useTipTopPay.ts`
- Modify: `src/api.ts`
- Modify: `src/pages/Checkout.tsx`

Все пути — относительно `/home/mans/projects/Dana/front`.

**Interfaces:**
- Consumes: `POST /api/payments/init` (Task 6).
- Produces:
  ```ts
  export interface PaymentInit {
    publicTerminalId: string;
    invoiceId: string;
    amount: number;
    currency: string;
    accountId: string;
    description: string;
  }
  export const paymentsApi = {
    init(token: string, orderId: string): Promise<PaymentInit>;
    get(token: string, orderId: string): Promise<PaymentView>;
  };
  export function useTipTopPay(): { startPayment(init: PaymentInit): Promise<TipTopPayResult> };
  ```

- [ ] **Step 1: Сверить контракт виджета с живой документацией**

Перед написанием кода открыть https://developers.tiptoppay.kz и раздел про виджет, и **подтвердить три вещи**:

1. Имя глобального объекта и конструктор — в документации это `new tiptop.Widget()`.
2. Как передаётся номер счёта: в `intentParams` поле называется `externalId`, а в теле вебхука приходит `InvoiceId`. Убедиться, что это одно и то же значение (проще всего — оплатить тестовой картой и посмотреть в `payment_events`, что пришло в `InvoiceId`).
3. Значение `paymentSchema` для одностадийного платежа — `'Single'`.

Если что-то расходится — привести код ниже в соответствие документации, а не наоборот. **Не додумывать поля.**

- [ ] **Step 2: API-клиент**

В `src/api.ts` после `ordersApi` добавить:

```ts
export interface PaymentInit {
  publicTerminalId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  accountId: string;
  description: string;
}

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export interface PaymentView {
  id: string;
  orderId: string;
  invoiceId: string;
  amount: number | string;
  currency: string;
  status: PaymentStatus;
  cardLastFour: string | null;
  cardType: string | null;
  refundedAmount: number | string;
  failReason: string | null;
  paidAt: string | null;
}

export const paymentsApi = {
  init: (token: string, orderId: string) =>
    apiRequest<PaymentInit>('/api/payments/init', {
      method: 'POST',
      token,
      body: { orderId },
    }),
  get: (token: string, orderId: string) =>
    apiRequest<PaymentView>(`/api/payments/${orderId}`, { token }),
};
```

- [ ] **Step 3: Хук виджета**

Создать `src/hooks/useTipTopPay.ts`:

```ts
import { useCallback } from 'react';
import type { PaymentInit } from '../api';

const WIDGET_SRC = 'https://widget.tiptoppay.kz/bundles/widget.js';

export type TipTopPayResult =
  | { status: 'success' }
  | { status: 'fail'; reason: string }
  | { status: 'cancelled' };

declare global {
  interface Window {
    tiptop?: { Widget: new () => TipTopWidget };
  }
}

interface TipTopWidget {
  oncomplete: (result: { success?: boolean; message?: string }) => void;
  start(params: Record<string, unknown>): void;
}

let loading: Promise<void> | null = null;

/** Загружает widget.js один раз на всю сессию. */
function loadWidget(): Promise<void> {
  if (window.tiptop) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error('Не удалось загрузить платёжный виджет. Проверьте соединение.'));
    };
    document.head.appendChild(script);
  });

  return loading;
}

/**
 * Открывает платёжный виджет TipTopPay и ждёт его завершения.
 *
 * Виджет сам проводит 3-D Secure внутри своего iframe — данные карты на наш сайт не
 * попадают. Возвращённый статус — только для UI: источником правды об оплате остаётся
 * вебхук на бэкенде.
 */
export function useTipTopPay() {
  const startPayment = useCallback(async (init: PaymentInit): Promise<TipTopPayResult> => {
    await loadWidget();

    if (!window.tiptop) {
      throw new Error('Платёжный виджет недоступен.');
    }

    return new Promise<TipTopPayResult>((resolve) => {
      const widget = new window.tiptop!.Widget();

      widget.oncomplete = (result) => {
        if (result?.success) {
          resolve({ status: 'success' });
          return;
        }
        resolve({
          status: 'fail',
          reason: result?.message || 'Платёж не прошёл. Попробуйте другую карту.',
        });
      };

      widget.start({
        publicTerminalId: init.publicTerminalId,
        amount: init.amount,
        currency: init.currency,
        paymentSchema: 'Single',
        description: init.description,
        externalId: init.invoiceId,
        accountId: init.accountId,
        culture: 'ru-RU',
        skin: 'classic',
      });
    });
  }, []);

  return { startPayment };
}
```

- [ ] **Step 4: Чекаут — чекбокс оферты и запуск виджета**

В `src/pages/Checkout.tsx`:

1. Импорты:

```tsx
import { paymentsApi, addressesApi, getApiErrorMessage } from '../api';
import { useTipTopPay } from '../hooks/useTipTopPay';
```

2. Состояние (рядом с остальными `useState`):

```tsx
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const { startPayment } = useTipTopPay();
```

3. Условие отправки — добавить согласие:

```tsx
  const canSubmit =
    items.length > 0 &&
    hasRecipientInfo &&
    hasAddress &&
    acceptedTerms &&
    !createOrder.isPending &&
    !isPaying;
```

4. Заменить `submit()` — после создания заказа открываем виджет вместо редиректа:

```tsx
  const submit = async () => {
    if (isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;

    setError(null);

    try {
      await persistNewPhoneIfNeeded();

      const order = await ordersApi.create(useAuthStore.getState().accessToken ?? '', {
        deliveryType,
        addressId: isDelivery ? addressId : undefined,
        recipientName: recipientName.trim() || undefined,
        recipientPhone: recipientPhone || undefined,
        customerComment: customerComment.trim() || undefined,
      });

      setIsPaying(true);

      const token = useAuthStore.getState().accessToken ?? '';
      const init = await paymentsApi.init(token, order.id);
      const result = await startPayment(init);

      if (result.status === 'success') {
        // The webhook is what actually confirms the payment; /success polls for it.
        await queryClient.invalidateQueries({ queryKey: ['cart'] });
        navigate(`/success?order=${encodeURIComponent(order.id)}`);
        return;
      }

      if (result.status === 'fail') {
        setError(`${result.reason} Заказ сохранён — его можно оплатить в разделе «Мои заказы».`);
      } else {
        setError('Оплата отменена. Заказ сохранён — его можно оплатить в разделе «Мои заказы».');
      }
    } catch (e) {
      setError(getApiErrorMessage(e));
    } finally {
      setIsPaying(false);
      isSubmittingRef.current = false;
    }
  };
```

Импортировать `ordersApi` из `../api` (сейчас страница создаёт заказ через `useCreateOrder()` — мутация больше не подходит, потому что после неё нужно продолжить цепочку). Хук `useCreateOrder` из импортов убрать, если он больше нигде на странице не используется, и оставить `useAddresses`.

5. В блоке «Ваш заказ», над кнопкой, добавить чекбокс:

```tsx
                <label className="mt-4 flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="text-[12px] text-slate-500 leading-snug">
                    Я согласен с{' '}
                    <Link to="/offer" target="_blank" className="text-orange-500 font-semibold">
                      публичной офертой
                    </Link>{' '}
                    и{' '}
                    <Link to="/privacy" target="_blank" className="text-orange-500 font-semibold">
                      политикой конфиденциальности
                    </Link>
                  </span>
                </label>
```

6. Заменить текст кнопки на «Перейти к оплате» и учесть новый спиннер:

```tsx
                <button
                  onClick={submit}
                  disabled={!canSubmit || isSavingPhone}
                  className="w-full mt-4 min-h-[44px] bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-[14px] font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {isPaying || isSavingPhone ? <Loader2 size={18} className="animate-spin" /> : null}
                  Перейти к оплате
                </button>
```

- [ ] **Step 5: Проверить типы**

Run (из `/home/mans/projects/Dana/front`): `npm run lint`
Expected: без ошибок.

- [ ] **Step 6: Прогон оплаты тестовой картой**

Поднять бэкенд на `:3100` (см. Task 6 Step 12) и фронт (`npm run dev`, `:3000`).
Оформить заказ → должен открыться виджет TipTopPay → оплатить тестовой картой с 3-D Secure (карты — в личном кабинете TipTopPay).

Вебхук от TipTopPay не долетит до `localhost`, поэтому проверить обработчик локально, подписав тело тем же `TIPTOPPAY_API_SECRET`:

```bash
BODY='{"TransactionId":1,"InvoiceId":"<invoiceId из БД>","Amount":1000,"Currency":"KZT","CardLastFour":"4242","CardType":"Visa","Status":"Completed"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$TIPTOPPAY_API_SECRET" -binary | base64)
curl -s -X POST http://localhost:3100/api/payments/webhook/pay \
  -H 'Content-Type: application/json' -H "X-Content-HMAC: $SIG" -d "$BODY"
```
Expected: `{"code":0}`, а в БД заказ переходит из `awaiting_payment` в `placed` / `partially_placed` / `cancelled`.

- [ ] **Step 7: Коммит**

```bash
git add src/hooks/useTipTopPay.ts src/api.ts src/pages/Checkout.tsx
git commit -m "feat(checkout): pay with the TipTopPay widget before the order reaches suppliers"
```

---

## Task 10: Фронт — страница успеха и оплата из «Моих заказов»

**Files:**
- Modify: `src/pages/OrderSuccess.tsx`
- Modify: `src/hooks/useOrders.ts`
- Modify: `src/pages/OrderDetails.tsx`

Все пути — относительно `/home/mans/projects/Dana/front`.

**Interfaces:**
- Consumes: `paymentsApi` (Task 9), `useTipTopPay` (Task 9).
- Produces: `export function usePayment(orderId: string | undefined, poll: boolean)`.

- [ ] **Step 1: Хук статуса платежа с опросом**

В `src/hooks/useOrders.ts` добавить:

```ts
import { addressesApi, ordersApi, paymentsApi } from '../api';

/**
 * Статус платежа по заказу. Пока платёж в pending — опрашиваем: вебхук от TipTopPay
 * приходит асинхронно и может отстать от редиректа браузера на пару секунд.
 */
export function usePayment(orderId: string | undefined, poll = false) {
  const isAuthed = !!useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['payment', orderId],
    queryFn: () => paymentsApi.get(token(), orderId!),
    enabled: isAuthed && !!orderId,
    retry: false,
    refetchInterval: (query) =>
      poll && query.state.data?.status === 'pending' ? 2000 : false,
  });
}
```

- [ ] **Step 2: Страница успеха — ждать подтверждения оплаты**

Заменить `src/pages/OrderSuccess.tsx`:

```tsx
import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Package, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useOrder, usePayment } from '../hooks/useOrders';

const formatPrice = (v: number): string =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v);

export const OrderSuccess: React.FC = () => {
  const [sp] = useSearchParams();
  const orderId = sp.get('order') ?? undefined;
  const { data: order } = useOrder(orderId);
  const { data: payment } = usePayment(orderId, true);

  const isPending = !payment || payment.status === 'pending';
  const isFailed = payment?.status === 'failed';

  return (
    <div className="bg-slate-50 min-h-[70vh] flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
        {isPending ? (
          <>
            <div className="w-16 h-16 rounded-full bg-orange-50 flex items-center justify-center mx-auto mb-5">
              <Loader2 size={32} className="text-orange-500 animate-spin" />
            </div>
            <h1 className="text-[22px] font-bold text-slate-900 mb-2">Подтверждаем оплату…</h1>
            <p className="text-[13px] text-slate-500 mb-6">
              Как только банк подтвердит платёж, мы разместим заказ у поставщиков. Обычно это
              занимает несколько секунд.
            </p>
          </>
        ) : isFailed ? (
          <>
            <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5">
              <AlertCircle size={36} className="text-red-500" />
            </div>
            <h1 className="text-[22px] font-bold text-slate-900 mb-2">Оплата не прошла</h1>
            <p className="text-[13px] text-slate-500 mb-6">
              {payment?.failReason ?? 'Банк отклонил платёж.'} Заказ сохранён — его можно оплатить
              другой картой в разделе «Мои заказы».
            </p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={36} className="text-green-500" />
            </div>
            <h1 className="text-[22px] font-bold text-slate-900 mb-2">Заказ оплачен!</h1>
            <p className="text-[13px] text-slate-500 mb-6">
              Мы разместили заказ у поставщиков. Отслеживайте статус в разделе заказов.
            </p>
          </>
        )}

        {order && (
          <div className="bg-slate-50 rounded-lg p-4 mb-6 text-left text-[13px] space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Номер</span>
              <span className="font-bold">{payment?.invoiceId ?? String(order.id).slice(0, 8).toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Статус</span>
              <span className="font-semibold">{order.statusLabel ?? order.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Сумма</span>
              <span className="font-bold">{formatPrice(Number(order.totalAmount ?? 0))} ₸</span>
            </div>
            {payment?.cardLastFour && (
              <div className="flex justify-between">
                <span className="text-slate-500">Карта</span>
                <span className="font-semibold">{payment.cardType} •••• {payment.cardLastFour}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {orderId && (
            <Link
              to={`/order/${orderId}`}
              className="bg-orange-500 hover:bg-orange-600 text-white text-[14px] font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Package size={18} /> Детали заказа
            </Link>
          )}
          <Link
            to="/catalog"
            className="text-[13px] font-semibold text-slate-600 hover:text-orange-500 flex items-center justify-center gap-1"
          >
            Продолжить покупки <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Блок оплаты в деталях заказа**

Открыть `src/pages/OrderDetails.tsx`, найти место, где выводится статус заказа, и добавить блок платежа с кнопкой «Оплатить» для неоплаченных заказов:

```tsx
import { usePayment } from '../hooks/useOrders';
import { paymentsApi } from '../api';
import { useTipTopPay } from '../hooks/useTipTopPay';
import { useAuthStore } from '../authStore';
```

Внутри компонента:

```tsx
  const { data: payment, refetch: refetchPayment } = usePayment(id, false);
  const { startPayment } = useTipTopPay();
  const [payError, setPayError] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  const payNow = async () => {
    if (!id) return;
    setPayError(null);
    setIsPaying(true);
    try {
      const token = useAuthStore.getState().accessToken ?? '';
      const init = await paymentsApi.init(token, id);
      const result = await startPayment(init);
      if (result.status !== 'success') {
        setPayError(
          result.status === 'fail'
            ? result.reason
            : 'Оплата отменена.',
        );
      }
      await refetchPayment();
    } catch (e) {
      setPayError(getApiErrorMessage(e));
    } finally {
      setIsPaying(false);
    }
  };
```

И блок в разметке:

```tsx
      {payment && (
        <section className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6 mb-6">
          <h2 className="text-[15px] font-bold text-slate-900 mb-3">Оплата</h2>
          <div className="text-[13px] space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Счёт</span>
              <span className="font-semibold">{payment.invoiceId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Статус</span>
              <span className="font-semibold">
                {payment.status === 'paid' && 'Оплачен'}
                {payment.status === 'pending' && 'Ожидает оплаты'}
                {payment.status === 'failed' && 'Отклонён'}
                {payment.status === 'refunded' && 'Возвращён'}
                {payment.status === 'partially_refunded' && 'Возвращён частично'}
              </span>
            </div>
            {payment.cardLastFour && (
              <div className="flex justify-between">
                <span className="text-slate-500">Карта</span>
                <span className="font-semibold">{payment.cardType} •••• {payment.cardLastFour}</span>
              </div>
            )}
            {Number(payment.refundedAmount) > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Возвращено</span>
                <span className="font-semibold">
                  {new Intl.NumberFormat('ru-RU').format(Number(payment.refundedAmount))} ₸
                </span>
              </div>
            )}
          </div>

          {(payment.status === 'pending' || payment.status === 'failed') && (
            <>
              <button
                onClick={payNow}
                disabled={isPaying}
                className="w-full mt-4 min-h-[44px] bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-[14px] font-bold rounded-lg transition-colors"
              >
                {isPaying ? 'Открываем оплату…' : 'Оплатить'}
              </button>
              {payError && (
                <div className="mt-2 text-[12px] text-red-600 font-semibold">{payError}</div>
              )}
            </>
          )}
        </section>
      )}
```

Импортировать `useState` и `getApiErrorMessage`, если их ещё нет в файле.

- [ ] **Step 4: Проверить типы и посмотреть глазами**

Run (из `/home/mans/projects/Dana/front`): `npm run lint`
Expected: без ошибок.

Открыть заказ в `awaiting_payment` — виден блок «Оплата» со статусом «Ожидает оплаты» и рабочей кнопкой «Оплатить».

- [ ] **Step 5: Коммит**

```bash
git add src/pages/OrderSuccess.tsx src/pages/OrderDetails.tsx src/hooks/useOrders.ts
git commit -m "feat(orders): payment status on success page and pay button in order details"
```

---

## Task 11: Админка — блок платежа и кнопка возврата

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/pages/admin/tabs/OrdersTab.tsx`

Все пути — относительно `/home/mans/projects/Dana/front`.

**Interfaces:**
- Consumes: `GET /api/payments/:orderId`, `POST /api/payments/:orderId/refund` (Task 6).
- Produces: `paymentsAdminApi` в `src/lib/api.ts`.

- [ ] **Step 1: API-клиент админки**

В `src/lib/api.ts` добавить (рядом с `ordersAdminApi`, повторив принятый в файле способ передачи токена — посмотреть сигнатуру соседних методов и следовать ей):

```ts
export type AdminPaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export const AdminPaymentStatusLabelRu: Record<AdminPaymentStatus, string> = {
  pending: 'Ожидает оплаты',
  paid: 'Оплачен',
  failed: 'Отклонён',
  refunded: 'Возвращён',
  partially_refunded: 'Возвращён частично',
};

export interface AdminPayment {
  id: string;
  orderId: string;
  invoiceId: string;
  amount: number | string;
  currency: string;
  status: AdminPaymentStatus;
  transactionId: string | null;
  cardLastFour: string | null;
  cardType: string | null;
  refundedAmount: number | string;
  failReason: string | null;
  paidAt: string | null;
}

export const paymentsAdminApi = {
  get: (token: string, orderId: string) =>
    apiRequest<AdminPayment>(`/api/payments/${orderId}`, { token }),
  refund: (token: string, orderId: string, amount: number, reason?: string) =>
    apiRequest<AdminPayment>(`/api/payments/${orderId}/refund`, {
      method: 'POST',
      token,
      body: { amount, ...(reason ? { reason } : {}) },
    }),
};
```

- [ ] **Step 2: Блок платежа в карточке заказа**

В `src/pages/admin/tabs/OrdersTab.tsx`, в компоненте, который раскрывает детали заказа (там, где сейчас выводится свод по поставщикам), добавить:

```tsx
import { paymentsAdminApi, AdminPaymentStatusLabelRu } from '../../../lib/api';
```

```tsx
const PaymentPanel: React.FC<{ orderId: string }> = ({ orderId }) => {
  const qc = useQueryClient();
  const token = useAuthStore.getState().accessToken ?? '';
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: payment } = useQuery({
    queryKey: ['admin-payment', orderId],
    queryFn: () => paymentsAdminApi.get(token, orderId),
    retry: false,
  });

  const refund = useMutation({
    mutationFn: () => paymentsAdminApi.refund(token, orderId, Number(amount), reason || undefined),
    onSuccess: () => {
      setAmount('');
      setReason('');
      setError(null);
      qc.invalidateQueries({ queryKey: ['admin-payment', orderId] });
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Возврат не прошёл.'),
  });

  if (!payment) {
    return (
      <div className="text-[12px] text-slate-400">Платёж по этому заказу не создавался.</div>
    );
  }

  const refundable = toNum(payment.amount) - toNum(payment.refundedAmount);
  const canRefund =
    (payment.status === 'paid' || payment.status === 'partially_refunded') && refundable > 0;

  return (
    <div className="border border-slate-200 rounded-lg p-4">
      <h4 className="text-[13px] font-bold text-slate-900 mb-2">Платёж</h4>
      <div className="grid grid-cols-2 gap-y-1 text-[12px]">
        <span className="text-slate-500">Счёт</span>
        <span className="font-semibold text-right">{payment.invoiceId}</span>
        <span className="text-slate-500">Статус</span>
        <span className="font-semibold text-right">{AdminPaymentStatusLabelRu[payment.status]}</span>
        <span className="text-slate-500">Оплачено</span>
        <span className="font-semibold text-right">{formatKzt(payment.amount)}</span>
        <span className="text-slate-500">Возвращено</span>
        <span className="font-semibold text-right">{formatKzt(payment.refundedAmount)}</span>
        {payment.cardLastFour && (
          <>
            <span className="text-slate-500">Карта</span>
            <span className="font-semibold text-right">
              {payment.cardType} •••• {payment.cardLastFour}
            </span>
          </>
        )}
        {payment.failReason && (
          <>
            <span className="text-slate-500">Причина отказа</span>
            <span className="font-semibold text-right text-red-600">{payment.failReason}</span>
          </>
        )}
      </div>

      {canRefund && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
          <div className="text-[12px] text-slate-500">
            Доступно к возврату: <strong>{formatKzt(refundable)}</strong>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="number"
              min="0.01"
              max={refundable}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Сумма возврата"
              className="flex-1 min-h-[36px] border border-slate-200 rounded-lg px-2 text-[13px]"
            />
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина"
              className="flex-1 min-h-[36px] border border-slate-200 rounded-lg px-2 text-[13px]"
            />
            <button
              onClick={() => refund.mutate()}
              disabled={
                refund.isPending ||
                !amount ||
                Number(amount) <= 0 ||
                Number(amount) > refundable
              }
              className="min-h-[36px] px-4 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-[12px] font-bold whitespace-nowrap"
            >
              {refund.isPending ? 'Возврат…' : 'Вернуть деньги'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setAmount(String(refundable))}
            className="text-[11px] font-bold text-orange-500 hover:text-orange-600"
          >
            Вернуть всю сумму
          </button>
          {error && <div className="text-[12px] text-red-600 font-semibold">{error}</div>}
        </div>
      )}
    </div>
  );
};
```

Отрисовать `<PaymentPanel orderId={order.id} />` в раскрытой карточке заказа рядом со сводом по поставщикам.

- [ ] **Step 3: Бейдж нового статуса заказа**

В `statusBadgeClass` добавить `awaiting_payment` (иначе бейдж отрисуется без класса), и убедиться, что `OrderStatusLabelRu` в `src/lib/api.ts` тоже знает про новый статус:

```ts
const statusBadgeClass: Record<OrderStatus, string> = {
  new: 'bg-slate-100 text-slate-700',
  awaiting_payment: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-blue-100 text-blue-800',
  placed: 'bg-indigo-100 text-indigo-800',
  partially_placed: 'bg-amber-100 text-amber-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};
```

В `src/lib/api.ts` — в тип `OrderStatus` добавить `'awaiting_payment'`, в `OrderStatusLabelRu` — `awaiting_payment: 'Ожидает оплаты'`.

- [ ] **Step 4: Проверить типы**

Run (из `/home/mans/projects/Dana/front`): `npm run lint`
Expected: без ошибок. TypeScript сам укажет все места, где `Record<OrderStatus, ...>` не покрывает новый статус.

- [ ] **Step 5: Коммит**

```bash
git add src/lib/api.ts src/pages/admin/tabs/OrdersTab.tsx
git commit -m "feat(admin): payment panel with full and partial refunds"
```

---

## Task 12: Выкладка и подключение боевого терминала

**Files:** нет изменений кода — это чек-лист выкладки.

- [ ] **Step 1: Прогнать весь тест-сьют и сборку**

Run (из `/home/mans/projects/Dana/api.optparts.kz`):
```bash
npx jest && npm run build
```
Expected: все тесты зелёные, сборка чистая.

- [ ] **Step 2: Выложить бэкенд**

Run:
```bash
python3 deploy/deploy.py backend
```
На сервере прогнать миграцию (согласно принятому в проекте workflow: build + migration:run + restart):
```bash
ssh <прод> 'cd <путь> && npm run migration:run && pm2 restart <имя>'
```
Expected: миграция `CreatePayments1700000000027` выполнена, pm2-процесс поднялся.

Проверить:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.optparts.kz/api/payments/webhook/pay \
  -H 'Content-Type: application/json' -H 'X-Content-HMAC: forged' -d '{"TransactionId":1}'
```
Expected: `403` (эндпоинт живой и подделку отбивает).

- [ ] **Step 3: Выложить фронт**

Run:
```bash
python3 deploy/deploy.py frontend
```
Проверить, что открываются `https://optparts.kz/#/offer`, `/#/privacy`, `/#/delivery`, `/#/returns`, `/#/contacts` — без авторизации.

- [ ] **Step 4: Прописать вебхуки в личном кабинете TipTopPay**

Это делает владелец аккаунта. Адреса:

- Check: `https://api.optparts.kz/api/payments/webhook/check`
- Pay: `https://api.optparts.kz/api/payments/webhook/pay`
- Fail: `https://api.optparts.kz/api/payments/webhook/fail`

- [ ] **Step 5: Прогон на тестовом терминале**

С тестовыми ключами в `.env` оформить и оплатить заказ тестовой картой с 3-D Secure (карты — в личном кабинете TipTopPay). Проверить по БД:

```bash
docker exec optparts_smoke_db psql -U postgres -d nestjs_auth -c \
  'SELECT o.status, p.status, p."cardLastFour" FROM orders o JOIN payments p ON p."orderId" = o.id ORDER BY o."createdAt" DESC LIMIT 1;'
```
Expected: заказ `placed` (или `partially_placed`), платёж `paid`, последние 4 цифры карты записаны.

Проверить журнал вебхуков:
```bash
docker exec optparts_smoke_db psql -U postgres -d nestjs_auth -c \
  'SELECT type, "hmacValid", "transactionId" FROM payment_events ORDER BY "createdAt" DESC LIMIT 5;'
```
Expected: строка `pay | t | <id>`.

- [ ] **Step 6: Переключить на боевые ключи**

Заменить в проде `TIPTOPPAY_PUBLIC_ID` и `TIPTOPPAY_API_SECRET` на боевые, перезапустить процесс, оплатить один реальный заказ минимальной суммой и сделать по нему возврат из админки — это проверяет обе стороны денежного потока.

- [ ] **Step 7: Коммит документации о выкладке**

Если по ходу выкладки в `CLAUDE.md` или `README.md` нужно записать что-то новое про платежи (например, где брать ключи) — сделать это и закоммитить.

---

## Self-Review

**Покрытие спеки:**

| раздел спеки | задача |
|---|---|
| `TipTopPayClient` (Basic Auth, `X-Request-ID`) | Task 1 |
| HMAC вебхуков, `timingSafeEqual`, `rawBody` | Task 2, Task 6 (Step 10) |
| Сущности `Payment` / `PaymentEvent`, миграция, `awaiting_payment` | Task 3 |
| `create()` не размещает; размещение после оплаты; `aggregateOrderStatus` → `cancelled` | Task 4 |
| Эндпоинты `init` / `webhook/*` / `refund` / `GET :orderId` | Task 5, Task 6 |
| Идемпотентность повторного `Pay` | Task 5 (тест + `wasHandled`) |
| Ответ вебхука всегда `{"code":0}` | Task 6 |
| Сумма из `Order.totalAmount`, а не с фронта | Task 5 (тест + `init`) |
| Крон авто-отмены (30 мин) | Task 7 |
| Юридические страницы + реквизиты + чекбокс + логотипы | Task 8, Task 9 (Step 4) |
| Виджет `Single`, 3-D Secure внутри iframe | Task 9 |
| Опрос статуса на `/success`, кнопка «Оплатить» | Task 10 |
| Возврат из админки | Task 11 |
| Тестовый режим (`isTest`) | Task 4 (тест «skips suppliers in test mode») |
| Выкладка, URL вебхуков, боевые ключи | Task 12 |

**Открытые риски, вынесенные в шаги, а не додуманные:**

- Точное имя поля номера счёта в `intentParams` (`externalId`) против `InvoiceId` в вебхуке — проверяется в Task 9 Step 1 по живой документации и тестовым платежом. Если TipTopPay передаёт счёт другим полем, правится маппинг в `useTipTopPay` и поиск платежа в `handlePayWebhook`.
- Наличие декоратора `@Public()` и форма `user.roles` — сверяются с кодом в Task 6 (Step 3, Step 6).
- Точный набор полей `PlaceOrderItem` — сверяется с `src/suppliers/types.ts` в Task 4 Step 5.
