import { BadRequestException } from '@nestjs/common';
import { SearchController } from './search.controller';

describe('SearchController', () => {
  const service = {
    search: jest.fn(async () => ({ query: { article: 'A1', brand: 'B' }, exact: [], analogs: [] })),
    history: jest.fn(async () => ({ items: [], total: 0, page: 1, limit: 20 })),
  };
  const controller = new SearchController(service as any);

  afterEach(() => jest.clearAllMocks());

  it('GET search delegates trimmed article/brand and the current user id', async () => {
    const filter = { brand: 'BOSCH' } as any;
    await controller.search('  0451103316 ', ' BOSCH ', filter, { id: 'u1' } as any);
    expect(service.search).toHaveBeenCalledWith('0451103316', 'BOSCH', 'u1', filter);
  });

  it('GET search passes undefined brand and undefined userId for anonymous', async () => {
    const filter = {} as any;
    await controller.search('A1', undefined, filter, undefined);
    expect(service.search).toHaveBeenCalledWith('A1', undefined, undefined, filter);
  });

  it('GET search rejects a missing/blank article', async () => {
    await expect(controller.search('   ', undefined, {} as any, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.search).not.toHaveBeenCalled();
  });

  it('GET history delegates to service.history with user + query', async () => {
    const user = { id: 'u1' } as any;
    const query = { page: 2, limit: 5 };
    await controller.history(user, query);
    expect(service.history).toHaveBeenCalledWith(user, query);
  });
});
