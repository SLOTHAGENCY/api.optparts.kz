import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { BrandMarkupService } from './brand-markup.service';
import { UpsertBrandMarkupDto } from './dto/upsert-brand-markup.dto';

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('pricing/brand-markups')
@UseGuards(RolesGuard)
export class BrandMarkupController {
  constructor(private readonly service: BrandMarkupService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  @ApiOperation({ summary: 'List brand markups (ADMIN)' })
  findAll() {
    return this.service.findAll();
  }

  @Roles(UserRole.ADMIN)
  @Put()
  @ApiOperation({ summary: 'Create or update a brand markup (ADMIN)' })
  upsert(@Body() dto: UpsertBrandMarkupDto) {
    return this.service.upsert(dto.brand, dto.markupPercent);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':brand')
  @ApiOperation({ summary: 'Delete a brand markup (ADMIN)' })
  remove(@Param('brand') brand: string) {
    return this.service.remove(brand);
  }
}
