import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductionAttendanceDay } from '../../entities/production-attendance-day.entity';
import { Employee } from '../../entities/employee.entity';
import { Shop } from '../../entities/shop.entity';
import { User } from '../../entities/user.entity';
import { UserShop } from '../../entities/user-shop.entity';
import { ShopsModule } from '../shops/shops.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProductionAttendanceController } from './production-attendance.controller';
import { ProductionAttendanceService } from './production-attendance.service';
import { ProductionAttendanceExcelImportService } from './production-attendance-excel-import.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductionAttendanceDay, Employee, Shop, User, UserShop]),
    ShopsModule,
    NotificationsModule,
  ],
  controllers: [ProductionAttendanceController],
  providers: [ProductionAttendanceService, ProductionAttendanceExcelImportService],
  exports: [ProductionAttendanceService],
})
export class ProductionAttendanceModule {}
