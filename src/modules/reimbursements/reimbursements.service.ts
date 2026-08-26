import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createReadStream } from 'fs';
import { In, Repository } from 'typeorm';
import { Reimbursement } from '../../entities/reimbursement.entity';
import { Employee } from '../../entities/employee.entity';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { AuthUser } from '../../common/decorators';
import { GlobalRole, NotificationType, ReimbursementStatus } from '../../common/enums';
import { isEntityActive } from '../../common/active.util';
import { resolveUserPermissions } from '../../common/guards';
import {
  deleteUploadIfExists,
  resolveUploadPath,
  saveUploadFile,
} from '../../common/uploads';
import { ShopsService } from '../shops/shops.service';
import { NotificationsService } from '../notifications/notifications.service';

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function money(v: number): string {
  return v.toFixed(2);
}

function isIsoDate(v?: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

@Injectable()
export class ReimbursementsService implements OnModuleInit {
  constructor(
    @InjectRepository(Reimbursement)
    private readonly rows: Repository<Reimbursement>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(Shop)
    private readonly shopsRepo: Repository<Shop>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(UserShop)
    private readonly userShops: Repository<UserShop>,
    private readonly shops: ShopsService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    for (const sql of [
      `ALTER TABLE employees ADD COLUMN bankAlias VARCHAR(120) NULL`,
      `CREATE TABLE IF NOT EXISTS reimbursements (
        id CHAR(36) NOT NULL PRIMARY KEY,
        shopId CHAR(36) NOT NULL,
        employeeId CHAR(36) NOT NULL,
        createdByUserId CHAR(36) NULL,
        description VARCHAR(500) NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        expenseDate DATE NOT NULL,
        notes VARCHAR(500) NULL,
        bankAliasSnapshot VARCHAR(120) NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
        paidAt DATE NULL,
        paidByUserId CHAR(36) NULL,
        receiptFilePath VARCHAR(500) NULL,
        receiptFileName VARCHAR(255) NULL,
        receiptFileMime VARCHAR(120) NULL,
        createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updatedAt DATETIME(6) NULL,
        deletedAt DATETIME(6) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        KEY idx_reimb_shop (shopId),
        KEY idx_reimb_emp (employeeId),
        KEY idx_reimb_status (status),
        KEY idx_reimb_date (expenseDate)
      )`,
    ]) {
      try {
        await this.rows.query(sql);
      } catch {
        // ya existe
      }
    }
  }

  private perms(user: AuthUser, shopId: string) {
    return resolveUserPermissions(user, shopId);
  }

  private canManage(user: AuthUser, shopId: string) {
    return this.perms(user, shopId).includes('reimbursements.manage');
  }

  private canReadAll(user: AuthUser, shopId: string) {
    const p = this.perms(user, shopId);
    return p.includes('reimbursements.read') || p.includes('reimbursements.manage');
  }

  private canSelf(user: AuthUser, shopId: string) {
    return this.perms(user, shopId).includes('reimbursements.self');
  }

  private async resolveMyProducer(user: AuthUser, shopId: string): Promise<Employee> {
    const emp = await this.employees.findOne({
      where: { shopId, userId: user.id },
    });
    if (!emp || !isEntityActive(emp.active) || !emp.producesFood) {
      throw new NotFoundException(
        'No hay un productor activo vinculado a tu usuario en este local. Pedile a un admin que te asocie en Empleados (Produce comida + usuario).',
      );
    }
    return emp;
  }

  private toDto(row: Reimbursement) {
    return {
      id: row.id,
      shopId: row.shopId,
      employeeId: row.employeeId,
      employeeName: row.employee?.fullName ?? null,
      createdByUserId: row.createdByUserId ?? null,
      description: row.description,
      amount: n(row.amount),
      expenseDate: String(row.expenseDate).slice(0, 10),
      notes: row.notes ?? null,
      bankAliasSnapshot: row.bankAliasSnapshot ?? null,
      status: row.status,
      paidAt: row.paidAt ? String(row.paidAt).slice(0, 10) : null,
      paidByUserId: row.paidByUserId ?? null,
      paidByName: row.paidBy?.fullName ?? null,
      hasReceiptFile: !!row.receiptFilePath,
      receiptFileName: row.receiptFileName ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? null,
    };
  }

  async myProfile(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canSelf(user, shopId) && !this.canReadAll(user, shopId)) {
      throw new ForbiddenException('Sin permiso');
    }
    const emp = await this.resolveMyProducer(user, shopId);
    const pending = await this.rows.find({
      where: {
        shopId,
        employeeId: emp.id,
        status: ReimbursementStatus.PENDING,
        active: true,
      },
    });
    const pendingAmount = pending.reduce((s, r) => s + n(r.amount), 0);
    return {
      employeeId: emp.id,
      fullName: emp.fullName,
      bankAlias: emp.bankAlias?.trim() || null,
      pendingCount: pending.length,
      pendingAmount,
    };
  }

  async updateMyAlias(user: AuthUser, shopId: string, bankAlias: string | null) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canSelf(user, shopId)) {
      throw new ForbiddenException('Sin permiso para cargar tu alias');
    }
    const emp = await this.resolveMyProducer(user, shopId);
    emp.bankAlias = bankAlias?.trim() || null;
    await this.employees.save(emp);
    return this.myProfile(user, shopId);
  }

  async listMine(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canSelf(user, shopId)) {
      throw new ForbiddenException('Sin permiso');
    }
    const emp = await this.resolveMyProducer(user, shopId);
    const rows = await this.rows.find({
      where: { shopId, employeeId: emp.id, active: true },
      relations: ['employee', 'paidBy'],
      order: { expenseDate: 'DESC', createdAt: 'DESC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async createMine(
    user: AuthUser,
    shopId: string,
    dto: { description: string; amount: number; expenseDate: string; notes?: string | null },
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canSelf(user, shopId)) {
      throw new ForbiddenException('Sin permiso para cargar gastos');
    }
    const emp = await this.resolveMyProducer(user, shopId);
    const description = dto.description?.trim();
    if (!description) throw new BadRequestException('Indicá de qué es el gasto');
    if (!(n(dto.amount) > 0)) throw new BadRequestException('El importe tiene que ser mayor a 0');
    if (!isIsoDate(dto.expenseDate)) throw new BadRequestException('Fecha inválida');

    const row = await this.rows.save(
      this.rows.create({
        shopId,
        employeeId: emp.id,
        createdByUserId: user.id,
        description,
        amount: money(n(dto.amount)),
        expenseDate: dto.expenseDate,
        notes: dto.notes?.trim() || null,
        bankAliasSnapshot: emp.bankAlias?.trim() || null,
        status: ReimbursementStatus.PENDING,
        active: true,
      }),
    );
    await this.notifyAdminsCreated(user, shopId, emp, row);
    const saved = await this.load(shopId, row.id);
    return this.toDto(saved);
  }

  async updateMine(
    user: AuthUser,
    shopId: string,
    id: string,
    dto: { description?: string; amount?: number; expenseDate?: string; notes?: string | null },
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canSelf(user, shopId)) throw new ForbiddenException('Sin permiso');
    const emp = await this.resolveMyProducer(user, shopId);
    const row = await this.load(shopId, id);
    if (row.employeeId !== emp.id) throw new ForbiddenException('Ese gasto no es tuyo');
    if (row.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException('Solo se puede editar un gasto pendiente');
    }
    if (dto.description !== undefined) {
      const description = dto.description.trim();
      if (!description) throw new BadRequestException('Indicá de qué es el gasto');
      row.description = description;
    }
    if (dto.amount !== undefined) {
      if (!(n(dto.amount) > 0)) throw new BadRequestException('El importe tiene que ser mayor a 0');
      row.amount = money(n(dto.amount));
    }
    if (dto.expenseDate !== undefined) {
      if (!isIsoDate(dto.expenseDate)) throw new BadRequestException('Fecha inválida');
      row.expenseDate = dto.expenseDate;
    }
    if (dto.notes !== undefined) row.notes = dto.notes?.trim() || null;
    await this.rows.save(row);
    return this.toDto(await this.load(shopId, id));
  }

  async removeMine(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canSelf(user, shopId)) throw new ForbiddenException('Sin permiso');
    const emp = await this.resolveMyProducer(user, shopId);
    const row = await this.load(shopId, id);
    if (row.employeeId !== emp.id) throw new ForbiddenException('Ese gasto no es tuyo');
    if (row.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException('Solo se puede borrar un gasto pendiente');
    }
    row.active = false;
    await this.rows.save(row);
    return { ok: true };
  }

  async list(
    user: AuthUser,
    shopId: string,
    filters?: { status?: ReimbursementStatus | ''; employeeId?: string },
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canReadAll(user, shopId)) throw new ForbiddenException('Sin permiso');
    const where: Record<string, unknown> = { shopId, active: true };
    if (filters?.status) where.status = filters.status;
    if (filters?.employeeId) where.employeeId = filters.employeeId;
    const rows = await this.rows.find({
      where,
      relations: ['employee', 'paidBy'],
      order: { expenseDate: 'DESC', createdAt: 'DESC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async pendingCount(user: AuthUser, shopId: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canReadAll(user, shopId)) return { count: 0, amount: 0 };
    const rows = await this.rows.find({
      where: { shopId, status: ReimbursementStatus.PENDING, active: true },
    });
    return {
      count: rows.length,
      amount: rows.reduce((s, r) => s + n(r.amount), 0),
    };
  }

  async pay(user: AuthUser, shopId: string, id: string, paidAt?: string | null) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para marcar el reintegro como pagado');
    }
    const row = await this.load(shopId, id);
    if (row.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException('Solo se puede pagar un gasto pendiente');
    }
    const when = isIsoDate(paidAt) ? paidAt : new Date().toISOString().slice(0, 10);
    const claim = await this.rows
      .createQueryBuilder()
      .update(Reimbursement)
      .set({
        status: ReimbursementStatus.PAID,
        paidAt: when,
        paidByUserId: user.id,
      })
      .where('id = :id AND shopId = :shopId AND status = :st AND active = true', {
        id,
        shopId,
        st: ReimbursementStatus.PENDING,
      })
      .execute();
    if (!claim.affected) {
      throw new BadRequestException('El gasto ya fue pagado o cambió de estado');
    }
    return this.toDto(await this.load(shopId, id));
  }

  async cancel(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) throw new ForbiddenException('Sin permiso');
    const row = await this.load(shopId, id);
    if (row.status !== ReimbursementStatus.PENDING) {
      throw new BadRequestException('Solo se puede cancelar un gasto pendiente');
    }
    row.status = ReimbursementStatus.CANCELLED;
    await this.rows.save(row);
    return this.toDto(await this.load(shopId, id));
  }

  async uploadReceiptFile(
    user: AuthUser,
    shopId: string,
    id: string,
    file: Express.Multer.File,
  ) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canManage(user, shopId)) {
      throw new ForbiddenException('Sin permiso para cargar el comprobante');
    }
    const row = await this.load(shopId, id);
    if (row.status !== ReimbursementStatus.PAID) {
      throw new BadRequestException('Marcá el reintegro como pagado antes de adjuntar el comprobante');
    }
    if (!file?.buffer?.length) throw new BadRequestException('Archivo requerido');

    deleteUploadIfExists(row.receiptFilePath);
    const saved = saveUploadFile({
      relativeDir: `reimbursements/${shopId}/${id}`,
      basename: 'receipt',
      buffer: file.buffer,
      originalName: file.originalname,
      mime: file.mimetype,
    });

    await this.rows
      .createQueryBuilder()
      .update(Reimbursement)
      .set({
        receiptFilePath: saved.relativePath,
        receiptFileName: file.originalname || saved.fileName,
        receiptFileMime: file.mimetype || null,
      })
      .where('id = :id AND shopId = :shopId', { id, shopId })
      .execute();

    return this.toDto(await this.load(shopId, id));
  }

  async downloadReceiptFile(user: AuthUser, shopId: string, id: string) {
    this.shops.assertShopAccess(user, shopId);
    if (!this.canReadAll(user, shopId) && !this.canSelf(user, shopId)) {
      throw new ForbiddenException('Sin permiso');
    }
    const row = await this.load(shopId, id);
    if (this.canSelf(user, shopId) && !this.canReadAll(user, shopId)) {
      const emp = await this.resolveMyProducer(user, shopId);
      if (row.employeeId !== emp.id) throw new ForbiddenException('Ese gasto no es tuyo');
    }
    const abs = resolveUploadPath(row.receiptFilePath);
    if (!abs) throw new NotFoundException('Comprobante no encontrado');
    return {
      stream: new StreamableFile(createReadStream(abs)),
      fileName: row.receiptFileName || 'comprobante.pdf',
      mime: row.receiptFileMime || 'application/octet-stream',
    };
  }

  private async load(shopId: string, id: string) {
    const row = await this.rows.findOne({
      where: { id, shopId, active: true },
      relations: ['employee', 'paidBy'],
    });
    if (!row) throw new NotFoundException('Gasto no encontrado');
    return row;
  }

  private async notifyAdminsCreated(
    actor: AuthUser,
    shopId: string,
    employee: Employee,
    row: Reimbursement,
  ) {
    const shop = await this.shopsRepo.findOne({ where: { id: shopId } });
    const shopName = shop?.name?.trim() || 'Local';
    const links = await this.userShops.find({
      where: {
        shopId,
        shopRole: In([GlobalRole.OWNER, GlobalRole.ADMIN]),
      },
    });
    const recipientIds = new Set(links.map((l) => l.userId));
    const globalOwners = await this.users.find({
      where: { globalRole: GlobalRole.OWNER },
      select: ['id', 'active'],
    });
    for (const u of globalOwners) {
      if (isEntityActive(u.active)) recipientIds.add(u.id);
    }
    recipientIds.delete(actor.id);
    if (!recipientIds.size) return;

    const amount = n(row.amount).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    await this.notifications.createMany(
      [...recipientIds].map((userId) => ({
        userId,
        shopId,
        type: NotificationType.REIMBURSEMENT_CREATED,
        title: 'Gasto a reintegrar',
        body: `${shopName} · ${employee.fullName} cargó $${amount} (${row.description})`,
        targetId: row.id,
      })),
    );
  }
}
