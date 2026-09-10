import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Employee } from './employee.entity';
import { SalonTable } from './salon-table.entity';
import { Shop } from './shop.entity';

export enum TableSessionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

@Entity({ name: 'table_sessions' })
@Index('idx_table_sessions_shop_status', ['shopId', 'status'])
@Index('idx_table_sessions_table', ['salonTableId'])
export class TableSession extends BaseEntity {
  @Column()
  shopId: string;

  @Column({ type: 'varchar', length: 36 })
  salonTableId: string;

  /** Null cuando el cliente abre la mesa desde /pedir (sin mozo). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  waiterEmployeeId?: string | null;

  @Column({ type: 'varchar', length: 16, default: TableSessionStatus.OPEN })
  status: TableSessionStatus;

  /** Cantidad de comensales al abrir la mesa. */
  @Column({ type: 'int', default: 2 })
  covers: number;

  /** Si ya se imprimió al menos un ticket cliente en esta sesión. */
  @Column({ type: 'tinyint', default: 0 })
  customerTicketPrinted: boolean;

  @Column({ type: 'datetime', precision: 6, nullable: true })
  closedAt?: Date | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => SalonTable)
  @JoinColumn({ name: 'salonTableId' })
  salonTable: SalonTable;

  @ManyToOne(() => Employee, { nullable: true })
  @JoinColumn({ name: 'waiterEmployeeId' })
  waiter?: Employee | null;
}
