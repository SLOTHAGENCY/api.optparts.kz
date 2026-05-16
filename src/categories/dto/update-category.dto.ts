import { IsString, IsOptional, MaxLength, IsUUID } from 'class-validator';

export class UpdateCategoryDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsUUID()
  parentId?: string;
}