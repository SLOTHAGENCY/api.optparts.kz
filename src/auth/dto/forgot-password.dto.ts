import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ description: 'Email аккаунта, для которого нужен сброс пароля', example: 'user@example.com' })
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  email: string;
}
