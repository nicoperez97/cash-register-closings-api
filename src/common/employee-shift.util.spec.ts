import { EmployeeType } from '../entities/employee.entity';
import {
  normalizeShiftAssignments,
  shiftServiceSchedule,
  weekdayOf,
} from './employee-shift.util';

describe('employee-shift.util (horario por turno y por día)', () => {
  const SHIFT = 's1';
  const fallback = { checkIn: '10:00', checkOut: '10:00' };

  describe('weekdayOf', () => {
    it('devuelve el día de semana (0=Dom..6=Sáb)', () => {
      expect(weekdayOf('2026-09-26')).toBe(6); // sábado
      expect(weekdayOf('2026-09-25')).toBe(5); // viernes
    });
    it('null para fechas inválidas', () => {
      expect(weekdayOf('')).toBeNull();
      expect(weekdayOf('no-fecha')).toBeNull();
      expect(weekdayOf(undefined)).toBeNull();
    });
  });

  describe('normalizeShiftAssignments', () => {
    it('sanitiza days: descarta días vacíos y horas mal formadas', () => {
      const out = normalizeShiftAssignments([
        {
          shiftId: SHIFT,
          type: 'FIXED',
          serviceCheckIn: '18:00',
          serviceCheckOut: '00:00',
          days: {
            '6': { serviceCheckIn: '20:00', serviceCheckOut: '02:00' },
            '3': { serviceCheckIn: '', serviceCheckOut: '' },
            '2': { serviceCheckIn: '25:99', serviceCheckOut: 'xx' },
          },
        },
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].days).toEqual({
        '6': { serviceCheckIn: '20:00', serviceCheckOut: '02:00' },
      });
    });

    it('descarta asignaciones sin shiftId y deduplica', () => {
      const out = normalizeShiftAssignments([
        { shiftId: '', type: 'FIXED' },
        { shiftId: SHIFT, type: 'FIXED' },
        { shiftId: SHIFT, type: 'ROTATING' },
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].shiftId).toBe(SHIFT);
    });
  });

  describe('shiftServiceSchedule (prioridad día → turno → empleado → fallback)', () => {
    const emp = {
      serviceCheckIn: '17:00',
      serviceCheckOut: '23:00',
      shiftAssignments: [
        {
          shiftId: SHIFT,
          type: EmployeeType.FIXED,
          serviceCheckIn: '18:00',
          serviceCheckOut: '00:00',
          days: { '6': { serviceCheckIn: '20:00', serviceCheckOut: '02:00' } },
        },
      ],
    };

    it('usa el override del día cuando corresponde (sábado)', () => {
      expect(shiftServiceSchedule(emp, SHIFT, fallback, 6)).toEqual({
        checkIn: '20:00',
        checkOut: '02:00',
      });
    });

    it('usa el horario del turno cuando el día no tiene override', () => {
      expect(shiftServiceSchedule(emp, SHIFT, fallback, 5)).toEqual({
        checkIn: '18:00',
        checkOut: '00:00',
      });
    });

    it('sin weekday usa el horario del turno', () => {
      expect(shiftServiceSchedule(emp, SHIFT, fallback, null)).toEqual({
        checkIn: '18:00',
        checkOut: '00:00',
      });
    });

    it('sin horas de turno cae al horario del empleado', () => {
      const emp2 = {
        serviceCheckIn: '17:00',
        serviceCheckOut: '23:00',
        shiftAssignments: [{ shiftId: SHIFT, type: EmployeeType.FIXED }],
      };
      expect(shiftServiceSchedule(emp2, SHIFT, fallback, 6)).toEqual({
        checkIn: '17:00',
        checkOut: '23:00',
      });
    });

    it('sin nada usa el fallback del turno', () => {
      expect(shiftServiceSchedule({}, SHIFT, fallback, 6)).toEqual(fallback);
    });
  });
});
