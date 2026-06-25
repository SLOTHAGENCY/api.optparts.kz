import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('unlimited (rpm<=0) resolves immediately', async () => {
    const rl = new RateLimiter(0);
    const start = Date.now();
    await rl.acquire(); await rl.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('allows up to rpm tokens, then spaces the next one out', async () => {
    // 60 rpm => 1 token/sec, bucket starts full with 1 burst token here.
    // Declare `now` FIRST to avoid temporal-dead-zone ReferenceError.
    const now = { value: 0 };
    const rl = new RateLimiter(60, 1, () => now.value);
    // first acquire consumes the initial token immediately
    await rl.acquire();
    let resolved = false;
    rl.acquire().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false); // no token yet
    now.value = 1000; // 1s later -> +1 token
    await rl.tick();
    await Promise.resolve();
    expect(resolved).toBe(true);
  });
});
