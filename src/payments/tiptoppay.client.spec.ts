import axios from 'axios';
import { TipTopPayClient } from './tiptoppay.client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TipTopPayClient', () => {
  const config = {
    publicTerminalId: 'pk_test',
    apiSecret: 'secret',
    baseUrl: 'https://api.tiptoppay.kz',
  };

  beforeEach(() => jest.clearAllMocks());

  it('posts refund with Basic auth, X-Request-ID and the TipTopPay payload shape', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { Success: true, Message: null, Model: { TransactionId: 455 } },
    });

    const client = new TipTopPayClient(config);
    const res = await client.refund('455', 1500.5);

    expect(res.Success).toBe(true);

    const [url, body, options] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://api.tiptoppay.kz/payments/refund');
    expect(body).toEqual({ TransactionId: '455', Amount: 1500.5 });
    expect(options.auth).toEqual({ username: 'pk_test', password: 'secret' });
    expect(options.headers['X-Request-ID']).toEqual(expect.any(String));
    expect(options.headers['X-Request-ID'].length).toBeGreaterThan(0);
  });

  it('returns the failed response instead of throwing when Success is false', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { Success: false, Message: 'Insufficient funds', Model: null },
    });

    const client = new TipTopPayClient(config);
    const res = await client.refund('455', 100);

    expect(res.Success).toBe(false);
    expect(res.Message).toBe('Insufficient funds');
  });

  it('throws a readable error when the HTTP call itself fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('ECONNRESET'));

    const client = new TipTopPayClient(config);

    await expect(client.refund('455', 100)).rejects.toThrow('TipTopPay request failed');
  });

  it('reads credentials from env when no config is passed', () => {
    process.env.TIPTOPPAY_PUBLIC_ID = 'pk_env';
    process.env.TIPTOPPAY_API_SECRET = 'secret_env';

    const client = new TipTopPayClient();

    expect(client.publicTerminalId).toBe('pk_env');
  });
});
