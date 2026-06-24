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
    summary:
      'List the partner products analytics catalog (MANAGER/ADMIN). Not a price/search source.',
  })
  @ApiResponse({ status: 200, description: 'Paginated catalog rows.' })
  findMany(@Query() query: QueryPartnerProductsDto) {
    return this.service.findMany(query);
  }
}
