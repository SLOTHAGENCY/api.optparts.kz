import { IsString, IsOptional, IsEmail, IsUUID, MinLength, MaxLength } from 'class-validator';
import { IsAlreadyRegistered } from '../validators/is-already-registered.validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsEmail()
  @IsAlreadyRegistered()
  email?: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) lastName?: string;
  @IsOptional() @IsString() profileImage?: string;

  // Not exposed in API — set by the controller so the validator can check ownership
  @IsOptional() @IsUUID()
  currentUserId?: string;
}