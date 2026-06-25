import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import { SearchService } from './search.service';
import { SearchResponseDto } from './dto/search-response.dto';
import { HistoryQueryDto, HistoryResponseDto } from './dto/search-history.dto';

@ApiTags('search')
@Controller('search')
@UseGuards(RolesGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @ApiBearerAuth()
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
    @CurrentUser() user: User | undefined,
  ): Promise<SearchResponseDto> {
    if (!article || !article.trim()) {
      throw new BadRequestException('Query parameter "article" is required.');
    }
    return this.searchService.search(
      article.trim(),
      brand?.trim() || undefined,
      user?.id,
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
