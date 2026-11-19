/**
 * The DOM-free rule for the push to talk key. Shared UI owns this rule; the renderer owns
 * persistence and the device platform, and passes the key down through typed props.
 */
import type { AppTextKey } from "@openbot/i18n";

export type TalkKeyPlatform = "darwin" | "win32" | "linux";

/**
 * The keys that the user holds to talk. `code` is a `KeyboardEvent.code`, or null when the
 * modifiers alone are the chord.
 */
export interface TalkKey {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly code: string | null;
}

/** The character of a key code on the user's keyboard layout, where the browser knows it. */
export type KeyLayout = (code: string) => string | undefined;

/** The key, and what its label needs: the device with the keyboard, and its layout. */
export interface TalkKeyBinding {
  readonly key: TalkKey;
  readonly platform: TalkKeyPlatform;
  readonly layout?: KeyLayout | undefined;
}

interface TalkKeyEvent {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

type Modifier = "ctrl" | "alt" | "shift" | "meta";

const MODIFIERS: readonly Modifier[] = ["ctrl", "alt", "shift", "meta"];

const MODIFIER_CODES: Record<string, Modifier> = {
  ControlLeft: "ctrl",
  ControlRight: "ctrl",
  AltLeft: "alt",
  AltRight: "alt",
  ShiftLeft: "shift",
  ShiftRight: "shift",
  MetaLeft: "meta",
  MetaRight: "meta",
};

/** The key caps of a US layout. A layout map from the browser replaces them where it has the key. */
const PUNCTUATION: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  IntlBackslash: "§",
};

/**
 * Windows and Linux spell the modifiers, Ctrl first. macOS shows them as symbols in the order ⌃⌥⇧⌘,
 * which `talkKeyParts` gives as symbol parts.
 */
const MODIFIER_LABELS: Record<Exclude<TalkKeyPlatform, "darwin">, Record<Modifier, AppTextKey>> = {
  win32: {
    ctrl: "conversation.voice.key.ctrl",
    alt: "conversation.voice.key.alt",
    shift: "conversation.voice.key.shift",
    meta: "conversation.voice.key.metaWin",
  },
  linux: {
    ctrl: "conversation.voice.key.ctrl",
    alt: "conversation.voice.key.alt",
    shift: "conversation.voice.key.shift",
    meta: "conversation.voice.key.metaLinux",
  },
};

const ARIA_MODIFIERS: Record<Modifier, string> = { ctrl: "Control", alt: "Alt", shift: "Shift", meta: "Meta" };

/** Control and Option on a Mac; Control and the Windows key (Super on Linux) elsewhere. */
export function defaultTalkKey(platform: TalkKeyPlatform): TalkKey {
  return platform === "darwin"
    ? { ctrl: true, alt: true, shift: false, meta: false, code: null }
    : { ctrl: true, alt: false, shift: false, meta: true, code: null };
}

export function isModifierCode(code: string): boolean {
  return code in MODIFIER_CODES;
}

/** Letters, digits, function keys, punctuation, Space and Enter. Escape stops a recording, and Tab moves the focus. */
export function isTalkKeyCode(code: string): boolean {
  return (
    /^Key[A-Z]$/.test(code) ||
    /^Digit[0-9]$/.test(code) ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(code) ||
    code in PUNCTUATION ||
    code === "Space" ||
    code === "Enter"
  );
}

function modifierCount(key: TalkKey): number {
  return MODIFIERS.filter((modifier) => key[modifier]).length;
}

/** Modifiers alone need two of them, so that one modifier of a usual shortcut does not open the microphone. */
export function isValidTalkKey(key: TalkKey): boolean {
  return key.code === null ? modifierCount(key) >= 2 : isTalkKeyCode(key.code);
}

/** The saved value, or null when it is absent or not a valid key. */
export function parseTalkKey(value: string | null): TalkKey | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("code" in parsed)) return null;
  const code = parsed.code;
  if (code !== null && typeof code !== "string") return null;
  const key: TalkKey = {
    ctrl: "ctrl" in parsed && parsed.ctrl === true,
    alt: "alt" in parsed && parsed.alt === true,
    shift: "shift" in parsed && parsed.shift === true,
    meta: "meta" in parsed && parsed.meta === true,
    code,
  };
  return isValidTalkKey(key) ? key : null;
}

export function serializeTalkKey(key: TalkKey): string {
  return JSON.stringify({ ctrl: key.ctrl, alt: key.alt, shift: key.shift, meta: key.meta, code: key.code });
}

export function sameTalkKey(left: TalkKey, right: TalkKey): boolean {
  return (
    left.ctrl === right.ctrl &&
    left.alt === right.alt &&
    left.shift === right.shift &&
    left.meta === right.meta &&
    left.code === right.code
  );
}

/** The modifiers that the event holds, and its key when that key can be part of a chord. */
export function talkKeyOfEvent(event: TalkKeyEvent): TalkKey {
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    code: isModifierCode(event.code) ? null : event.code,
  };
}

/** The keydown completes the chord: exactly its modifiers, and its key when it has one. */
export function completesTalkKey(event: TalkKeyEvent, key: TalkKey): boolean {
  if (event.ctrlKey !== key.ctrl || event.altKey !== key.alt) return false;
  if (event.shiftKey !== key.shift || event.metaKey !== key.meta) return false;
  return key.code === null ? isModifierCode(event.code) : event.code === key.code;
}

/** The key is one of the chord, so its keydown repeats the hold and its keyup ends it. */
export function isTalkKeyPart(code: string, key: TalkKey): boolean {
  const modifier = MODIFIER_CODES[code];
  return modifier ? key[modifier] : code === key.code;
}

/** Plain keys and Shift with a key type text, so they talk only outside a text field. */
export function talkKeyTypes(key: TalkKey): boolean {
  return key.code !== null && !key.ctrl && !key.alt && !key.meta && !/^F\d+$/.test(key.code);
}

/** Space and Enter press a focused button, so a chord of only that key does not talk on one. */
export function talkKeyPresses(key: TalkKey): boolean {
  return (key.code === "Space" || key.code === "Enter") && !key.ctrl && !key.alt && !key.meta;
}

/** A key that macOS shows as a symbol: ⌃ ⌥ ⇧ ⌘ and ↩. */
export type TalkKeySymbol = Modifier | "enter";

/**
 * A part of the label: a catalog key, the cap of a key, which is the same in each language, or a macOS
 * symbol. A symbol is not text, because the font puts ⌃ above the middle of the line.
 */
export type TalkKeyPart = { readonly text: AppTextKey } | { readonly cap: string } | { readonly symbol: TalkKeySymbol };

/**
 * The label of the chord, one part for each key. A letter shows the cap of the user's layout, such as "A"
 * for `KeyQ` on a French keyboard.
 */
export function talkKeyParts({ key, platform, layout }: TalkKeyBinding): readonly TalkKeyPart[] {
  const parts: TalkKeyPart[] = MODIFIERS.filter((modifier) => key[modifier]).map((modifier) =>
    platform === "darwin" ? { symbol: modifier } : { text: MODIFIER_LABELS[platform][modifier] },
  );
  const code = key.code;
  if (code === null) return parts;
  if (code === "Space") parts.push({ text: "conversation.voice.spaceKey" });
  else if (code === "Enter")
    parts.push(platform === "darwin" ? { symbol: "enter" } : { text: "conversation.voice.key.enter" });
  else parts.push({ cap: upperCap(layout?.(code) ?? keyCap(code)) });
  return parts;
}

/** A key cap shows a capital letter, unless the capital is longer, as "ß" is. */
function upperCap(cap: string): string {
  const upper = cap.toUpperCase();
  return upper.length === cap.length ? upper : cap;
}

function keyCap(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return PUNCTUATION[code] ?? code;
}

/** The `aria-keyshortcuts` value of the chord. */
export function talkKeyAria(key: TalkKey): string {
  const names = MODIFIERS.filter((modifier) => key[modifier]).map((modifier) => ARIA_MODIFIERS[modifier]);
  if (key.code !== null) names.push(key.code === "Space" ? "Space" : key.code === "Enter" ? "Enter" : keyCap(key.code));
  return names.join("+");
}
