import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export type PartnerSplitChannelLeave = {
  accountId: string;
  leaveAmount: number;
};

export type PartnerSplitExtra = {
  id: string;
  label: string;
  amount: number;
};

@Entity({ name: 'partner_split_configs' })
export class PartnerSplitConfig extends BaseEntity {
  @Index({ unique: true })
  @Column()
  shopId: string;

  @Column({ type: 'json', nullable: true })
  partnerAccountIds?: string[] | null;

  @Column({ type: 'json', nullable: true })
  channelLeaves?: PartnerSplitChannelLeave[] | null;

  @Column({ type: 'json', nullable: true })
  extras?: PartnerSplitExtra[] | null;
}
