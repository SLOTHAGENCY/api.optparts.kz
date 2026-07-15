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
 *
 * Journaling — who writes payment_events:
 *  - forged delivery (any type): logged here, hmacValid=false, then 403.
 *  - valid `check`: logged here, hmacValid=true — PaymentsService does not handle `check`.
 *  - valid `pay`/`fail`: logged INSIDE PaymentsService.handlePayWebhook/handleFailWebhook,
 *    NOT here, so the row is written exactly once.
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
    // signature. Availability was already re-checked at checkout. The service does not
    // handle `check`, so journal the valid delivery here (complementary, not duplicative).
    await this.payments.logEvent('check', body, true);
    return OK;
  }

  @Public()
  @Post('pay')
  @HttpCode(HttpStatus.OK)
  async pay(@Req() req: RawRequest, @Body() body: TipTopPayWebhookBody) {
    await this.verify(req, 'pay', body);
    try {
      // handlePayWebhook journals the valid delivery itself — do NOT logEvent here too.
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
      // handleFailWebhook journals the valid delivery itself — do NOT logEvent here too.
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
