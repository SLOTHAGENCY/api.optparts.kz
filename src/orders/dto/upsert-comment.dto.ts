import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class UpsertCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  comment: string;
}