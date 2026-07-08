import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { SearchService } from './search.service';
import {
  ActiveSupplierDto,
  SearchResponseDto,
  SupplierSearchResponseDto,
} from './dto/search-response.dto';
import { HistoryQueryDto, HistoryResponseDto } from './dto/search-history.dto';
import { SearchFilterDto } from './dto/search-filter.dto';

@ApiTags('search')
@Controller('search')
@UseGuards(RolesGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiQuery({ name: 'priceMin', required: false, example: 1000 })
  @ApiQuery({ name: 'priceMax', required: false, example: 9000 })
  @ApiQuery({ name: 'inStock', required: false, example: true })
  @ApiQuery({ name: 'maxDeliveryDays', required: false, example: 5 })
  @ApiQuery({ name: 'suppliers', required: false, example: 'rossko,tabys' })
  @ApiOperation({
    summary: 'Живой поиск запчасти по артикулу у всех поставщиков',
    description:
      'Главный поиск системы. По номеру детали (артикулу) и, по желанию, бренду в реальном ' +
      'времени опрашивает всех подключённых поставщиков и собирает их предложения в один список: ' +
      'цена, наличие, срок поставки. Цены уже пересчитаны с учётом наценки и курса валют. ' +
      'Бренд можно не указывать — тогда вернутся варианты от разных производителей. Авторизация ' +
      'необязательна, но если пользователь вошёл, запрос сохраняется в историю поиска.',
  })
  @ApiQuery({ name: 'article', required: true, example: '0451103316', description: 'Артикул (номер) детали — обязательно' })
  @ApiQuery({ name: 'brand', required: false, example: 'BOSCH', description: 'Бренд (производитель) — необязательно, для уточнения поиска' })
  @ApiOkResponse({ type: SearchResponseDto })
  async search(
    @Query('article') article: string,
    @Query('brand') brand: string | undefined,
    @Query() filter: SearchFilterDto,
    @CurrentUser() user: User | undefined,
  ): Promise<SearchResponseDto> {
    if (!article || !article.trim()) {
      throw new BadRequestException('Query parameter "article" is required.');
    }
    return this.searchService.search(
      article.trim(),
      brand?.trim() || undefined,
      user?.id,
      filter,
    );
  }

  @Public()
  @Get('suppliers')
  @ApiOperation({
    summary: 'Список активных поставщиков для прогрессивного поиска',
    description:
      'Возвращает коды и названия активных поставщиков. Фронтенд опрашивает каждого из них ' +
      'по отдельности (GET /api/search/supplier/:code) и показывает результаты по мере ответа, ' +
      'чтобы медленный поставщик не блокировал выдачу. Секреты/настройки не возвращаются.',
  })
  @ApiOkResponse({ type: [ActiveSupplierDto] })
  suppliers(): Promise<ActiveSupplierDto[]> {
    return this.searchService.activeSuppliers();
  }

  @Public()
  @Get('supplier/:code')
  @ApiOperation({
    summary: 'Живой поиск по артикулу у ОДНОГО поставщика',
    description:
      'Опрашивает одного поставщика (по коду) и возвращает его предложения плоским списком ' +
      '(без группировки) — цены уже с наценкой. Используется фронтендом для прогрессивной ' +
      'выдачи: каждый поставщик запрашивается параллельно и рендерится, как только ответил. ' +
      'Если поставщик не ответил/упал/вышел за таймаут — ok=false и пустой offers (HTTP 200).',
  })
  @ApiParam({ name: 'code', example: 'shatem', description: 'Код поставщика' })
  @ApiQuery({ name: 'article', required: true, example: '0451103316' })
  @ApiQuery({ name: 'brand', required: false, example: 'BOSCH' })
  @ApiOkResponse({ type: SupplierSearchResponseDto })
  async searchSupplier(
    @Param('code') code: string,
    @Query('article') article: string,
    @Query('brand') brand: string | undefined,
  ): Promise<SupplierSearchResponseDto> {
    if (!article || !article.trim()) {
      throw new BadRequestException('Query parameter "article" is required.');
    }
    return this.searchService.searchSupplier(
      code,
      article.trim(),
      brand?.trim() || undefined,
    );
  }

  @Get('history')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'История поиска (с постраничной выдачей)',
    description:
      'Возвращает историю поисковых запросов. Обычный пользователь видит только свои запросы, а ' +
      'менеджер и администратор — запросы всех пользователей. Результат выдаётся постранично. ' +
      'Удобно для анализа спроса и повторного поиска ранее искавшихся деталей. Требует авторизации.',
  })
  @ApiOkResponse({ type: HistoryResponseDto })
  history(
    @CurrentUser() user: User,
    @Query() query: HistoryQueryDto,
  ): Promise<HistoryResponseDto> {
    return this.searchService.history(user, query);
  }
}
