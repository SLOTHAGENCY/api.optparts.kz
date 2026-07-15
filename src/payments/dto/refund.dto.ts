import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RefundDto {
  @ApiProperty({ description: 'Сумма возврата в тенге', example: 30000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Причина возврата (для журнала)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
