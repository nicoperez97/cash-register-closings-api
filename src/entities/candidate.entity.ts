import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';

export enum CandidateStatus {
  NEW = 'new',
  REVIEWING = 'reviewing',
  HIRED = 'hired',
  REJECTED = 'rejected',
}

export type CandidateEducationItem = {
  institution?: string;
  degree?: string;
  period?: string;
};

export type CandidateExperienceItem = {
  company?: string;
  role?: string;
  period?: string;
  description?: string;
};

export type CandidateLanguageItem = {
  name?: string;
  level?: string;
};

@Entity({ name: 'candidates' })
export class Candidate extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ length: 120 })
  firstName: string;

  @Column({ length: 120 })
  lastName: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  email?: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  documentId?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  country?: string | null;

  @Column({ type: 'date', nullable: true })
  birthDate?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  nationality?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  linkedIn?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website?: string | null;

  @Column({ type: 'text', nullable: true })
  summary?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  education?: CandidateEducationItem[] | null;

  @Column({ type: 'simple-json', nullable: true })
  experience?: CandidateExperienceItem[] | null;

  @Column({ type: 'simple-json', nullable: true })
  skills?: string[] | null;

  @Column({ type: 'simple-json', nullable: true })
  languages?: CandidateLanguageItem[] | null;

  @Column({ type: 'longtext', nullable: true })
  rawText?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({
    type: 'enum',
    enum: CandidateStatus,
    default: CandidateStatus.NEW,
  })
  status: CandidateStatus;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;
}
