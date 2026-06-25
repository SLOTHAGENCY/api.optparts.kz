import { IsEmail, IsString, MinLength, MaxLength, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsAlreadyRegistered } from '../validators/is-already-registered.validator';

export class RegisterDto {
  @ApiProperty({ description: 'Email пользователя (должен быть уникальным)', example: 'user@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsAlreadyRegistered()
  email: string;

  @ApiProperty({ description: 'Имя (от 2 до 100 символов)', example: 'Aliya', minLength: 2, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ description: 'Фамилия (от 2 до 100 символов)', example: 'Bekova', minLength: 2, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ description: 'Пароль (минимум 8 символов)', example: 'SecretPass1', minLength: 8, maxLength: 64 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(64)
  password: string;
}
