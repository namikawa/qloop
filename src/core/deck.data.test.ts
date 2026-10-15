import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDeckFromCsv, DECK_DEFINITIONS } from './decks';
import { generateYearChoices, isYearChoiceEligible, isYearInputEligible } from './quiz';
import { ENGLISH_PATTERNS, VOCABULARY_PATTERNS } from './models';
import { buildQuestion, isEligibleFor } from './vocabulary';
import {
  buildQuestion as buildEnglishQuestion,
  choiceDisplay,
  distractorCandidates as englishCandidates,
} from './english';
import { mulberry32 } from './random';

/** data/ にある実際の CSV が検証を通ること（データを編集した PR をこのテストで守る）。教材の定義の一覧から読む。 */
for (const definition of DECK_DEFINITIONS) {
  describe(`data/decks/${definition.dir}（${definition.name}）`, () => {
    const dir = new URL(`../../data/decks/${definition.dir}/`, import.meta.url);
    const result = buildDeckFromCsv(definition, {
      core: readFileSync(new URL('core.csv', dir), 'utf8'),
      ...(definition.hasPool !== false
        ? { pool: readFileSync(new URL('pool.csv', dir), 'utf8') }
        : {}),
    });

    it('教材の CSV が検証を通る', () => {
      expect(result.ok ? [] : result.errors).toEqual([]);
    });

    it('教材の定義の id・種類・名前で作られる', () => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.deck).toMatchObject({
        id: definition.id,
        kind: definition.kind,
        name: definition.name,
      });
    });

    it('基本データ（core.csv）の項目がある（追加データの pool.csv は空でもよい）', () => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const roles = result.deck.items.map((item) => item.role);
      expect(roles).toContain('core');
    });

    if (definition.kind === 'timeline') {
      it('年号入力に適格な全出来事で、今年を 2026 として年号 4 択の選択肢を作れる', () => {
        expect(result.ok).toBe(true);
        if (!result.ok || result.deck.kind !== 'timeline') return;
        const targets = result.deck.items.filter(isYearInputEligible);
        expect(targets.length).toBeGreaterThan(0);
        const rng = mulberry32(2026);
        const problems: string[] = [];
        for (const event of targets) {
          expect(isYearChoiceEligible(event)).toBe(true);
          // 乱数によって選ぶ k が変わるので、何度か作る
          for (let i = 0; i < 20; i++) {
            const years = generateYearChoices(event, 2026, rng);
            const distractors = years.filter((year) => year !== event.year);
            const valid =
              years.length === 4 &&
              new Set(years).size === 4 &&
              years.every((year, j) => j === 0 || years[j - 1] < year) &&
              years.includes(event.year) &&
              distractors.every(
                (year) =>
                  Math.abs(year - event.year) <= 10 &&
                  year > 0 &&
                  year <= 2026 &&
                  !event.altYears.includes(year),
              );
            if (!valid) {
              problems.push(`${event.id} ${event.title}: ${years.join(', ')}`);
            }
          }
        }
        expect(problems).toEqual([]);
      });
    }
    if (definition.kind === 'vocabulary') {
      it('基本データの全行と適格な追加データで、両パターンの正解と除外規則を守る 4 択を作れる', () => {
        expect(result.ok).toBe(true);
        if (!result.ok || result.deck.kind !== 'vocabulary') return;
        const { items } = result.deck;
        for (const word of items) {
          for (const pattern of VOCABULARY_PATTERNS) {
            const eligible = isEligibleFor(word, pattern, items);
            if (word.role === 'core') expect(eligible, word.id).toBe(true);
            if (!eligible) continue;
            for (let seed = 0; seed < 20; seed++) {
              const question = buildQuestion(word, pattern, items, 2026, mulberry32(seed));
              expect(question.choices, word.id).toHaveLength(4);
              expect(new Set(question.choices.map((choice) => choice.id)).size).toBe(4);
              expect(question.choices).toContain(word);
              for (const choice of question.choices.filter((choice) => choice.id !== word.id)) {
                expect(choice.category).toBe(word.category);
                expect(word.similar).not.toContain(choice.id);
                expect(choice.similar).not.toContain(word.id);
              }
            }
          }
        }
      });
    }
    if (definition.kind === 'english') {
      it('否定文の意味も同じ答えとして扱い、意味と英単語の誤答から除く', () => {
        expect(result.ok ? [] : result.errors).toEqual([]);
        if (!result.ok || result.deck.kind !== 'english') return;
        const { items } = result.deck;
        const meaningsFor = (id: string) =>
          englishCandidates(
            items.find((item) => item.id === id)!,
            'englishMeaningChoice',
            items,
          ).flatMap((group) => group.map((candidate) => candidate.meaning));
        const wordsFor = (id: string) =>
          englishCandidates(
            items.find((item) => item.id === id)!,
            'englishWordChoice',
            items,
          ).flatMap((group) => group.map((candidate) => candidate.word));
        expect(meaningsFor('en-0040')).not.toContain('誰も…ない');
        expect(meaningsFor('en-0038')).not.toContain('何も…ない');
        for (const id of ['en-0041', 'en-0042']) {
          expect(wordsFor(id)).not.toContain('anybody');
        }
        expect(wordsFor('en-0035')).not.toContain('anything');
      });
      it.each([
        ['en-0119', 'en-0149'],
        ['en-0126', 'en-0127'],
        ['en-0150', 'en-0159'],
        ['en-0180', 'en-0181'],
      ])('%s と %s は互いの意味と英単語の誤答から除く', (leftId, rightId) => {
        expect(result.ok ? [] : result.errors).toEqual([]);
        if (!result.ok || result.deck.kind !== 'english') return;
        const { items } = result.deck;
        const left = items.find((item) => item.id === leftId)!;
        const right = items.find((item) => item.id === rightId)!;
        for (const [item, other] of [
          [left, right],
          [right, left],
        ]) {
          const meanings = englishCandidates(item, 'englishMeaningChoice', items).flatMap((group) =>
            group.map((candidate) => candidate.meaning),
          );
          const words = englishCandidates(item, 'englishWordChoice', items).flatMap((group) =>
            group.map((candidate) => candidate.word),
          );
          expect(meanings, item.id).not.toContain(other.meaning);
          expect(words, item.id).not.toContain(other.word);
        }
      });
      it('全行の意味に全角の数字を含まない', () => {
        expect(result.ok ? [] : result.errors).toEqual([]);
        if (!result.ok || result.deck.kind !== 'english') return;
        for (const item of result.deck.items) {
          expect(item.meaning, item.id).not.toMatch(/[０-９]/);
        }
      });
      it('全行で両パターンの選択肢を作れ、表示が重複せず、誤答の除外規則を守る', () => {
        expect(result.ok ? [] : result.errors).toEqual([]);
        if (!result.ok || result.deck.kind !== 'english') return;
        const { items } = result.deck;
        expect(items).toHaveLength(181);
        expect(items.map((item) => item.id)).toEqual(
          Array.from({ length: 181 }, (_, i) => `en-${String(i + 1).padStart(4, '0')}`),
        );
        expect(
          items.every(
            (item, index) =>
              item.book === 'STAGE2' &&
              item.lesson === (index < 84 ? 4 : 5) &&
              item.role === 'core' &&
              item.level === '中学',
          ),
        ).toBe(true);
        for (const item of items) {
          for (const pattern of ENGLISH_PATTERNS) {
            const allowed = new Set(
              englishCandidates(item, pattern, items).flatMap((group) =>
                group.map((candidate) => candidate.id),
              ),
            );
            for (let seed = 0; seed < 20; seed++) {
              const question = buildEnglishQuestion(item, pattern, items, 2026, mulberry32(seed));
              expect(question.choices, item.id).toHaveLength(4);
              expect(question.choices).toContain(item);
              expect(
                new Set(question.choices.map((choice) => choiceDisplay(choice, pattern))).size,
                item.id,
              ).toBe(4);
              expect(
                question.choices
                  .filter((choice) => choice !== item)
                  .every((choice) => allowed.has(choice.id)),
              ).toBe(true);
            }
          }
        }
      });
    }
  });
}
