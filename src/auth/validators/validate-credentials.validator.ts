import { Injectable } from '@nestjs/common';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { UsersService } from '../../users/users.service';

@ValidatorConstraint({ name: 'ValidateCredentials', async: true })
@Injectable()
export class ValidateCredentialsConstraint implements ValidatorConstraintInterface {
  constructor(private readonly usersService: UsersService) {}

  async validate(password: string, args: ValidationArguments): Promise<boolean> {
    const object = args.object as { email?: string };
    const { email } = object;
    if (!email) return false;
    const user = await this.usersService.findByEmail(email);
    if (!user) return false;
    return user.comparePassword(password);
  }

  defaultMessage(): string {
    return 'Invalid email or password.';
  }
}

export function ValidateCredentials(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: ValidateCredentialsConstraint,
    });
  };
}
