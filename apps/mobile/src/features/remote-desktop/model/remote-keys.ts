export function typedChange(before: string, after: string): { backspaces: number; text: string } {
  const old = Array.from(before);
  const next = Array.from(after);
  let common = 0;
  while (common < old.length && common < next.length && old[common] === next[common]) common += 1;
  return { backspaces: old.length - common, text: next.slice(common).join("") };
}
