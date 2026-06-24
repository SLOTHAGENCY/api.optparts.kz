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
    // Stable offer key = guid|stockId (stock id alone is a shared warehouse).
    expect(first?.raw.offerKey).toBe('g-exact|s1');
  });

  it('recognizes exact match when brand is omitted', () => {
    const offers = connector.parseOffers(XML, '0451103316');
    const exactMatch = offers.find((o) => o.warehouseId === 's1');
    expect(exactMatch?.isAnalog).toBe(false);
  });

  it('coerces missing numeric stock tags to 0 instead of NaN', () => {
    const xmlWithMissingPrice = `<?xml version="1.0" encoding="utf-8"?>
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
                <guid>g-test</guid>
                <partnumber>0451103316</partnumber>
                <brand>BOSCH</brand>
                <name>Oil Filter</name>
                <stocks>
                  <stock><id>s1</id><count>10</count><multiplicity>1</multiplicity><delivery>3</delivery></stock>
                </stocks>
              </Part>
            </crosses>
          </Part>
        </PartsList>
      </SearchResult>
    </ns:GetSearchResponse>
  </soap:Body>
</soap:Envelope>`;
    const offers = connector.parseOffers(xmlWithMissingPrice, '0451103316', 'BOSCH');
    expect(offers).toHaveLength(1);
    const offer = offers[0];
    expect(Number.isNaN(offer.costPrice)).toBe(false);
    expect(offer.costPrice).toBe(0);
  });
});

describe('RosskoConnector checkout (order placement)', () => {
  const connector = new RosskoConnector();

  it('builds a GetCheckout envelope with PARTS from cart items', () => {
    const xml = connector.buildCheckoutEnvelope([
      {
        article: 'PH6811',
        brand: 'Fram',
        warehouseId: 'HST1',
        quantity: 2,
        raw: { partnumber: 'PH6811', stockId: 'HST1' },
      },
    ]);
    expect(xml).toContain('<tns:GetCheckout');
    expect(xml).toContain('<tns:partnumber>PH6811</tns:partnumber>');
    expect(xml).toContain('<tns:brand>Fram</tns:brand>');
    expect(xml).toContain('<tns:stock>HST1</tns:stock>');
    expect(xml).toContain('<tns:count>2</tns:count>');
  });

  it('parses a successful checkout response', () => {
    const xml = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:GetCheckoutResponse xmlns:ns="https://api.rossko.ru/">
      <ns:CheckoutResult>
        <ns:success>true</ns:success>
        <ns:orders><ns:order><ns:number>RK-123</ns:number></ns:order></ns:orders>
      </ns:CheckoutResult>
    </ns:GetCheckoutResponse>
  </soap:Body>
</soap:Envelope>`;
    const res = connector.parseCheckout(xml);
    expect(res.status).toBe('PLACED');
    expect(res.externalOrderId).toBe('RK-123');
  });

  it('parses a failed checkout response', () => {
    const xml = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:GetCheckoutResponse xmlns:ns="https://api.rossko.ru/">
      <ns:CheckoutResult>
        <ns:success>false</ns:success>
        <ns:message>Insufficient funds</ns:message>
      </ns:CheckoutResult>
    </ns:GetCheckoutResponse>
  </soap:Body>
</soap:Envelope>`;
    const res = connector.parseCheckout(xml);
    expect(res.status).toBe('FAILED');
    expect(res.errorMessage).toContain('Insufficient');
  });
});
