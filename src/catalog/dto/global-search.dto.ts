import { ApiProperty } from '@nestjs/swagger';
import { SearchResponseDto } from '../../search/dto/search-response.dto';
import { PartBrandDto } from './parts.dto';
import { CategoryDto } from './catalog.dto';
import { VinCarDto } from './oem.dto';

export type SearchMode = 'vin' | 'article' | 'name';

export class GlobalSearchArticleDto {
  @ApiProperty({ description: 'Бренды по артикулу (дизамбигуация)', type: [PartBrandDto] })
  brands: PartBrandDto[];

  @ApiProperty({ description: 'Живые предложения поставщиков (exact/analogs с ценами)', type: SearchResponseDto })
  search: SearchResponseDto;
}

export class GlobalSearchNameDto {
  @ApiProperty({ description: 'Категории каталога, подходящие под запрос', type: [CategoryDto] })
  categories: CategoryDto[];
}

export class GlobalSearchResultDto {
  @ApiProperty({ description: 'Определённый режим', enum: ['vin', 'article', 'name'], example: 'article' })
  mode: SearchMode;

  @ApiProperty({ description: 'Исходный запрос', example: '0451103316' })
  query: string;

  @ApiProperty({ description: 'Найденные авто (режим vin)', type: [VinCarDto] })
  vin: VinCarDto[];

  @ApiProperty({ description: 'Результат по артикулу (режим article)', type: GlobalSearchArticleDto, nullable: true })
  article: GlobalSearchArticleDto | null;

  @ApiProperty({ description: 'Результат по названию (режим name)', type: GlobalSearchNameDto, nullable: true })
  name: GlobalSearchNameDto | null;
}
