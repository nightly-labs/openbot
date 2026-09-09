/** Extract a large native text insertion without copying the surrounding draft into the file. */
export function largePastedText(before: string, after: string): { text: string; draft: string } | null {
  if (after.length <= 4_000) return null;
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let suffix = 0;
  while (suffix < before.length - start && before[before.length - suffix - 1] === after[after.length - suffix - 1])
    suffix++;
  const text = after.slice(start, after.length - suffix);
  if (text.length <= 4_000) return null;
  return {
    text,
    draft: after.slice(0, start) + after.slice(after.length - suffix),
  };
}
