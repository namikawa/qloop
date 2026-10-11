import { describe, expect, it } from 'vitest';
import { PATTERNS } from './models';

describe('PATTERNS', () => {
  it('年号入力・年号 4 択・出来事 4 択の順を保つ', () => {
    expect(PATTERNS).toEqual(['yearInput', 'yearChoice', 'choice']);
  });
});
