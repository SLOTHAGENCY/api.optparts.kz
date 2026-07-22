import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { User } from '../users/entities/user.entity';
import { PasswordReset } from './entities/password-reset.entity';
import { JwtPayload } from './strategies/jwt.strategy';

export interface AuthResult {
  accessToken: string;
  user: User;
}

/** Сколько живёт ссылка восстановления пароля. */
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    @InjectRepository(PasswordReset)
    private readonly passwordResetRepository: Repository<PasswordReset>,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const user = await this.usersService.create(dto);
    return this.buildAuthResult(user);
  }

  async login(user: User): Promise<AuthResult> {
    return this.buildAuthResult(user);
  }

  /**
   * Запрос на восстановление пароля. Всегда завершается без ошибки —
   * вызывающий эндпоинт отдаёт одинаковый ответ независимо от того,
   * существует ли аккаунт (защита от перебора email).
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return;

    // Гасим прежние неиспользованные токены этого пользователя.
    await this.passwordResetRepository.delete({ userId: user.id, usedAt: IsNull() });

    const rawToken = randomBytes(32).toString('hex');
    const record = this.passwordResetRepository.create({
      userId: user.id,
      tokenHash: this.hashToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
    await this.passwordResetRepository.save(record);

    // Фронт на HashRouter — токен идёт после '#', иначе роутер его не увидит.
    const base = process.env.FRONTEND_RESET_URL || 'https://optparts.kz/#/reset-password';
    const resetUrl = `${base}?token=${rawToken}`;
    await this.mailService.sendPasswordResetEmail(user.email, resetUrl);
  }

  /**
   * Установка нового пароля по токену из письма.
   * Токен должен существовать, быть неиспользованным и не просроченным.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.passwordResetRepository.findOne({
      where: { tokenHash: this.hashToken(token) },
    });

    // Токен должен существовать, быть неиспользованным и не просроченным.
    // Проверяем в коде явно: literal `usedAt: null` в where TypeORM молча игнорирует.
    if (!record || record.usedAt !== null || record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Ссылка для сброса пароля недействительна или устарела.');
    }

    await this.usersService.changePassword(record.userId, newPassword);

    record.usedAt = new Date();
    await this.passwordResetRepository.save(record);
  }

  /** Периодическая чистка просроченных/использованных токенов. */
  async purgeExpiredResets(): Promise<void> {
    await this.passwordResetRepository.delete({ expiresAt: LessThan(new Date()) });
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private buildAuthResult(user: User): AuthResult {
    const payload: JwtPayload = { sub: user.id, email: user.email, roles: user.roles };
    return { accessToken: this.jwtService.sign(payload), user };
  }
}
