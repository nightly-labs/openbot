/**
 * What to send when the keyboard field's text changes from `before` to `after`: a Backspace for each
 * removed character, then the new text. The phone's keyboard can replace a word, so the change is
 * not always one new character.
 */
export function typedChange(before: string, after: string): { backspaces: number; text: string } {
  const old = Array.from(before);
  const next = Array.from(after);
  let common = 0;
  while (common < old.length && common < next.length && old[common] === next[common]) common += 1;
  return { backspaces: old.length - common, text: next.slice(common).join("") };
}
