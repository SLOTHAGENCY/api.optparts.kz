import {
  IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt,
  Min, Max, MinLength, MaxLength, Matches,
} from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'VIN может содержать только буквы и цифры.' })
  vin: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  trim?: string;

  @IsOptional()
  @IsBoolean()
  main?: boolean;
}
