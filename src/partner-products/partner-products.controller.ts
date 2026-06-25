import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { PartnerProductsService } from './partner-products.service';
import { QueryPartnerProductsDto } from './dto/query-partner-products.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('partner-products')
@UseGuards(RolesGuard)
export class PartnerProductsController {
  constructor(private readonly service: PartnerProductsService) {}

  @Roles(UserRole.MANAGER, UserRole.ADMIN)
  @Get()
  @ApiOperation({
    summary: 'Аналитический каталог товаров поставщиков (менеджер/админ)',
    description:
      'Возвращает справочно-аналитический каталог товаров поставщиков с постраничной выдачей и ' +
      'фильтрами. Это витрина для анализа ассортимента (что вообще бывает у поставщиков), а НЕ ' +
      'источник актуальных цен и наличия — для реальных цен и наличия используется живой поиск ' +
      '(/search). Доступно только менеджеру или администратору.',
  })
  @ApiResponse({ status: 200, description: 'Строки каталога с постраничной выдачей.' })
  findMany(@Query() query: QueryPartnerProductsDto) {
    return this.service.findMany(query);
  }
}
