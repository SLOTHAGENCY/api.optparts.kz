import { CatalogHttpClient } from './catalog-http.client';
import {
  CatalogQuotaExceededException,
  CatalogUpstreamException,
  CatalogConfigException,
} from './catalog-errors';
import { NotFoundException, BadRequestException } from '@nestjs/common';

function fakeHttp(impl: (args: any) => Promise<any>) {
  return { request: jest.fn(impl) } as any;
}

const base = {
  provider: 'partsindex' as const,
  baseUrl: 'http://api/v1',
  apiKey: 'PI-KEY',
  timeoutMs: 1000,
};

describe('CatalogHttpClient', () => {
  it('sends the raw key in Authorization (no Bearer) and returns data + lowercased headers', async () => {
    const http = fakeHttp(async () => ({ data: { list: [] }, headers: { 'X-Total-Count': '5' } }));
    const client = new CatalogHttpClient({ ...base, http });
    const res = await client.request<{ list: unknown[] }>({
      path: '/brands/by-part-code',
      query: { code: 'X1', skip: undefined },
    });

    const call = http.request.mock.calls[0][0];
    expect(call.baseURL).toBe('http://api/v1');
    expect(call.url).toBe('/brands/by-part-code');
    expect(call.headers.Authorization).toBe('PI-KEY');
    expect(call.headers.Authorization).not.toMatch(/Bearer/);
    expect(call.params).toEqual({ code: 'X1' });
    expect(res.data).toEqual({ list: [] });
    expect(res.headers['x-total-count']).toBe('5');
  });

  it('maps 403 code 1004 to quota exceeded', async () => {
    const http = fakeHttp(async () => {
      throw { response: { status: 403, data: { code: 1004, message: 'quota deny' } } };
    });
    const client = new CatalogHttpClient({ ...base, http });
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(CatalogQuotaExceededException);
  });

  it('maps other 403 to config exception', async () => {
    const http = fakeHttp(async () => {
      throw { response: { status: 403, data: { code: 1003, message: 'ip deny' } } };
    });
    const client = new CatalogHttpClient({ ...base, http });
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(CatalogConfigException);
  });

  it('maps 401 to config exception', async () => {
    const http = fakeHttp(async () => {
      throw { response: { status: 401, data: {} } };
    });
    const client = new CatalogHttpClient({ ...base, http });
    await expect(client.request({ path: '/x' })).rejects.toBeInstanceOf(CatalogConfigException);
  });

  it('maps 404 to NotFound and 422/400 to BadRequest', async () => {
    const c404 = new CatalogHttpClient({
      ...base,
      http: fakeHttp(async () => {
        throw { response: { status: 404, data: {} } };
      }),
    });
    await expect(c404.request({ path: '/x' })).rejects.toBeInstanceOf(NotFoundException);
    const c422 = new CatalogHttpClient({
      ...base,
      http: fakeHttp(async () => {
        throw { response: { status: 422, data: {} } };
      }),
    });
    await expect(c422.request({ path: '/x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps 5xx and network errors to upstream exception', async () => {
    const c500 = new CatalogHttpClient({
      ...base,
      http: fakeHttp(async () => {
        throw { response: { status: 502, data: {} } };
      }),
    });
    await expect(c500.request({ path: '/x' })).rejects.toBeInstanceOf(CatalogUpstreamException);
    const cNet = new CatalogHttpClient({
      ...base,
      http: fakeHttp(async () => {
        throw new Error('ECONNRESET');
      }),
    });
    await expect(cNet.request({ path: '/x' })).rejects.toBeInstanceOf(CatalogUpstreamException);
  });
});
