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

  async validate(email: string, args: ValidationArguments): Promise<boolean> {
    const existing = await this.usersService.findByEmail(email);
    if (!existing) return true;

    // If the DTO carries a currentUserId (set by the controller before validation),
    // allow the same user to keep or re-submit their own email
    const object = args.object as { currentUserId?: string };
    if (object.currentUserId && existing.id === object.currentUserId) return true;

    return false;
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