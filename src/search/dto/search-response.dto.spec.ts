import { OfferDto, SearchGroupDto, SearchResponseDto } from './search-response.dto';

describe('search response DTOs', () => {
  it('constructs a full response shape without costPrice', () => {
    const offer: OfferDto = {
      offerId: 'abc',
      supplierCode: 'rossko',
      supplierName: 'Rossko',
      sellPrice: 6240,
      deliveryDays: 3,
      count: 10,
      multiplicity: 1,
      warehouseId: 's1',
      raw: { guid: 'g1' },
    };
    const group: SearchGroupDto = {
      article: '0451103316',
      brand: 'BOSCH',
      name: 'Oil Filter',
      offers: [offer],
    };
    const response: SearchResponseDto = {
      query: { article: '0451103316', brand: 'BOSCH' },
      exact: [group],
      analogs: [],
    };
    expect(response.exact[0].offers[0].sellPrice).toBe(6240);
    expect(Object.keys(offer)).not.toContain('costPrice');
  });
});
