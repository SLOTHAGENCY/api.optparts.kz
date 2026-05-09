import { IsString, IsNotEmpty, IsNumber, Min, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString() @IsNotEmpty() @MaxLength(100) sku: string;
  @IsString() @IsNotEmpty() @MaxLength(255) name: string;

  @IsNumber() @Min(0) @Type(() => Number) price: number;

  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() brandId?: string;
}