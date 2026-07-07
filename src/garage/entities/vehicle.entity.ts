import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 32 })
  vin: string;

  @Column({ length: 100, nullable: true, default: null })
  make: string | null;

  @Column({ length: 100, nullable: true, default: null })
  model: string | null;

  @Column({ type: 'int', nullable: true, default: null })
  year: number | null;

  @Column({ length: 120, nullable: true, default: null })
  trim: string | null;

  @Column({ default: false })
  main: boolean;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
