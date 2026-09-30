import {
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_USER_ID,
  isDemoStaffUserId,
  isNonDeliverableStaffEmail,
  shouldNeverNotifyStaff,
} from './demo-user.util';

describe('demo-user.util', () => {
  it('identifica el id fijo del admin demo', () => {
    expect(isDemoStaffUserId(DEMO_ADMIN_USER_ID)).toBe(true);
    expect(isDemoStaffUserId('other')).toBe(false);
  });

  it('bloquea emails seed y dominios locales', () => {
    expect(isNonDeliverableStaffEmail('demo.admin@cierres.com')).toBe(true);
    expect(isNonDeliverableStaffEmail(DEMO_ADMIN_EMAIL)).toBe(true);
    expect(isNonDeliverableStaffEmail('foo@import.cierres.local')).toBe(true);
    expect(isNonDeliverableStaffEmail('nicolas@gmail.com')).toBe(false);
  });

  it('shouldNeverNotifyStaff por id o email', () => {
    expect(shouldNeverNotifyStaff({ userId: DEMO_ADMIN_USER_ID })).toBe(true);
    expect(shouldNeverNotifyStaff({ email: 'demo.admin@cierres.com' })).toBe(true);
    expect(
      shouldNeverNotifyStaff({ userId: 'x', email: 'ok@example.com' }),
    ).toBe(false);
  });
});
