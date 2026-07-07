import { IsISO8601, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateNewsDto {
  @ApiPropertyOptional({ example: 'Новый заголовок' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ example: '<i>обновлённый контент</i>' })
  @IsOptional() @IsString() @MinLength(1)
  body?: string;

  @ApiPropertyOptional({ example: 'https://.../cover.jpg', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1024)
  coverImage?: string | null;

  @ApiPropertyOptional({ example: '2026-07-03T10:00:00.000Z' })
  @IsOptional() @IsISO8601()
  publishedAt?: string;
}
