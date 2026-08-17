import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { Employee } from '../../entities/employee.entity';
import { ProductionAttendanceDay } from '../../entities/production-attendance-day.entity';
import { ShopsModule } from '../shops/shops.module';
import { AttendanceController, PublicAttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceExcelImportService } from './attendance-excel-import.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AttendanceDay, Employee, ProductionAttendanceDay]),
    ShopsModule,
  ],
  controllers: [AttendanceController, PublicAttendanceController],
  providers: [AttendanceService, AttendanceExcelImportService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
