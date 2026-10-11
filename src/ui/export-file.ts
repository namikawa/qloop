/**
 * 書き出したファイルを端末に保存する（設計書 5.6 節・9.4 節）。
 * ファイル共有に対応した `navigator.share` が使えればそれを使い、使えなければ Blob の URL を `<a download>` で開く。
 *
 * 書き出す内容の準備（IndexedDB の読み出し）と保存の操作は分ける。`navigator.share` は利用者の操作の直後でないと
 * 拒否される（Web Share API の仕様）ので、準備の非同期処理を挟まず、準備ができた後のボタンの操作で直接呼ぶ。
 */

export interface PreparedExport {
  file: File;
  fileName: string;
  /** `<a download>` に使う Blob の URL。使い終わったら `releaseExportFile` で解放する。 */
  url: string;
  /** ファイル共有（`navigator.share`）が使えるか。 */
  canShare: boolean;
}

/** 書き出す JSON をファイルにし、保存の手段を決める。 */
export function prepareExportFile(json: string, fileName: string): PreparedExport {
  const file = new File([json], fileName, { type: 'application/json' });
  return { file, fileName, url: URL.createObjectURL(file), canShare: canShareFile(file) };
}

/** `prepareExportFile` で作った Blob の URL を解放する。 */
export function releaseExportFile(prepared: PreparedExport): void {
  URL.revokeObjectURL(prepared.url);
}

function canShareFile(file: File): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * ファイル共有のシートを開く。ボタンを押した処理の中で直接呼ぶこと。
 * 利用者が取り消したら `cancelled` を返し、それ以外の失敗は例外を投げる（呼び出し側でダウンロードに切り替える）。
 */
export async function shareExportFile(prepared: PreparedExport): Promise<'shared' | 'cancelled'> {
  try {
    await navigator.share({ files: [prepared.file] });
    return 'shared';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'cancelled';
    }
    throw error;
  }
}
