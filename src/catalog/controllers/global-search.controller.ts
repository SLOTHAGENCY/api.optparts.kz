import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity';
import { GlobalSearchService } from '../services/global-search.service';
import { GlobalSearchResultDto } from '../dto/global-search.dto';
import { NameSearchIndex } from '../name-search/name-search-index.service';
import { SuggestResponseDto } from '../name-search/name-search.dto';

@ApiTags('search')
@Controller('search')
@Public()
@UseGuards(OptionalJwtAuthGuard)
export class GlobalSearchController {
  constructor(
    private readonly globalSearch: GlobalSearchService,
    private readonly nameIndex: NameSearchIndex,
  ) {}

  @Get('global')
  @ApiOperation({
    summary: 'Глобальный полиморфный поиск (VIN / артикул / название)',
    description:
      'Определяет тип запроса и маршрутизирует: VIN/FRAME → подбор авто (OEM); артикул → ' +
      'бренды (PartsIndex) + живые предложения поставщиков; название → подходящие категории ' +
      'каталога. Существующий /api/search (по артикулу) остаётся без изменений.',
  })
  @ApiQuery({ name: 'query', required: true, example: '0451103316' })
  @ApiQuery({ name: 'catalogs', required: false, description: 'Ограничить марками для VIN (через запятую)' })
  @ApiQuery({ name: 'lang', required: false })
  @ApiOkResponse({ type: GlobalSearchResultDto })
  search(
    @Query('query') query: string,
    @CurrentUser() user: User | undefined,
    @Query('catalogs') catalogs?: string,
    @Query('lang') lang?: string,
  ): Promise<GlobalSearchResultDto> {
    if (!query || !query.trim()) {
      throw new BadRequestException('Query parameter "query" is required.');
    }
    return this.globalSearch.search(query.trim(), {
      catalogs: catalogs?.trim() || undefined,
      lang,
      userId: user?.id,
    });
  }

  @Get('suggest')
  @ApiOperation({
    summary: 'Автоподсказ по названию детали (категории + подгруппы)',
    description:
      'Живой typeahead для строки поиска. По части названия («Свеч») возвращает ' +
      'подходящие категории и подгруппы каталога (стемминг + синонимы + опечатки). ' +
      'Меньше 2 символов — пустой список. Ответ мгновенный (индекс в памяти).',
  })
  @ApiQuery({ name: 'q', required: true, example: 'свеча' })
  @ApiQuery({ name: 'lang', required: false, example: 'ru' })
  @ApiQuery({ name: 'limit', required: false, example: 8 })
  @ApiOkResponse({ type: SuggestResponseDto })
  suggest(
    @Query('q') q: string | undefined,
    @Query('lang') lang: string | undefined,
    @Query('limit') limit: string | undefined,
  ): SuggestResponseDto {
    const query = (q ?? '').trim();
    if (query.length < 2) return { query, suggestions: [] };
    const n = Math.max(1, Math.min(Number(limit) || 8, 20));
    return { query, suggestions: this.nameIndex.suggest(query, lang || 'ru', n) };
  }
}
