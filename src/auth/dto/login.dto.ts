import { IsEmail, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ValidateCredentials } from '../validators/validate-credentials.validator';

export class LoginDto {
  @ApiProperty({ description: 'Email, указанный при регистрации', example: 'user@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  email: string;

  @ApiProperty({ description: 'Пароль от аккаунта', example: 'SecretPass1' })
  @IsString()
  @IsNotEmpty()
  @ValidateCredentials()
  password: string;
}
