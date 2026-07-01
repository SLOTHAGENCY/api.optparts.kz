import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity';
import { GlobalSearchService } from '../services/global-search.service';
import { GlobalSearchResultDto } from '../dto/global-search.dto';

@ApiTags('search')
@Controller('search')
@Public()
@UseGuards(OptionalJwtAuthGuard)
export class GlobalSearchController {
  constructor(private readonly globalSearch: GlobalSearchService) {}

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
}
