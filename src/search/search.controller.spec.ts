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
    await controller.search('  0451103316 ', ' BOSCH ', { id: 'u1' } as any);
    expect(service.search).toHaveBeenCalledWith('0451103316', 'BOSCH', 'u1');
  });

  it('GET search passes undefined brand and undefined userId for anonymous', async () => {
    await controller.search('A1', undefined, undefined);
    expect(service.search).toHaveBeenCalledWith('A1', undefined, undefined);
  });

  it('GET search rejects a missing/blank article', async () => {
    await expect(controller.search('   ', undefined, undefined)).rejects.toBeInstanceOf(
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
