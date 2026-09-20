import { isLiveClosingMovement } from './movement-query.util';

describe('isLiveClosingMovement', () => {
  it('keeps manual movements without closingId', () => {
    expect(isLiveClosingMovement({ closingId: null, closing: null })).toBe(true);
    expect(isLiveClosingMovement({ closingId: undefined, closing: undefined })).toBe(true);
  });

  it('keeps movements of a live closing', () => {
    expect(isLiveClosingMovement({ closingId: 'c1', closing: { id: 'c1' } })).toBe(true);
  });

  it('drops movements whose closing was deleted (relation not loaded)', () => {
    expect(isLiveClosingMovement({ closingId: 'c1', closing: null })).toBe(false);
  });
});
