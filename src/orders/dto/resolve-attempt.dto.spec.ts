import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResolveAttemptDto } from './resolve-attempt.dto';

async function validateDto(data: Partial<ResolveAttemptDto>) {
  const dto = plainToInstance(ResolveAttemptDto, data);
  return validate(dto);
}

describe('ResolveAttemptDto validation', () => {
  // delivered:true without an external id would produce a PLACED row with a null external id
  // that can never be polled — reject it at the boundary.
  it('requires externalOrderId when delivered=true', async () => {
    const errors = await validateDto({ delivered: true });
    expect(errors.some((e) => e.property === 'externalOrderId')).toBe(true);
  });

  it('passes when delivered=true carries an externalOrderId', async () => {
    const errors = await validateDto({ delivered: true, externalOrderId: 'EXT-1' });
    expect(errors).toHaveLength(0);
  });

  // delivered:false means the supplier never got it — no external id is expected.
  it('does not require externalOrderId when delivered=false', async () => {
    const errors = await validateDto({ delivered: false });
    expect(errors).toHaveLength(0);
  });

  it('accepts an optional force flag', async () => {
    const errors = await validateDto({ delivered: false, force: true });
    expect(errors).toHaveLength(0);
  });
});
