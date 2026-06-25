import { Injectable } from '@nestjs/common';
import { RateLimiter } from './rate-limiter';

@Injectable()
export class RateLimiterRegistry {
  private readonly limiters = new Map<string, { rpm: number; rl: RateLimiter }>();

  private get(code: string, rpm: number): RateLimiter {
    const existing = this.limiters.get(code);
    if (existing && existing.rpm === rpm) return existing.rl;
    const rl = new RateLimiter(rpm);
    this.limiters.set(code, { rpm, rl });
    return rl;
  }

  async gate<T>(code: string, rpm: number | null, fn: () => Promise<T>): Promise<T> {
    const limit = rpm ?? 0;
    if (limit > 0) {
      await this.get(code, limit).acquire();
    }
    return fn();
  }
}
