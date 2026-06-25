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
  @ApiOperation({ summary: 'Live multi-supplier search by article (+ optional brand)' })
  @ApiQuery({ name: 'article', required: true, example: '0451103316' })
  @ApiQuery({ name: 'brand', required: false, example: 'BOSCH' })
  @ApiQuery({ name: 'priceMin', required: false, example: 1000 })
  @ApiQuery({ name: 'priceMax', required: false, example: 9000 })
  @ApiQuery({ name: 'inStock', required: false, example: true })
  @ApiQuery({ name: 'maxDeliveryDays', required: false, example: 5 })
  @ApiQuery({ name: 'suppliers', required: false, example: 'rossko,tabys' })
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

  @Get('history')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Search history — own records; MANAGER/ADMIN see all (paginated)',
  })
  @ApiOkResponse({ type: HistoryResponseDto })
  history(
    @CurrentUser() user: User,
    @Query() query: HistoryQueryDto,
  ): Promise<HistoryResponseDto> {
    return this.searchService.history(user, query);
  }
}
