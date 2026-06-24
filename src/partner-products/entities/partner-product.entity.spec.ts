import { PartnerProduct } from './partner-product.entity';

describe('PartnerProduct entity', () => {
  it('can be instantiated with catalog fields', () => {
    const p = new PartnerProduct();
    p.supplierCode = 'rossko';
    p.article = '0451103316';
    p.brand = 'BOSCH';
    p.name = 'Oil Filter';
    p.lastKnownCostPrice = 5200;
    p.lastKnownSellPrice = 6240;
    p.timesOrdered = 1;
    expect(p.supplierCode).toBe('rossko');
    expect(p.timesOrdered).toBe(1);
  });
});
