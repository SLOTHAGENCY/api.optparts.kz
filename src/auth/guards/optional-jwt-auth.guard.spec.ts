import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  it('returns the user when authentication succeeded', () => {
    const user = { id: 'u1' };
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('returns undefined (does not throw) when there is no user', () => {
    expect(guard.handleRequest(null, false)).toBeUndefined();
  });

  it('returns undefined (does not throw) when passport reports an error', () => {
    expect(guard.handleRequest(new Error('no token'), undefined)).toBeUndefined();
  });
});
