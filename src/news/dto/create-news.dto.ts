import { IsISO8601, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNewsDto {
  @ApiProperty({ example: 'Появились запчасти на китайские авто' })
  @IsString() @MinLength(1) @MaxLength(255)
  title: string;

  @ApiProperty({ example: '<b>Огромный ассортимент</b> деталей...' })
  @IsString() @MinLength(1)
  body: string;

  @ApiPropertyOptional({ example: 'https://.../cover.jpg', nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1024)
  coverImage?: string | null;

  @ApiPropertyOptional({ example: '2026-07-03T10:00:00.000Z', description: 'ISO-дата публикации; по умолчанию — текущее время' })
  @IsOptional() @IsISO8601()
  publishedAt?: string;
}
