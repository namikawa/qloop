import type { QuestionCount } from '../../core/models';

/** 問題数の選択肢（出題設定と復習で共通）。 */
export const COUNT_OPTIONS: { value: QuestionCount; label: string }[] = [
  { value: 10, label: '10 問' },
  { value: 20, label: '20 問' },
  { value: 'all', label: '全問' },
];
