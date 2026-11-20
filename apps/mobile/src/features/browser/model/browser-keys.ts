import {
  BROWSER_VIEW_MAX_CLIPBOARD_TEXT,
  type BrowserViewInput,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { graphemes } from "../../../shared/lib/graphemes";

type NamedKey = "Backspace" | "Enter" | "Tab";

const PASTE_MAX_LENGTH = BROWSER_VIEW_MAX_CLIPBOARD_TEXT;
const META_MODIFIER = 4;

function keyCode(character: string): string {
  if (/^[a-z]$/iu.test(character)) return `Key${character.toUpperCase()}`;
  if (/^[0-9]$/u.test(character)) return `Digit${character}`;
  if (character === " ") return "Space";
  return "";
}

export function namedKeyInputs(key: NamedKey): BrowserViewInput[] {
  return [
    { type: "key", action: "down", key, code: key, text: "", modifiers: 0 },
    { type: "key", action: "up", key, code: key, text: "", modifiers: 0 },
  ];
}

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

export function textChangeInputs(before: string, after: string): BrowserViewInput[] {
  const old = graphemes(before);
  const next = graphemes(after);
  let common = 0;
  while (common < old.length && common < next.length && old[common] === next[common]) common += 1;
  const removed = old.length - common;
  return [
    ...Array.from({ length: removed }, () => namedKeyInputs("Backspace")).flat(),
    ...typedTextInputs(next.slice(common).join("")),
  ];
}

export function pasteInput(text: string): BrowserViewInput {
  let pasted = "";
  for (const character of Array.from(text.slice(0, PASTE_MAX_LENGTH + 1))) {
    if (pasted.length + character.length > PASTE_MAX_LENGTH) break;
    pasted += character;
  }
  return { type: "paste", text: pasted };
}

export function selectAllInputs(): BrowserViewInput[] {
  const key = { key: "a", code: "KeyA", text: "", modifiers: META_MODIFIER };
  return [
    { type: "key", action: "down", ...key },
    { type: "key", action: "up", ...key },
  ];
}
