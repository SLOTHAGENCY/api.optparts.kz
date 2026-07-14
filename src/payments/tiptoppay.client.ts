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
