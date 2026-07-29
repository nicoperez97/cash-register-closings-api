import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceDay } from '../../entities/attendance-day.entity';
import { Employee } from '../../entities/employee.entity';
import { ShopsModule } from '../shops/shops.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceExcelImportService } from './attendance-excel-import.service';

@Module({
  imports: [TypeOrmModule.forFeature([AttendanceDay, Employee]), ShopsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceExcelImportService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
