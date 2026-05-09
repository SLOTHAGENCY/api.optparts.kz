import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateBrandDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsString() description?: string;
}