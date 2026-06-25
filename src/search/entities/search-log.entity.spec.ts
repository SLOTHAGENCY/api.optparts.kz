import { SearchLog } from './search-log.entity';

describe('SearchLog entity', () => {
  it('can be instantiated with expected fields', () => {
    const log = new SearchLog();
    log.userId = null;
    log.article = '0451103316';
    log.brand = 'BOSCH';
    log.totalResults = 3;
    log.suppliersQueried = 2;
    log.suppliersFailed = 1;
    expect(log.article).toBe('0451103316');
    expect(log.userId).toBeNull();
    expect(log.suppliersFailed).toBe(1);
  });
});
