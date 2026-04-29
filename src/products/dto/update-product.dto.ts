import { IsString, IsOptional, IsNumber, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(100) brand?: string;
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) price?: number;
}
