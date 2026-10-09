import {
  BROWSER_VIEW_MAX_CLIPBOARD_TEXT,
  type BrowserViewInput,
} from "@openbot/contracts/team-protocol/browser-view-v1";

// The phone keyboard as keystrokes on the host's page. A hidden text field takes the typing, and
// the screen sends what changed in it: each new character as a key press, each removed one as
// Backspace. A field that only gets the change does not have to know the key that made it, so
// autocorrect, dictation and swipe typing all arrive the same way.

type NamedKey = "Backspace" | "Enter" | "Tab";

/** The longest paste a phone sends to a page: the most that one paste carries to a host. */
const PASTE_MAX_LENGTH = BROWSER_VIEW_MAX_CLIPBOARD_TEXT;
/** The Meta key in the modifiers of a key input. */
const META_MODIFIER = 4;

function keyCode(character: string): string {
  if (/^[a-z]$/iu.test(character)) return `Key${character.toUpperCase()}`;
  if (/^[0-9]$/u.test(character)) return `Digit${character}`;
  if (character === " ") return "Space";
  return "";
}

/** A named key, down and up. The host adds the character of Enter itself. */
export function namedKeyInputs(key: NamedKey): BrowserViewInput[] {
  return [
    { type: "key", action: "down", key, code: key, text: "", modifiers: 0 },
    { type: "key", action: "up", key, code: key, text: "", modifiers: 0 },
  ];
}

/** Text as keystrokes: each character down, as a character, and up. A line break is Enter. */
export function typedTextInputs(text: string): BrowserViewInput[] {
  return Array.from(text).flatMap((character): BrowserViewInput[] => {
    if (character === "\n" || character === "\r") return namedKeyInputs("Enter");
    if (character === "\t") return namedKeyInputs("Tab");
    const code = keyCode(character);
    return [
      { type: "key", action: "down", key: character, code, text: "", modifiers: 0 },
      { type: "key", action: "char", key: character, code, text: character, modifiers: 0 },
      { type: "key", action: "up", key: character, code, text: "", modifiers: 0 },
    ];
  });
}

/** What the page receives when the hidden field changes from `before` to `after`. */
export function textChangeInputs(before: string, after: string): BrowserViewInput[] {
  const old = Array.from(before);
  const next = Array.from(after);
  let common = 0;
  while (common < old.length && common < next.length && old[common] === next[common]) common += 1;
  const removed = old.length - common;
  return [
    ...Array.from({ length: removed }, () => namedKeyInputs("Backspace")).flat(),
    ...typedTextInputs(next.slice(common).join("")),
  ];
}

/** A paste the host accepts. A text that is too long loses its end, and no character is split in two. */
export function pasteInput(text: string): BrowserViewInput {
  let pasted = "";
  for (const character of Array.from(text.slice(0, PASTE_MAX_LENGTH + 1))) {
    if (pasted.length + character.length > PASTE_MAX_LENGTH) break;
    pasted += character;
  }
  return { type: "paste", text: pasted };
}

/** Cmd+A. A host reads it as Select All on any system, as it does for a member at a desktop. */
export function selectAllInputs(): BrowserViewInput[] {
  const key = { key: "a", code: "KeyA", text: "", modifiers: META_MODIFIER };
  return [
    { type: "key", action: "down", ...key },
    { type: "key", action: "up", ...key },
  ];
}
