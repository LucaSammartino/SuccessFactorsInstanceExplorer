/**
 * Lexicographic order on UTF-16 code units - identical on Linux, Windows, and macOS.
 * Prefer this over `String#localeCompare()` without a locale for hashes and golden files.
 */
export function compareUtf16(a: unknown, b: unknown): number {
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}
