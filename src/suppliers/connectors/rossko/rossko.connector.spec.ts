import { NotImplementedException } from '@nestjs/common';
import { RosskoConnector } from './rossko.connector';

// Minimal SOAP fixture mirroring the real shape: SearchResult.PartsList.Part[]
// -> crosses.Part[] -> stocks.stock[]. The parent part is 0451103316/BOSCH;
// one cross matches it (exact), one is a different number (analog).
const XML = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:GetSearchResponse xmlns:ns="https://api.rossko.ru/">
      <SearchResult>
        <success>true</success>
        <text>0451103316</text>
        <PartsList>
          <Part>
            <partnumber>0451103316</partnumber>
            <brand>BOSCH</brand>
            <crosses>
              <Part>
                <guid>g-exact</guid>
                <partnumber>0451103316</partnumber>
                <brand>BOSCH</brand>
                <name>Oil Filter</name>
                <stocks>
                  <stock><id>s1</id><price>5200</price><count>10</count><multiplicity>1</multiplicity><delivery>3</delivery></stock>
                  <stock><id>s2</id><price>5400</price><count>4</count><multiplicity>1</multiplicity><delivery>1</delivery></stock>
                </stocks>
              </Part>
              <Part>
                <guid>g-analog</guid>
                <partnumber>W71262</partnumber>
                <brand>MANN</brand>
                <name>Oil Filter Analog</name>
                <stocks>
                  <stock><id>s3</id><price>4100</price><count>7</count><multiplicity>1</multiplicity><delivery>5</delivery></stock>
                </stocks>
              </Part>
            </crosses>
          </Part>
        </PartsList>
      </SearchResult>
    </ns:GetSearchResponse>
  </soap:Body>
</soap:Envelope>`;

describe('RosskoConnector.parseOffers', () => {
  const connector = new RosskoConnector();

  it('maps each stock to a SupplierOffer', () => {
    const offers = connector.parseOffers(XML, '0451103316', 'BOSCH');
    expect(offers).toHaveLength(3); // 2 stocks on exact + 1 on analog
    const first = offers.find((o) => o.warehouseId === 's1');
    expect(first).toMatchObject({
      supplierCode: 'rossko',
      article: '0451103316',
      brand: 'BOSCH',
      name: 'Oil Filter',
      costPrice: 5200,
      count: 10,
      deliveryDays: 3,
      multiplicity: 1,
      warehouseId: 's1',
      isAnalog: false,
    });
  });

  it('flags non-matching cross numbers as analogs', () => {
    const offers = connector.parseOffers(XML, '0451103316', 'BOSCH');
    const analog = offers.find((o) => o.warehouseId === 's3');
    expect(analog?.isAnalog).toBe(true);
    expect(analog?.article).toBe('W71262');
  });

  it('carries raw identifiers for placeOrder', () => {
    const offers = connector.parseOffers(XML, '0451103316', 'BOSCH');
    const first = offers.find((o) => o.warehouseId === 's1');
    expect(first?.raw).toMatchObject({ guid: 'g-exact', stockId: 's1' });
  });

  it('recognizes exact match when brand is omitted', () => {
    const offers = connector.parseOffers(XML, '0451103316');
    const exactMatch = offers.find((o) => o.warehouseId === 's1');
    expect(exactMatch?.isAnalog).toBe(false);
  });

  it('placeOrder is not implemented yet', async () => {
    await expect(connector.placeOrder([])).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});
