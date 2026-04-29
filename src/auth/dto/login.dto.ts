import { IsEmail, IsString, IsNotEmpty } from 'class-validator';
import { ValidateCredentials } from '../validators/validate-credentials.validator';

export class LoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  email: string;

  @IsString()
  @IsNotEmpty()
  @ValidateCredentials()
  password: string;
}
