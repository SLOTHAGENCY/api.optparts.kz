import {
  IsString,
  IsOptional,
  IsEmail,
  IsUUID,
  IsArray,
  Matches,
  MinLength,
  MaxLength,
} from 'class-validator';
import { IsAlreadyRegistered } from '../validators/is-already-registered.validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsEmail()
  @IsAlreadyRegistered()
  email?: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) lastName?: string;
  @IsOptional() @IsString() profileImage?: string;

  @IsOptional()
  @IsArray()
  @Matches(/^\+?[0-9 ()-]{7,}$/, { each: true })
  phones?: string[];

  // Not exposed in API — set by the controller so the validator can check ownership
  @IsOptional() @IsUUID()
  currentUserId?: string;
}