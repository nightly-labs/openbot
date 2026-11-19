import type { AppTextKey } from "@openbot/i18n";

export type TalkKeyPlatform = "darwin" | "win32" | "linux";

export interface TalkKey {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly code: string | null;
}

export type KeyLayout = (code: string) => string | undefined;

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

export function defaultTalkKey(platform: TalkKeyPlatform): TalkKey {
  return platform === "darwin"
    ? { ctrl: true, alt: true, shift: false, meta: false, code: null }
    : { ctrl: true, alt: false, shift: false, meta: true, code: null };
}

export function isModifierCode(code: string): boolean {
  return code in MODIFIER_CODES;
}

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

export function isValidTalkKey(key: TalkKey): boolean {
  return key.code === null ? modifierCount(key) >= 2 : isTalkKeyCode(key.code);
}

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

export function talkKeyOfEvent(event: TalkKeyEvent): TalkKey {
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    code: isModifierCode(event.code) ? null : event.code,
  };
}

export function completesTalkKey(event: TalkKeyEvent, key: TalkKey): boolean {
  if (event.ctrlKey !== key.ctrl || event.altKey !== key.alt) return false;
  if (event.shiftKey !== key.shift || event.metaKey !== key.meta) return false;
  return key.code === null ? isModifierCode(event.code) : event.code === key.code;
}

export function isTalkKeyPart(code: string, key: TalkKey): boolean {
  const modifier = MODIFIER_CODES[code];
  return modifier ? key[modifier] : code === key.code;
}

export function talkKeyTypes(key: TalkKey): boolean {
  return key.code !== null && !key.ctrl && !key.alt && !key.meta && !/^F\d+$/.test(key.code);
}

export function talkKeyPresses(key: TalkKey): boolean {
  return (key.code === "Space" || key.code === "Enter") && !key.ctrl && !key.alt && !key.meta;
}

export type TalkKeySymbol = Modifier | "enter";

export type TalkKeyPart = { readonly text: AppTextKey } | { readonly cap: string } | { readonly symbol: TalkKeySymbol };

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

function upperCap(cap: string): string {
  const upper = cap.toUpperCase();
  return upper.length === cap.length ? upper : cap;
}

function keyCap(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return PUNCTUATION[code] ?? code;
}

export function talkKeyAria(key: TalkKey): string {
  const names = MODIFIERS.filter((modifier) => key[modifier]).map((modifier) => ARIA_MODIFIERS[modifier]);
  if (key.code !== null) names.push(key.code === "Space" ? "Space" : key.code === "Enter" ? "Enter" : keyCap(key.code));
  return names.join("+");
}
