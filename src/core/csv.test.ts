import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

const HEADER = ['a', 'b', 'c'] as const;

describe('parseCsv', () => {
  it('ヘッダーの後の行をセルの配列として読み、行番号を付ける', () => {
    const result = parseCsv('a,b,c\n1,2,3\n4,,6\n', HEADER);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, cells: ['1', '2', '3'] },
      { line: 3, cells: ['4', '', '6'] },
    ]);
  });

  it('"..." で囲んだセルはカンマを含められ、"" は " になる', () => {
    const result = parseCsv('a,b,c\n"x,y","say ""hi""",""\n', HEADER);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].cells).toEqual(['x,y', 'say "hi"', '']);
  });

  it('末尾のセルが空でも列として数える', () => {
    const result = parseCsv('a,b,c\n1,2,\n', HEADER);
    expect(result.rows[0].cells).toEqual(['1', '2', '']);
  });

  it('先頭の BOM を無視する', () => {
    const result = parseCsv('﻿a,b,c\n1,2,3\n', HEADER);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].cells).toEqual(['1', '2', '3']);
  });

  it('CRLF の改行を読める', () => {
    const result = parseCsv('a,b,c\r\n1,2,3\r\n"4","5","6"\r\n', HEADER);
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.cells)).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('最後の行に改行が無くても読める', () => {
    const result = parseCsv('a,b,c\n1,2,3', HEADER);
    expect(result.rows).toEqual([{ line: 2, cells: ['1', '2', '3'] }]);
  });

  it('空の行は読み飛ばし、行番号はファイル上の位置のまま', () => {
    const result = parseCsv('a,b,c\n\n1,2,3\n\n', HEADER);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{ line: 3, cells: ['1', '2', '3'] }]);
  });

  it('セル内の改行はその行のエラーにする', () => {
    const result = parseCsv('a,b,c\n1,"x\ny",3\n4,5,6\n', HEADER);
    expect(result.errors[0]).toEqual({ line: 2, message: expect.stringContaining('改行') });
    expect(result.rows).toContainEqual({ line: 4, cells: ['4', '5', '6'] });
  });

  it('CRLF のファイルでもセル内の改行をエラーにする', () => {
    const result = parseCsv('a,b,c\r\n1,"x\r\ny",3\r\n', HEADER);
    expect(result.errors[0]).toEqual({ line: 2, message: expect.stringContaining('改行') });
  });

  it('CR だけの改行はセル内の改行としてエラーにする', () => {
    const result = parseCsv('a,b,c\n1,x\ry,3\n', HEADER);
    expect(result.errors).toEqual([{ line: 2, message: expect.stringContaining('改行') }]);
  });

  it('ヘッダー行が無ければ 1 行目のエラーにし、行を返さない', () => {
    const result = parseCsv('1,2,3\n4,5,6\n', HEADER);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, message: expect.stringContaining('ヘッダー') }]);
  });

  it('ヘッダーの列の順序が違えばエラーにする', () => {
    const result = parseCsv('a,c,b\n1,2,3\n', HEADER);
    expect(result.errors).toEqual([{ line: 1, message: expect.stringContaining('ヘッダー') }]);
  });

  it('空のファイルはヘッダーが無いエラーにする', () => {
    const result = parseCsv('', HEADER);
    expect(result.errors).toEqual([{ line: 1, message: expect.stringContaining('ヘッダー') }]);
  });

  it('列の数が違う行をエラーにし、他の行は読み続ける', () => {
    const result = parseCsv('a,b,c\n1,2\n1,2,3,4\n5,6,7\n', HEADER);
    expect(result.errors).toEqual([
      { line: 2, message: expect.stringContaining('列の数が 2') },
      { line: 3, message: expect.stringContaining('列の数が 4') },
    ]);
    expect(result.rows).toEqual([{ line: 4, cells: ['5', '6', '7'] }]);
  });

  it('囲んでいないセルの " と、閉じた引用符の後の文字をエラーにする', () => {
    const result = parseCsv('a,b,c\n1,x"y,3\n1,"x"y,3\n', HEADER);
    expect(result.errors.map((error) => error.line)).toEqual([2, 3]);
    expect(result.rows).toEqual([]);
  });
});
