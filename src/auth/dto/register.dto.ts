import { IsEmail, IsString, MinLength, MaxLength, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsAlreadyRegistered } from '../validators/is-already-registered.validator';

export class RegisterDto {
  @ApiProperty({ description: 'User email address', example: 'user@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsAlreadyRegistered()
  email: string;

  @ApiProperty({ description: 'First name', example: 'Aliya', minLength: 2, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ description: 'Last name', example: 'Bekova', minLength: 2, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ description: 'Password (min 8 characters)', example: 'SecretPass1', minLength: 8, maxLength: 64 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(64)
  password: string;
}
