import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { PartsIndexService } from '../services/parts-index.service';
import { ProductCardService } from '../services/product-card.service';
import {
  PartAnalogDto,
  PartApplicabilityDto,
  PartBrandDto,
  ProductCardDto,
} from '../dto/parts.dto';

@ApiTags('parts')
@Controller('parts')
@Public()
@UseGuards(OptionalJwtAuthGuard)
export class PartsController {
  constructor(
    private readonly parts: PartsIndexService,
    private readonly card: ProductCardService,
  ) {}

  @Get('brands')
  @ApiOperation({
    summary: 'Бренды по артикулу',
    description:
      'Возвращает список брендов (производителей), у которых есть деталь с указанным артикулом. ' +
      'Используется для дизамбигуации бренда перед показом карточки или поиском цен.',
  })
  @ApiQuery({ name: 'code', required: true, example: '0451103316', description: 'Артикул детали' })
  @ApiOkResponse({ type: [PartBrandDto] })
  brands(@Query('code') code: string): Promise<PartBrandDto[]> {
    return this.parts.brandsByCode(this.required(code, 'code'));
  }

  @Get('card')
  @ApiOperation({
    summary: 'Карточка детали',
    description:
      'Полная карточка: название, бренд, фото, характеристики (из PartsIndex), аналоги, ' +
      'применяемость и живые предложения поставщиков (цена/наличие). Источники деградируют ' +
      'независимо — сбой одного не блокирует остальные.',
  })
  @ApiQuery({ name: 'code', required: true, example: '0451103316' })
  @ApiQuery({ name: 'brand', required: false, example: 'BOSCH' })
  @ApiQuery({ name: 'lang', required: false, example: 'ru', enum: ['en', 'ru'] })
  @ApiOkResponse({ type: ProductCardDto })
  getCard(
    @Query('code') code: string,
    @Query('brand') brand?: string,
    @Query('lang') lang?: string,
  ): Promise<ProductCardDto> {
    return this.card.getCard(this.required(code, 'code'), brand?.trim() || undefined, lang);
  }

  @Get('analogs')
  @ApiOperation({
    summary: 'Аналоги / кросс-коды',
    description:
      'Список связанных запчастей (аналоги, замены, ремкомплекты и т.д.) по артикулу+бренду ' +
      'или по идентификатору детали PartsIndex. Тип связи задаётся параметром types.',
  })
  @ApiQuery({ name: 'code', required: false, example: '17177' })
  @ApiQuery({ name: 'brand', required: false, example: 'Narva' })
  @ApiQuery({ name: 'id', required: false, example: '27805381', description: 'ID детали PartsIndex (альтернатива code+brand)' })
  @ApiQuery({ name: 'types', required: false, example: 'all' })
  @ApiOkResponse({ type: [PartAnalogDto] })
  analogs(
    @Query('code') code?: string,
    @Query('brand') brand?: string,
    @Query('id') id?: string,
    @Query('types') types?: string,
  ): Promise<PartAnalogDto[]> {
    if (!id && !(code && brand)) {
      throw new BadRequestException('Provide either "id" or both "code" and "brand".');
    }
    return this.parts.analogs({ id, code, brand, types });
  }

  @Get('applicability')
  @ApiOperation({
    summary: 'Применяемость (подходящие авто)',
    description: 'Список автомобилей (марка/модель/модификация/двигатель/годы), к которым подходит деталь.',
  })
  @ApiQuery({ name: 'code', required: true, example: '17177' })
  @ApiQuery({ name: 'brand', required: true, example: 'Narva' })
  @ApiQuery({ name: 'lang', required: false, example: 'ru', enum: ['en', 'ru'] })
  @ApiOkResponse({ type: [PartApplicabilityDto] })
  applicability(
    @Query('code') code: string,
    @Query('brand') brand: string,
    @Query('lang') lang?: string,
  ): Promise<PartApplicabilityDto[]> {
    return this.parts.applicability(this.required(code, 'code'), this.required(brand, 'brand'), lang);
  }

  private required(value: string | undefined, name: string): string {
    if (!value || !value.trim()) {
      throw new BadRequestException(`Query parameter "${name}" is required.`);
    }
    return value.trim();
  }
}
