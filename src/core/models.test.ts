import { describe, expect, it } from 'vitest';
import { PATTERNS, TIMELINE_PATTERNS } from './models';

describe('PATTERNS', () => {
  it('年号入力・年号 4 択・出来事 4 択の順を保つ', () => {
    expect(TIMELINE_PATTERNS).toEqual(['yearInput', 'yearChoice', 'choice']);
  });
});

it('全種類のパターンに意味 4 択と言葉 4 択を含む', () => {
  expect(PATTERNS).toEqual(['yearInput', 'yearChoice', 'choice', 'meaningChoice', 'wordChoice']);
});
