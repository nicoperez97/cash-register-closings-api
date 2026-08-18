import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { ShopsModule } from './modules/shops/shops.module';
import { ClosingsModule } from './modules/closings/closings.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UsersModule } from './modules/users/users.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { ConceptsModule } from './modules/concepts/concepts.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { CandidatesModule } from './modules/candidates/candidates.module';
import { MovementsModule } from './modules/movements/movements.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ProductionAttendanceModule } from './modules/production-attendance/production-attendance.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { CommissionsModule } from './modules/commissions/commissions.module';
import { SalesReportsModule } from './modules/sales-reports/sales-reports.module';
import { SalesSystemsModule } from './modules/sales-systems/sales-systems.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { ServicesModule } from './modules/services/services.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StockModule } from './modules/stock/stock.module';
import { ShortagesModule } from './modules/shortages/shortages.module';
import { TipsModule } from './modules/tips/tips.module';
import { ReimbursementsModule } from './modules/reimbursements/reimbursements.module';
import { SalonFloorModule } from './modules/salon-floor/salon-floor.module';
import { MenuModule } from './modules/menu/menu.module';
import { AiModule } from './modules/ai/ai.module';
import { JwtAuthGuard, PermissionsGuard } from './common/guards';
import { PublicAbuseGuard } from './common/public-abuse.guard';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AiModule,
    AuthModule,
    ShopsModule,
    ClosingsModule,
    ReportsModule,
    UsersModule,
    AccountsModule,
    ConceptsModule,
    EmployeesModule,
    CandidatesModule,
    MovementsModule,
    AttendanceModule,
    ProductionAttendanceModule,
    PayrollModule,
    CommissionsModule,
    SalesSystemsModule,
    SalesReportsModule,
    ReservationsModule,
    NotificationsModule,
    PaymentsModule,
    SuppliersModule,
    ServicesModule,
    StockModule,
    ShortagesModule,
    TipsModule,
    ReimbursementsModule,
    SalonFloorModule,
    MenuModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: PublicAbuseGuard },
  ],
})
export class AppModule {}
