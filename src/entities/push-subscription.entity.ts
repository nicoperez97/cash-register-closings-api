import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

@Entity({ name: 'push_subscriptions' })
@Index(['userId'])
@Index(['endpoint'], { unique: true })
export class PushSubscription extends BaseEntity {
  @Column()
  userId: string;

  @Column({ type: 'varchar', length: 512 })
  endpoint: string;

  @Column({ type: 'varchar', length: 255 })
  p256dh: string;

  @Column({ type: 'varchar', length: 255 })
  auth: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent?: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
