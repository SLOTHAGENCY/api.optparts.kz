import { Injectable } from '@nestjs/common';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { UsersService } from '../../users/users.service';

@ValidatorConstraint({ name: 'IsAlreadyRegistered', async: true })
@Injectable()
export class IsAlreadyRegisteredConstraint implements ValidatorConstraintInterface {
  constructor(private readonly usersService: UsersService) {}

  async validate(email: string): Promise<boolean> {
    const user = await this.usersService.findByEmail(email);
    return !user;
  }

  defaultMessage(args: ValidationArguments): string {
    return `Email "${args.value}" is already registered.`;
  }
}

export function IsAlreadyRegistered(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsAlreadyRegisteredConstraint,
    });
  };
}
