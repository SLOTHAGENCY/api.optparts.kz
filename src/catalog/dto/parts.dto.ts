import { ApiProperty } from '@nestjs/swagger';
import { OfferDto } from '../../search/dto/search-response.dto';

export class PartBrandDto {
  @ApiProperty({ description: 'Идентификатор бренда в PartsIndex', example: '3799' })
  id: string;

  @ApiProperty({ description: 'Название бренда', example: 'Bosch' })
  name: string;
}

export class PartParamDto {
  @ApiProperty({ description: 'Название параметра', example: 'Напряжение' })
  title: string;

  @ApiProperty({ description: 'Значение параметра', example: '13.2' })
  value: string;

  @ApiProperty({ description: 'Единица измерения (если есть)', example: 'V', nullable: true })
  unit: string | null;
}

export class PartParamGroupDto {
  @ApiProperty({ description: 'Название группы параметров', example: 'Электрические характеристики' })
  group: string;

  @ApiProperty({ description: 'Параметры группы', type: [PartParamDto] })
  items: PartParamDto[];
}

export class PartAnalogDto {
  @ApiProperty({ description: 'Идентификатор запчасти-аналога в PartsIndex', example: '27805381' })
  id: string;

  @ApiProperty({ description: 'Артикул аналога', example: '17177' })
  code: string;

  @ApiProperty({ description: 'Бренд аналога', type: PartBrandDto })
  brand: PartBrandDto;

  @ApiProperty({ description: 'Тип связи (analog, replacement, ...)', example: 'analog' })
  relation: string;
}

export class PartApplicabilityDto {
  @ApiProperty({ description: 'Марка авто', example: 'Toyota' })
  brand: string;

  @ApiProperty({ description: 'Модель авто', example: 'Camry' })
  model: string;

  @ApiProperty({ description: 'Модификация', example: '2.5 (2AR-FE)' })
  modif: string;

  @ApiProperty({ description: 'Год начала выпуска', example: 2011, nullable: true })
  yearFrom: number | null;

  @ApiProperty({ description: 'Год окончания выпуска', example: 2017, nullable: true })
  yearTo: number | null;

  @ApiProperty({ description: 'Мощность, кВт', example: 133, nullable: true })
  kw: number | null;

  @ApiProperty({ description: 'Мощность, л.с.', example: 181, nullable: true })
  hp: number | null;

  @ApiProperty({ description: 'Объём двигателя, см³', example: 2494, nullable: true })
  cc: number | null;

  @ApiProperty({ description: 'Тип кузова', example: 'Sedan', nullable: true })
  body: string | null;

  @ApiProperty({ description: 'Код двигателя', example: '2AR-FE', nullable: true })
  engineCode: string | null;
}

export class ProductCardDto {
  @ApiProperty({ description: 'Идентификатор запчасти в PartsIndex', example: '27805381', nullable: true })
  id: string | null;

  @ApiProperty({ description: 'Артикул', example: '0451103316' })
  code: string;

  @ApiProperty({ description: 'Стандартизированное название типа детали', example: 'Масляный фильтр' })
  name: string;

  @ApiProperty({ description: 'Оригинальное название производителя', example: 'Ultinon Pro5000', nullable: true })
  originalName: string | null;

  @ApiProperty({ description: 'Бренд детали', type: PartBrandDto, nullable: true })
  brand: PartBrandDto | null;

  @ApiProperty({ description: 'Описание', example: '', nullable: true })
  description: string | null;

  @ApiProperty({ description: 'Штрихкоды / EAN', type: [String] })
  barcodes: string[];

  @ApiProperty({ description: 'URL фотографий детали', type: [String] })
  images: string[];

  @ApiProperty({ description: 'Технические характеристики, сгруппированные', type: [PartParamGroupDto] })
  parameters: PartParamGroupDto[];

  @ApiProperty({ description: 'Аналоги / кросс-коды', type: [PartAnalogDto] })
  analogs: PartAnalogDto[];

  @ApiProperty({ description: 'Применяемость (подходящие автомобили)', type: [PartApplicabilityDto] })
  applicability: PartApplicabilityDto[];

  @ApiProperty({
    description:
      'Предложения поставщиков (цена/наличие/срок) по этому артикулу+бренду из живого поиска. ' +
      'Пусто, если поставщики не нашли деталь или поиск недоступен.',
    type: [OfferDto],
  })
  offers: OfferDto[];
}
