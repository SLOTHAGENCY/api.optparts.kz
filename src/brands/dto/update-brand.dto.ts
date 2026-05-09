import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateBrandDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() description?: string;
}