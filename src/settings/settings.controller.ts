import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService, AppSettings } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get global settings (markup, FX rates, buffer)' })
  get(): Promise<AppSettings> {
    return this.settings.getAll();
  }

  @Put()
  @ApiOperation({ summary: 'Update global settings' })
  async update(@Body() dto: UpdateSettingsDto): Promise<AppSettings> {
    await this.settings.update(dto);
    return this.settings.getAll();
  }
}
