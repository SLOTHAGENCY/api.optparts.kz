import { AutotradeConnector } from './autotrade.connector';

describe('AutotradeConnector.mapOffers', () => {
  const connector = new AutotradeConnector();

  // getItemsByQuery response (with_stocks_and_prices=1): items[] with embedded stocks.
  const sample = {
    items: [
      {
        type: '',
        article: '0451103316',
        brand_name: 'BOSCH',
        name: 'Oil Filter',
        inside_id_in: '##ABC###',
        price: 2845,
        currency: 'KZT',
        stocks: {
          '1': { id: '1', quantity_unpacked: 5, quantity_packed: 4 },
          '9': { id: '9', quantity_unpacked: 0, quantity_packed: 0, delivery_period: 2 },
        },
      },
      {
        type: 'cross',
        article: 'W7015',
        brand_name: 'MANN',
        name: 'Analog filter',
        inside_id_in: '##XYZ###',
        price: 2600,
        currency: 'KZT',
        stocks: {
          '1': { id: '1', quantity_unpacked: 3, quantity_packed: 0 },
        },
      },
    ],
    code: 0,
  };

  it('maps getItemsByQuery items to per-warehouse offers', () => {
    const offers = connector.mapOffers(sample, '0451103316', 'BOSCH');
    // exact: 2 warehouses (one in stock, one transfer) + 1 analog warehouse = 3
    expect(offers).toHaveLength(3);

    const inStock = offers.find((o) => o.warehouseId === '1' && o.article === '0451103316');
    expect(inStock?.supplierCode).toBe('autotrade');
    expect(inStock?.brand).toBe('BOSCH');
    expect(inStock?.costPrice).toBe(2845);
    expect(inStock?.count).toBe(9); // unpacked + packed
    expect(inStock?.deliveryDays).toBe(0);
    expect(inStock?.isAnalog).toBe(false);
    expect(inStock?.raw).toMatchObject({ offerKey: '##ABC###|1', insideId: '##ABC###' });

    const transfer = offers.find((o) => o.warehouseId === '9');
    expect(transfer?.count).toBe(0);
    expect(transfer?.deliveryDays).toBe(2);

    const analog = offers.find((o) => o.article === 'W7015');
    expect(analog?.isAnalog).toBe(true);
  });

  it('skips warehouses without stock or transfer time, handles empty', () => {
    const data = {
      items: [
        { article: 'A', brand_name: 'B', inside_id_in: 'i', price: 10, stocks: {
          '1': { quantity_unpacked: 0, quantity_packed: 0 },
        } },
      ],
    };
    expect(connector.mapOffers(data, 'A', 'B')).toEqual([]);
    expect(connector.mapOffers({ items: [] }, 'A')).toEqual([]);
  });
});
