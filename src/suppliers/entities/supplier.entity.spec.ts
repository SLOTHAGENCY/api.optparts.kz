import { Supplier, decimalTransformer } from './supplier.entity';

describe('Supplier entity', () => {
  it('can be instantiated with expected fields', () => {
    const s = new Supplier();
    s.code = 'rossko';
    s.name = 'Rossko';
    s.isActive = true;
    s.markupPercent = null;
    s.config = {};
    expect(s.code).toBe('rossko');
    expect(s.markupPercent).toBeNull();
  });

  it('decimalTransformer converts db string to number and null to null', () => {
    expect(decimalTransformer.from('20.00')).toBe(20);
    expect(decimalTransformer.from(null)).toBeNull();
  });
});
