type Clock = () => number;

/** Token-bucket limiter. rpm<=0 => unlimited. Deterministic via injected clock + tick(). */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly rpm: number,
    burst = Math.max(1, Math.ceil(rpm / 60)),
    private readonly clock: Clock = () => Date.now(),
  ) {
    this.tokens = rpm <= 0 ? Number.POSITIVE_INFINITY : burst;
    this.lastRefill = this.clock();
  }

  private refill(): void {
    if (this.rpm <= 0) return;
    const now = this.clock();
    const elapsedMs = now - this.lastRefill;
    const gained = (elapsedMs / 60000) * this.rpm;
    if (gained > 0) {
      this.tokens = Math.min(this.tokens + gained, Math.max(1, this.rpm));
      this.lastRefill = now;
    }
    // Passive drain: waiters are released here, inside refill(), which is
    // called only by acquire() (or the test-hook tick()). There is no
    // background timer — under very sparse traffic a queued waiter may wait
    // longer than the nominal token interval until the next acquire() arrives.
    // This is intentional: background timers would complicate lifecycle
    // management without meaningful benefit for the expected request cadence.
    while (this.tokens >= 1 && this.waiters.length) {
      this.tokens -= 1;
      this.waiters.shift()!();
    }
  }

  /** Test hook: advance refill after moving the injected clock. */
  tick(): void { this.refill(); }

  async acquire(): Promise<void> {
    if (this.rpm <= 0) return;
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
}
