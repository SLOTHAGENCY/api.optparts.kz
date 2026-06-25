import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { SuppliersService } from './suppliers.service';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@ApiTags('Suppliers')
@ApiBearerAuth()
@Controller('suppliers')
@UseGuards(RolesGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  @ApiOperation({ summary: 'List all supplier partner configs (ADMIN)' })
  findAll() {
    return this.suppliersService.findAll();
  }

  @Roles(UserRole.ADMIN)
  @Patch(':code')
  @ApiOperation({ summary: 'Update a supplier: isActive / markupPercent / config (ADMIN)' })
  @ApiParam({ name: 'code', example: 'rossko' })
  update(@Param('code') code: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(code, dto);
  }
}
