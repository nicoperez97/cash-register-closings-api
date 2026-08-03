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
import { MovementsModule } from './modules/movements/movements.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { CommissionsModule } from './modules/commissions/commissions.module';
import { SalesReportsModule } from './modules/sales-reports/sales-reports.module';
import { SalesSystemsModule } from './modules/sales-systems/sales-systems.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { JwtAuthGuard, PermissionsGuard } from './common/guards';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    ShopsModule,
    ClosingsModule,
    ReportsModule,
    UsersModule,
    AccountsModule,
    ConceptsModule,
    EmployeesModule,
    MovementsModule,
    AttendanceModule,
    PayrollModule,
    CommissionsModule,
    SalesSystemsModule,
    SalesReportsModule,
    ReservationsModule,
    NotificationsModule,
    PaymentsModule,
    SuppliersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
