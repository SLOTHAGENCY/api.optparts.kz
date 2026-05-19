import { Controller, Get, Query } from '@nestjs/common';
import { RosskoService } from './rossko.service';
import { SearchProductDto } from '../products/dto/search-product.dto';
import { Public } from '../auth/decorators/public.decorator';

@Controller('parts')
export class RosskoController {
  constructor(private readonly rosskoService: RosskoService) {}

  /**
   * GET /api/parts/search?text=Фильтр
   * Searches external Rossko API and returns structured parts list.
   */
  @Public()
  @Get('search')
  search(@Query() dto: SearchProductDto) {
    return this.rosskoService.search(dto.text);
  }
}