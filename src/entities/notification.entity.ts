import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Shop } from './shop.entity';
import { NotificationType } from '../common/enums';

@Entity({ name: 'notifications' })
export class AppNotification extends BaseEntity {
  @Column()
  userId: string;

  @Column({ type: 'varchar', nullable: true })
  shopId?: string | null;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  body: string;

  @Column({ type: 'varchar', nullable: true })
  paymentId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  closingId?: string | null;

  @Column({ type: 'tinyint', default: 0 })
  isRead: boolean;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  readAt?: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => Shop, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shopId' })
  shop?: Shop | null;
}
