import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { User } from '../../users/entities/user.entity';
import { SearchService } from '../../search/search.service';
import { OemCatalogService } from '../services/oem-catalog.service';
import {
  OemCarDto,
  OemCarParameterDto,
  OemCatalogDto,
  OemGroupDto,
  OemModelDto,
  OemPartsDto,
  VinCarDto,
  VinValidationDto,
} from '../dto/oem.dto';

@ApiTags('oem')
@Controller('oem')
@Public()
@UseGuards(OptionalJwtAuthGuard)
export class OemController {
  constructor(
    private readonly oem: OemCatalogService,
    private readonly searchService: SearchService,
  ) {}

  @Get('catalogs')
  @ApiOperation({ summary: 'Список каталогов (марок) OEM' })
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ru', 'de', 'bg', 'fr', 'es', 'he'] })
  @ApiOkResponse({ type: [OemCatalogDto] })
  catalogs(@Query('lang') lang?: string): Promise<OemCatalogDto[]> {
    return this.oem.listCatalogs(lang);
  }

  @Get('catalogs/:catalogId/models')
  @ApiOperation({ summary: 'Модели каталога' })
  @ApiParam({ name: 'catalogId', example: 'bmw' })
  @ApiOkResponse({ type: [OemModelDto] })
  models(@Param('catalogId') catalogId: string, @Query('lang') lang?: string): Promise<OemModelDto[]> {
    return this.oem.listModels(catalogId, lang);
  }

  @Get('catalogs/:catalogId/cars')
  @ApiOperation({ summary: 'Конфигурации авто модели (с фильтрами и пагинацией)' })
  @ApiParam({ name: 'catalogId', example: 'bmw' })
  @ApiQuery({ name: 'modelId', required: true })
  @ApiQuery({ name: 'parameter', required: false, description: 'Фильтр по idx параметров (через запятую)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  cars(
    @Param('catalogId') catalogId: string,
    @Query('modelId') modelId: string,
    @Query('parameter') parameter?: string,
    @Query('page') page?: string,
    @Query('lang') lang?: string,
  ): Promise<{ items: OemCarDto[]; total: number | null }> {
    return this.oem.listCars(
      catalogId,
      this.required(modelId, 'modelId'),
      parameter,
      page ? Number(page) : undefined,
      lang,
    );
  }

  @Get('catalogs/:catalogId/car-parameters')
  @ApiOperation({ summary: 'Доступные фильтры авто (год/двигатель/рынок)' })
  @ApiParam({ name: 'catalogId', example: 'bmw' })
  @ApiQuery({ name: 'modelId', required: true })
  @ApiQuery({ name: 'parameter', required: false })
  @ApiOkResponse({ type: [OemCarParameterDto] })
  carParameters(
    @Param('catalogId') catalogId: string,
    @Query('modelId') modelId: string,
    @Query('parameter') parameter?: string,
    @Query('lang') lang?: string,
  ): Promise<OemCarParameterDto[]> {
    return this.oem.carParameters(catalogId, this.required(modelId, 'modelId'), parameter, lang);
  }

  @Get('catalogs/:catalogId/cars/:carId')
  @ApiOperation({ summary: 'Конфигурация авто по id' })
  @ApiOkResponse({ type: OemCarDto })
  car(
    @Param('catalogId') catalogId: string,
    @Param('carId') carId: string,
    @Query('criteria') criteria?: string,
    @Query('lang') lang?: string,
  ): Promise<OemCarDto | null> {
    return this.oem.getCar(catalogId, carId, criteria, lang);
  }

  @Get('vin/validate')
  @ApiOperation({ summary: 'Валидация/нормализация VIN' })
  @ApiQuery({ name: 'vin', required: true })
  @ApiOkResponse({ type: VinValidationDto })
  validateVin(@Query('vin') vin: string, @Query('lang') lang?: string): Promise<VinValidationDto | null> {
    return this.oem.validateVin(this.required(vin, 'vin'), lang);
  }

  @Get('vin')
  @ApiOperation({ summary: 'Подбор авто по VIN/FRAME' })
  @ApiQuery({ name: 'q', required: true, description: 'VIN или номер кузова' })
  @ApiQuery({ name: 'catalogs', required: false, description: 'Ограничить марками (через запятую)' })
  @ApiOkResponse({ type: [VinCarDto] })
  async vin(
    @Query('q') q: string,
    @CurrentUser() user?: User,
    @Query('catalogs') catalogs?: string,
    @Query('lang') lang?: string,
  ): Promise<VinCarDto[]> {
    const query = this.required(q, 'q');
    const normalizedCatalogs = catalogs?.trim() || undefined;
    const cars = await this.oem.carsByVin(query, normalizedCatalogs, lang);
    this.searchService.logVinSearch({
      userId: user?.id,
      vin: query,
      catalogs: normalizedCatalogs ?? null,
      matchedCars: cars.length,
    });
    return cars;
  }

  @Get('catalogs/:catalogId/groups')
  @ApiOperation({ summary: 'Дерево узлов авто (drill-down по groupId)' })
  @ApiParam({ name: 'catalogId', example: 'bmw' })
  @ApiQuery({ name: 'carId', required: true })
  @ApiQuery({ name: 'groupId', required: false, description: 'Пусто = корневые узлы' })
  @ApiQuery({ name: 'criteria', required: false })
  @ApiOkResponse({ type: [OemGroupDto] })
  groups(
    @Param('catalogId') catalogId: string,
    @Query('carId') carId: string,
    @Query('groupId') groupId?: string,
    @Query('criteria') criteria?: string,
    @Query('lang') lang?: string,
  ): Promise<OemGroupDto[]> {
    return this.oem.groups(catalogId, this.required(carId, 'carId'), groupId, criteria, lang);
  }

  @Get('catalogs/:catalogId/parts')
  @ApiOperation({ summary: 'Детали узла + изображение + хот-споты' })
  @ApiParam({ name: 'catalogId', example: 'bmw' })
  @ApiQuery({ name: 'carId', required: true })
  @ApiQuery({ name: 'groupId', required: true })
  @ApiQuery({ name: 'criteria', required: false })
  @ApiOkResponse({ type: OemPartsDto })
  parts(
    @Param('catalogId') catalogId: string,
    @Query('carId') carId: string,
    @Query('groupId') groupId: string,
    @Query('criteria') criteria?: string,
    @Query('lang') lang?: string,
  ): Promise<OemPartsDto> {
    return this.oem.parts(
      catalogId,
      this.required(carId, 'carId'),
      this.required(groupId, 'groupId'),
      criteria,
      lang,
    );
  }

  private required(value: string | undefined, name: string): string {
    if (!value || !value.trim()) {
      throw new BadRequestException(`Query parameter "${name}" is required.`);
    }
    return value.trim();
  }
}
