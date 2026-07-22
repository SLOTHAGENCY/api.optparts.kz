import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Одноразовый токен восстановления пароля.
 * В БД хранится только SHA-256 от сырого токена (`tokenHash`), сам токен
 * уходит пользователю в письме и на сервере не сохраняется.
 */
@Entity('password_resets')
export class PasswordReset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Index()
  @Column({ length: 64 })
  tokenHash: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true, default: null })
  usedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
