/** revision を含むキャッシュキーで、まだ取り込んでいないファイルだけを数える。 */
export function countUncachedFiles(
  cacheKeys: Iterable<string>,
  cachedURLs: ReadonlySet<string>,
): number {
  let total = 0;
  for (const key of cacheKeys) {
    if (!cachedURLs.has(key)) total += 1;
  }
  return total;
}
