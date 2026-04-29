import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async create(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    roles?: UserRole[];
  }): Promise<User> {
    const user = this.usersRepository.create({
      ...data,
      roles: data.roles ?? [UserRole.USER],
    });
    return this.usersRepository.save(user);
  }

  async update(id: string, data: Partial<Pick<User, 'firstName' | 'lastName' | 'profileImage'>>): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found.');
    Object.assign(user, data);
    return this.usersRepository.save(user);
  }

  async delete(id: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found.');
    await this.usersRepository.remove(user);
  }
}
