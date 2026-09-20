import { closingDateKey, closingEventDateKey, isClosingEventKey } from './soft-delete.util';

describe('closing unique keys', () => {
  it('keeps the regular day/shift key', () => {
    expect(closingDateKey('2026-09-20', 'shift-1')).toBe('2026-09-20__shift-1');
  });

  it('builds an event key that does not collide with the shift slot', () => {
    const key = closingEventDateKey('2026-09-20', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(key).toBe('2026-09-20__EVENT__aaaaaaaabbbbccccddddeeeeeeeeeeee');
    expect(key).not.toBe(closingDateKey('2026-09-20', 'shift-1'));
    expect(isClosingEventKey(key)).toBe(true);
    expect(isClosingEventKey(closingDateKey('2026-09-20', 'shift-1'))).toBe(false);
  });
});
