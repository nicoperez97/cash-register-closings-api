import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { Employee } from './employee.entity';
import { LedgerAccount } from './ledger-account.entity';

export enum VacationPersonType {
  EMPLOYEE = 'EMPLOYEE',
  PARTNER = 'PARTNER',
}

@Entity({ name: 'vacations' })
export class Vacation extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 16 })
  personType: VacationPersonType;

  @Column({ type: 'varchar', nullable: true })
  employeeId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  partnerAccountId?: string | null;

  @Column({ type: 'date' })
  fromDate: string;

  @Column({ type: 'date' })
  toDate: string;

  @Column({ type: 'int', default: 0 })
  businessDays: number;

  /** Sin goce de sueldo. */
  @Column({ type: 'tinyint', default: 1 })
  unpaid: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => Employee, { nullable: true })
  @JoinColumn({ name: 'employeeId' })
  employee?: Employee | null;

  @ManyToOne(() => LedgerAccount, { nullable: true })
  @JoinColumn({ name: 'partnerAccountId' })
  partnerAccount?: LedgerAccount | null;
}
