import { coerceBooleanInput } from './boolean.util';

describe('coerceBooleanInput', () => {
  it('preserves empty for IsOptional', () => {
    expect(coerceBooleanInput(undefined)).toBeUndefined();
    expect(coerceBooleanInput(null)).toBeNull();
    expect(coerceBooleanInput('')).toBe('');
  });

  it('accepts real booleans', () => {
    expect(coerceBooleanInput(true)).toBe(true);
    expect(coerceBooleanInput(false)).toBe(false);
  });

  it('coerces MySQL tinyint and string flags', () => {
    expect(coerceBooleanInput(1)).toBe(true);
    expect(coerceBooleanInput(0)).toBe(false);
    expect(coerceBooleanInput('1')).toBe(true);
    expect(coerceBooleanInput('0')).toBe(false);
    expect(coerceBooleanInput('true')).toBe(true);
    expect(coerceBooleanInput('false')).toBe(false);
  });

  it('leaves garbage for IsBoolean to reject', () => {
    expect(coerceBooleanInput('yes')).toBe('yes');
    expect(coerceBooleanInput(2)).toBe(2);
  });
});
