import { ApiProperty } from '@nestjs/swagger';

export class NameSuggestionDto {
  @ApiProperty({ enum: ['category', 'group'], example: 'category' })
  kind: 'category' | 'group';

  @ApiProperty({ description: 'Id категории каталога', example: 'ignition' })
  categoryId: string;

  @ApiProperty({ description: 'Id подгруппы (для kind=group)', example: '84', nullable: true })
  groupId: string | null;

  @ApiProperty({ description: 'Отображаемое название', example: 'Свечи зажигания' })
  name: string;

  @ApiProperty({ description: 'Имя родительской категории (для kind=group)', example: 'Зажигание', nullable: true })
  parentName: string | null;

  @ApiProperty({ description: 'Оценка релевантности (больше — лучше)', example: 115 })
  score: number;
}

export class SuggestResponseDto {
  @ApiProperty({ example: 'свеча' })
  query: string;

  @ApiProperty({ type: [NameSuggestionDto] })
  suggestions: NameSuggestionDto[];
}
