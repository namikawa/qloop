/**
 * 教材データ用の CSV パーサ（設計書 5.1 節末尾の形式）。
 *
 * - UTF-8 の文字列を受け取る。先頭の BOM は無視する。
 * - 改行は LF と CRLF のどちらでもよい。
 * - 1 行目は指定したヘッダー（列名と順序が一致すること）。
 * - セル内のカンマと `"` は `"..."` で囲み、`"` は `""` と書く。
 * - セル内の改行は使えない（検出したらエラー）。物理的な 1 行が 1 レコードになる。
 * - 空の行は読み飛ばす。
 *
 * エラーは止まらずに全行分を集めて返す。`rows` には正しく読めた行だけが入る。
 */

interface CsvRow {
  /** ファイル内の行番号（1 始まり。ヘッダーが 1 行目）。 */
  line: number;
  cells: string[];
}

interface CsvError {
  line: number;
  message: string;
}

export interface CsvParseResult {
  rows: CsvRow[];
  errors: CsvError[];
}

const BOM = '﻿';

export function parseCsv(text: string, header: readonly string[]): CsvParseResult {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const lines = body.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

  const headerResult = parseLine(lines[0]);
  if (!('cells' in headerResult) || !sameCells(headerResult.cells, header)) {
    return {
      rows: [],
      errors: [{ line: 1, message: `ヘッダー行が「${header.join(',')}」になっていません` }],
    };
  }

  const rows: CsvRow[] = [];
  const errors: CsvError[] = [];
  for (let index = 1; index < lines.length; index++) {
    const line = index + 1;
    const source = lines[index];
    if (source === '') {
      continue;
    }
    const result = parseLine(source);
    if ('error' in result) {
      errors.push({ line, message: result.error });
      continue;
    }
    if (result.cells.length !== header.length) {
      errors.push({
        line,
        message: `列の数が ${result.cells.length} です（${header.length} 列必要です）`,
      });
      continue;
    }
    rows.push({ line, cells: result.cells });
  }
  return { rows, errors };
}

function sameCells(cells: readonly string[], expected: readonly string[]): boolean {
  return cells.length === expected.length && cells.every((cell, i) => cell === expected[i]);
}

type LineResult = { cells: string[] } | { error: string };

/** 物理的な 1 行を 1 レコードとして読む。 */
function parseLine(line: string): LineResult {
  if (line.includes('\r')) {
    return { error: 'セル内の改行は使えません' };
  }
  const cells: string[] = [];
  let i = 0;
  for (;;) {
    if (line[i] === '"') {
      let value = '';
      i++;
      for (;;) {
        if (i >= line.length) {
          return { error: '引用符（"）が閉じていません（セル内の改行は使えません）' };
        }
        const ch = line[i];
        if (ch === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += ch;
        i++;
      }
      cells.push(value);
      if (i === line.length) {
        return { cells };
      }
      if (line[i] !== ',') {
        return { error: '閉じた引用符（"）の後にカンマ以外の文字があります' };
      }
      i++;
    } else {
      const end = line.indexOf(',', i);
      const value = end === -1 ? line.slice(i) : line.slice(i, end);
      if (value.includes('"')) {
        return { error: '" を含むセルは "..." で囲み、" を "" と書いてください' };
      }
      cells.push(value);
      if (end === -1) {
        return { cells };
      }
      i = end + 1;
    }
  }
}
