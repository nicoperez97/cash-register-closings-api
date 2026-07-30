import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Shop } from './shop.entity';
import { Employee } from './employee.entity';

/**
 * Regla de comisión por rubro (ej. COMIDA 1%, PIZZA 2.5%).
 * El rubro debe coincidir con `pos_products.category` / líneas POS.
 */
@Entity({ name: 'employee_commission_rules' })
@Unique(['shopId', 'employeeId', 'category'])
@Index(['shopId', 'employeeId'])
export class EmployeeCommissionRule extends BaseEntity {
  @Column()
  shopId: string;

  @Column()
  employeeId: string;

  /** Rubro / categoría de ventas (match case-insensitive con POS). */
  @Column({ length: 128 })
  category: string;

  /** Porcentaje de comisión (ej. 1.00 o 2.50). */
  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  ratePercent: string;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @ManyToOne(() => Shop)
  @JoinColumn({ name: 'shopId' })
  shop: Shop;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;
}
