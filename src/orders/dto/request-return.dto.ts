import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReturnLineDto {
  @ApiProperty({ description: 'Артикул возвращаемой позиции' })
  @IsString()
  article: string;

  @ApiProperty({ description: 'Количество к возврату', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class RequestReturnDto {
  @ApiProperty({ type: [ReturnLineDto], description: 'Список позиций и количеств для возврата' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items: ReturnLineDto[];
}
