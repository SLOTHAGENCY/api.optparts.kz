import { IsNumber, IsString, Max, Min, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertBrandMarkupDto {
  @ApiProperty({ example: 'BOSCH' })
  @IsString() @MinLength(1)
  brand: string;

  @ApiProperty({ example: 25, minimum: 0, maximum: 1000 })
  @IsNumber() @Min(0) @Max(1000)
  markupPercent: number;
}
