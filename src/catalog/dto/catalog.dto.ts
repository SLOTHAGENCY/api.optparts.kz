import { ApiProperty } from '@nestjs/swagger';
import { PartBrandDto } from './parts.dto';

export class CategoryDto {
  @ApiProperty({ description: 'Идентификатор категории каталога', example: 'lamps' })
  id: string;

  @ApiProperty({ description: 'Название категории', example: 'Лампы' })
  name: string;

  @ApiProperty({ description: 'URL изображения категории', example: 'https://img.parts-index.com/x.png', nullable: true })
  image: string | null;
}

export class GroupNodeDto {
  @ApiProperty({ description: 'Идентификатор группы', example: '84' })
  id: string;

  @ApiProperty({ description: 'Название группы', example: 'Галогенные лампы' })
  name: string;

  @ApiProperty({ description: 'Вложенные группы', type: () => [GroupNodeDto] })
  children: GroupNodeDto[];
}

export class FacetValueDto {
  @ApiProperty({ description: 'Значение фасета', example: '5W-30' })
  value: string;

  @ApiProperty({ description: 'Отображаемая подпись', example: '5W-30' })
  title: string;

  @ApiProperty({ description: 'Доступно ли значение при текущих фильтрах', example: true })
  available: boolean;

  @ApiProperty({ description: 'Выбрано ли значение', example: false })
  selected: boolean;
}

export class FacetDto {
  @ApiProperty({ description: 'Идентификатор параметра-фасета', example: '120' })
  id: string;

  @ApiProperty({ description: 'Код параметра', example: 'viscosity' })
  code: string;

  @ApiProperty({ description: 'Название фасета', example: 'Вязкость' })
  name: string;

  @ApiProperty({ description: 'Тип: select (список) или range (диапазон)', example: 'select', enum: ['select', 'range'] })
  type: string;

  @ApiProperty({ description: 'Значения фасета', type: [FacetValueDto] })
  values: FacetValueDto[];
}

export class CatalogProductDto {
  @ApiProperty({ description: 'Идентификатор товара в PartsIndex', example: '27805381' })
  id: string;

  @ApiProperty({ description: 'Артикул', example: 'LM5W30' })
  code: string;

  @ApiProperty({ description: 'Название типа детали', example: 'Моторное масло' })
  name: string;

  @ApiProperty({ description: 'Оригинальное название', example: 'Armortech 5W-30', nullable: true })
  originalName: string | null;

  @ApiProperty({ description: 'Бренд', type: PartBrandDto, nullable: true })
  brand: PartBrandDto | null;

  @ApiProperty({ description: 'URL фотографий', type: [String] })
  images: string[];
}

export class PageInfoDto {
  @ApiProperty({ description: 'Предыдущая страница', example: null, nullable: true })
  prev: number | null;

  @ApiProperty({ description: 'Текущая страница', example: 1 })
  current: number;

  @ApiProperty({ description: 'Следующая страница', example: 2, nullable: true })
  next: number | null;
}

export class CatalogProductsDto {
  @ApiProperty({ description: 'Размер страницы', example: 25 })
  limit: number;

  @ApiProperty({ description: 'Навигация по страницам', type: PageInfoDto })
  page: PageInfoDto;

  @ApiProperty({ description: 'Товары страницы', type: [CatalogProductDto] })
  items: CatalogProductDto[];
}

export class CarBrandDto {
  @ApiProperty({ description: 'Идентификатор марки', example: '73' })
  id: string;

  @ApiProperty({ description: 'Марка', example: 'Toyota' })
  name: string;
}

export class CarModelDto {
  @ApiProperty({ description: 'Идентификатор модели', example: '512' })
  id: string;

  @ApiProperty({ description: 'Модель', example: 'Camry' })
  name: string;

  @ApiProperty({ description: 'URL изображения модели', nullable: true })
  image: string | null;
}

export class CarGenerationDto {
  @ApiProperty({ description: 'Идентификатор поколения', example: 'g50' })
  id: string;

  @ApiProperty({ description: 'Название поколения', example: 'XV50 (2011-2017)' })
  name: string;

  @ApiProperty({ description: 'Год начала', example: 2011, nullable: true })
  yearFrom: number | null;

  @ApiProperty({ description: 'Год окончания', example: 2017, nullable: true })
  yearTo: number | null;
}

export class CarEngineDto {
  @ApiProperty({ description: 'Идентификатор двигателя', example: 'e1' })
  id: string;

  @ApiProperty({ description: 'Код двигателя', example: '2AR-FE', nullable: true })
  code: string | null;

  @ApiProperty({ description: 'Мощность, л.с.', example: 181, nullable: true })
  hp: number | null;

  @ApiProperty({ description: 'Мощность, кВт', example: 133, nullable: true })
  kw: number | null;

  @ApiProperty({ description: 'Объём, см³', example: 2494, nullable: true })
  cc: number | null;
}
