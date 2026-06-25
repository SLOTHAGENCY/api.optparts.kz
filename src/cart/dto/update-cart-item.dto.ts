import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateCartItemDto {
  @ApiProperty({ description: 'Новое количество позиции (минимум 1)', example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}
