import { IsEmail, IsString, MinLength, MaxLength, IsNotEmpty } from 'class-validator';
import { IsAlreadyRegistered } from '../validators/is-already-registered.validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  @IsAlreadyRegistered()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  lastName: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(64)
  password: string;
}
