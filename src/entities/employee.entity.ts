import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { User } from './user.entity';

/** Fijo: entra en “Todos presentes”. Rotativo: solo se marca a mano. */
export enum EmployeeType {
  FIXED = 'FIXED',
  ROTATING = 'ROTATING',
}

@Entity({ name: 'employees' })
export class Employee extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  fullName: string;

  /** Precio por hora (no mensual ni diario). */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  baseSalary: string;

  /**
   * Multiplicador de feriado en liquidación.
   * null = hereda `shop.holidayPayMultiplier`.
   */
  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  holidayPayMultiplier?: string | null;

  @Column({ type: 'varchar', nullable: true })
  userId?: string | null;

  @Column({ type: 'date', nullable: true })
  hireDate?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ type: 'enum', enum: EmployeeType, default: EmployeeType.FIXED })
  type: EmployeeType;

  /**
   * Tipo por turno de caja: en qué turnos trabaja y si es fijo/rotativo en cada uno.
   * Vacío/null = legacy (aplica `type` a todos los turnos).
   */
  @Column({ type: 'simple-json', nullable: true })
  shiftAssignments?: Array<{ shiftId: string; type: EmployeeType }> | null;

  /** Si cuenta para el bonus de presentismo semanal en liquidación. */
  @Column({ type: 'tinyint', default: 1 })
  countsForAttendanceBonus: boolean;

  /** Si produce comida → aparece en asistencia de producción. */
  @Column({ type: 'tinyint', default: 0 })
  producesFood: boolean;

  /**
   * Productor supervisor a cargo de este empleado (mismo local, producesFood).
   * El supervisor puede cargar las horas de producción de quienes tiene a cargo.
   */
  @Column({ type: 'varchar', nullable: true })
  supervisorEmployeeId?: string | null;

  /** Alias o CBU para reintegros / transferencias. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  bankAlias?: string | null;

  /**
   * Precio por hora extra.
   * Si es 0, la liquidación usa el mismo precio hora base.
   */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  overtimeHourRate: string;

  /** Hora de entrada de servicio de este empleado (HH:mm). Vacío = hereda turno. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  serviceCheckIn?: string | null;

  /** Hora de retirada de servicio de este empleado (HH:mm). Vacío = hereda turno. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  serviceCheckOut?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user?: User | null;

  @ManyToOne(() => Employee, { nullable: true })
  @JoinColumn({ name: 'supervisorEmployeeId' })
  supervisor?: Employee | null;
}
