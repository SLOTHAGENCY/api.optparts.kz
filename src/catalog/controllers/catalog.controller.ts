import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { PartsCatalogService, CatalogQueryContext } from '../services/parts-catalog.service';
import { CatalogProductsQueryDto, CatalogQueryDto } from '../dto/catalog-query.dto';
import {
  CarBrandDto,
  CarEngineDto,
  CarGenerationDto,
  CarModelDto,
  CatalogProductsDto,
  CategoryDto,
  FacetDto,
  GroupNodeDto,
} from '../dto/catalog.dto';

@ApiTags('catalog')
@Controller('catalog')
@Public()
@UseGuards(OptionalJwtAuthGuard)
export class CatalogController {
  constructor(private readonly catalog: PartsCatalogService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Список категорий каталога (реальные из PartsIndex)' })
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ru'] })
  @ApiOkResponse({ type: [CategoryDto] })
  categories(@Query('lang') lang?: string): Promise<CategoryDto[]> {
    return this.catalog.listCategories(lang);
  }

  @Get('categories/:catalogId/groups')
  @ApiOperation({ summary: 'Дерево групп (узлов) категории' })
  @ApiParam({ name: 'catalogId', example: 'lamps' })
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ru'] })
  @ApiOkResponse({ type: [GroupNodeDto] })
  groups(@Param('catalogId') catalogId: string, @Query('lang') lang?: string): Promise<GroupNodeDto[]> {
    return this.catalog.groups(catalogId, lang);
  }

  @Get('categories/:catalogId/suggest')
  @ApiOperation({ summary: 'Автодополнение по названию детали/узла внутри категории' })
  @ApiParam({ name: 'catalogId', example: 'oils' })
  @ApiQuery({ name: 'groupId', required: true })
  @ApiQuery({ name: 'q', required: true, description: 'Минимум 3 символа' })
  @ApiOkResponse({ type: [String] })
  suggest(
    @Param('catalogId') catalogId: string,
    @Query('groupId') groupId: string,
    @Query('q') q: string,
  ): Promise<string[]> {
    if (!groupId?.trim()) throw new BadRequestException('Query parameter "groupId" is required.');
    if (!q || q.trim().length < 3) throw new BadRequestException('Query parameter "q" must be at least 3 chars.');
    return this.catalog.suggest(catalogId, groupId.trim(), q.trim());
  }

  @Get('categories/:catalogId/params')
  @ApiOperation({ summary: 'Фасеты (фильтры) категории при текущем узле/авто/выбранных значениях' })
  @ApiParam({ name: 'catalogId', example: 'oils' })
  @ApiOkResponse({ type: [FacetDto] })
  params(@Param('catalogId') catalogId: string, @Query() query: CatalogQueryDto): Promise<FacetDto[]> {
    return this.catalog.params(catalogId, this.toContext(query));
  }

  @Get('categories/:catalogId/products')
  @ApiOperation({ summary: 'Товары категории (пагинация, сужение по узлу/авто/фасетам)' })
  @ApiParam({ name: 'catalogId', example: 'oils' })
  @ApiOkResponse({ type: CatalogProductsDto })
  products(
    @Param('catalogId') catalogId: string,
    @Query() query: CatalogProductsQueryDto,
  ): Promise<CatalogProductsDto> {
    return this.catalog.products(catalogId, this.toContext(query), query.page ?? 1, query.limit ?? 25);
  }

  @Get('car/brands')
  @ApiOperation({ summary: 'Марки авто (дерево авто для сужения категории)' })
  @ApiQuery({ name: 'q', required: false })
  @ApiOkResponse({ type: [CarBrandDto] })
  carBrands(@Query('q') q?: string): Promise<CarBrandDto[]> {
    return this.catalog.carBrands(q?.trim() || undefined);
  }

  @Get('car/brands/:brandId/models')
  @ApiOperation({ summary: 'Модели марки' })
  @ApiOkResponse({ type: [CarModelDto] })
  carModels(@Param('brandId') brandId: string): Promise<CarModelDto[]> {
    return this.catalog.carModels(brandId);
  }

  @Get('car/brands/:brandId/models/:modelId/generations')
  @ApiOperation({ summary: 'Поколения модели' })
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'ru'] })
  @ApiOkResponse({ type: [CarGenerationDto] })
  carGenerations(
    @Param('brandId') brandId: string,
    @Param('modelId') modelId: string,
    @Query('lang') lang?: string,
  ): Promise<CarGenerationDto[]> {
    return this.catalog.carGenerations(brandId, modelId, lang);
  }

  @Get('car/brands/:brandId/models/:modelId/generations/:generationId/engines')
  @ApiOperation({ summary: 'Двигатели поколения' })
  @ApiOkResponse({ type: [CarEngineDto] })
  carEngines(
    @Param('brandId') brandId: string,
    @Param('modelId') modelId: string,
    @Param('generationId') generationId: string,
  ): Promise<CarEngineDto[]> {
    return this.catalog.carEngines(brandId, modelId, generationId);
  }

  private toContext(query: CatalogQueryDto): CatalogQueryContext {
    return {
      groupId: query.groupId,
      generationId: query.generationId,
      engineId: query.engineId,
      filters: this.parseFilters(query.filters),
      q: query.q,
      lang: query.lang,
    };
  }

  private parseFilters(raw?: string): Record<string, string> | undefined {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) out[k] = String(v);
        return out;
      }
    } catch {
      throw new BadRequestException('Query parameter "filters" must be a JSON object.');
    }
    throw new BadRequestException('Query parameter "filters" must be a JSON object.');
  }
}
