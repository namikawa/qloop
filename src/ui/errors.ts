/** 例外を画面に表示する文字列にする。メッセージが空なら例外名を使う。 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message !== '' ? error.message : error.name;
  }
  return String(error);
}
