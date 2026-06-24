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
  @ApiProperty({ description: 'Article of the returned position' })
  @IsString()
  article: string;

  @ApiProperty({ description: 'Quantity to return', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class RequestReturnDto {
  @ApiProperty({ type: [ReturnLineDto], description: 'Positions/quantities to return' })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  items: ReturnLineDto[];
}
