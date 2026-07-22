import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Токен из ссылки в письме', example: 'a1b2c3...' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ description: 'Новый пароль (минимум 8 символов)', example: 'SecretPass1', minLength: 8, maxLength: 64 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(64)
  newPassword: string;
}
