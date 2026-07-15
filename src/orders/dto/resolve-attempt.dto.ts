import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What the admin learned from the supplier about an ambiguous (SENDING) sub-order:
 * did the order actually reach them, or not? This is a human's verdict, not a guess —
 * it is the only way such a row leaves its ambiguous state.
 */
export class ResolveAttemptDto {
  @ApiProperty({
    description:
      'Дошёл ли заказ до поставщика (подтверждено по телефону/в личном кабинете поставщика). ' +
      'true — заказ у поставщика есть: под-заказ помечается как размещённый (PLACED). ' +
      'false — заказа у поставщика нет: под-заказ помечается как FAILED, и его снова можно повторить.',
    example: false,
  })
  @IsBoolean()
  delivered: boolean;

  @ApiPropertyOptional({
    description:
      'Номер заказа в системе поставщика. Обязателен при delivered=true: без него под-заказ ' +
      'станет PLACED без внешнего id и его нельзя будет отслеживать (опрашивать статус).',
    example: 'EXT-12345',
  })
  // Required when delivered=true (else PLACED with a null external id is unpollable forever);
  // ignored when delivered=false.
  @ValidateIf((o) => o.delivered === true)
  @IsNotEmpty({
    message: 'externalOrderId обязателен, если заказ дошёл до поставщика (delivered=true).',
  })
  @IsString()
  @MaxLength(255)
  externalOrderId?: string;

  @ApiPropertyOptional({
    description:
      'Разрешить подтверждение, даже если попытка отправки началась недавно (в пределах ' +
      'таймаута отправки). Используйте, только если вы вручную подтвердили результат у поставщика.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    description: 'Комментарий администратора: как именно был подтверждён результат.',
    example: 'Созвонились с менеджером поставщика — заказ у них не появился.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
