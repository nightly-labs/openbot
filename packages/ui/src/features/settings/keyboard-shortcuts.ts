import type { AppTextKey } from "@openbot/i18n";
import {
  isTalkKeyCode,
  type TalkKey,
  type TalkKeyPlatform,
  type TalkKeySymbol,
  talkKeyParts,
} from "../conversation/talk-key";

export const SHORTCUT_COMMANDS = [
  "newThread",
  "previousThread",
  "nextThread",
  "newAgent",
  "globalSearch",
  "searchChat",
  "focusComposer",
  "back",
  "forward",
  "toggleSidebar",
  "showShortcuts",
] as const;

export type ShortcutCommand = (typeof SHORTCUT_COMMANDS)[number];

export interface ShortcutChord extends TalkKey {
  readonly code: string;
}

export type ShortcutOverrides = Partial<Record<ShortcutCommand, ShortcutChord>>;

export interface ShortcutEnvironment {
  readonly platform: TalkKeyPlatform;
  readonly browser: boolean;
}

type ShortcutModifiers = Partial<Pick<TalkKey, "ctrl" | "alt" | "shift" | "meta">> & { readonly primary?: true };

interface ShortcutDefaults {
  readonly mac: ShortcutChord;
  readonly other: ShortcutChord;
}

function chord(code: string, modifiers: ShortcutModifiers, mac: boolean): ShortcutChord {
  return {
    ctrl: modifiers.ctrl === true || (modifiers.primary === true && !mac),
    alt: modifiers.alt === true,
    shift: modifiers.shift === true,
    meta: modifiers.meta === true || (modifiers.primary === true && mac),
    code,
  };
}

function both(code: string, modifiers: ShortcutModifiers): { mac: ShortcutChord; other: ShortcutChord } {
  return { mac: chord(code, modifiers, true), other: chord(code, modifiers, false) };
}

const DEFAULTS: Record<ShortcutCommand, ShortcutDefaults> = {
  newThread: both("KeyO", { primary: true, shift: true }),
  previousThread: both("ArrowUp", { alt: true, shift: true }),
  nextThread: both("ArrowDown", { alt: true, shift: true }),
  newAgent: both("KeyE", { primary: true, shift: true }),
  globalSearch: both("KeyK", { primary: true }),
  searchChat: both("KeyF", { primary: true }),
  focusComposer: both("Escape", { shift: true }),
  back: { mac: chord("BracketLeft", { meta: true }, true), other: chord("ArrowLeft", { alt: true }, false) },
  forward: { mac: chord("BracketRight", { meta: true }, true), other: chord("ArrowRight", { alt: true }, false) },
  toggleSidebar: both("KeyB", { primary: true }),
  showShortcuts: both("Slash", { primary: true }),
};

export const SHORTCUT_TITLES: Record<ShortcutCommand, AppTextKey> = {
  newThread: "settings.shortcuts.command.newThread",
  previousThread: "settings.shortcuts.command.previousThread",
  nextThread: "settings.shortcuts.command.nextThread",
  newAgent: "settings.shortcuts.command.newAgent",
  globalSearch: "settings.shortcuts.command.globalSearch",
  searchChat: "settings.shortcuts.command.searchChat",
  focusComposer: "settings.shortcuts.command.focusComposer",
  back: "settings.shortcuts.command.back",
  forward: "settings.shortcuts.command.forward",
  toggleSidebar: "settings.shortcuts.command.toggleSidebar",
  showShortcuts: "settings.shortcuts.command.showShortcuts",
};

export type FixedShortcut = "openSettings" | "stopAllAgents" | "switchServer" | "zoom";

export const FIXED_SHORTCUT_TITLES: Record<FixedShortcut, AppTextKey> = {
  openSettings: "settings.shortcuts.command.openSettings",
  stopAllAgents: "settings.shortcuts.command.stopAllAgents",
  switchServer: "settings.shortcuts.command.switchServer",
  zoom: "settings.shortcuts.command.zoom",
};

export function fixedShortcuts(environment: ShortcutEnvironment): readonly FixedShortcut[] {
  return environment.browser ? ["openSettings"] : ["openSettings", "stopAllAgents", "switchServer", "zoom"];
}

export function fixedShortcutChords(fixed: FixedShortcut, environment: ShortcutEnvironment): readonly ShortcutChord[] {
  const mac = environment.platform === "darwin";
  const primary = (code: string) => chord(code, { primary: true }, mac);
  if (fixed === "openSettings") return [primary("Comma")];
  if (fixed === "stopAllAgents") return [primary("Period")];
  if (fixed === "switchServer") return [primary("Digit1"), primary("Digit9")];
  return [primary("Equal"), primary("Minus"), primary("Digit0")];
}

export function defaultShortcut(command: ShortcutCommand, environment: ShortcutEnvironment): ShortcutChord {
  const defaults = DEFAULTS[command];
  return environment.platform === "darwin" ? defaults.mac : defaults.other;
}

export function resolveShortcut(
  command: ShortcutCommand,
  overrides: ShortcutOverrides,
  environment: ShortcutEnvironment,
): ShortcutChord {
  return overrides[command] ?? defaultShortcut(command, environment);
}

const NAVIGATION_CODES = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", "Escape"]);

export function isShortcutCode(code: string): boolean {
  return (isTalkKeyCode(code) && code !== "Space" && code !== "Enter") || NAVIGATION_CODES.has(code);
}

function isFunctionKey(code: string): boolean {
  return /^F\d+$/.test(code);
}

export function isValidShortcut(key: TalkKey): key is ShortcutChord {
  if (key.code === null || !isShortcutCode(key.code)) return false;
  return key.ctrl || key.alt || key.meta || isFunctionKey(key.code) || (key.shift && key.code === "Escape");
}

const PRIMARY_RESERVED_CODES = new Set([
  "KeyA",
  "KeyC",
  "KeyH",
  "KeyM",
  "KeyQ",
  "KeyR",
  "KeyV",
  "KeyW",
  "KeyX",
  "KeyZ",
  "Comma",
  "Period",
  "Equal",
  "Minus",
  "Digit0",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
]);

const BROWSER_PRIMARY_RESERVED_CODES = new Set(["KeyN", "KeyT"]);

function isBrowserReserved(key: ShortcutChord, primaryOnly: boolean): boolean {
  if (key.code === "Tab") return key.ctrl && !key.alt && !key.meta;
  return primaryOnly && BROWSER_PRIMARY_RESERVED_CODES.has(key.code);
}

export function isReservedShortcut(key: ShortcutChord, environment: ShortcutEnvironment): boolean {
  const mac = environment.platform === "darwin";
  const primaryOnly = (mac ? key.meta && !key.ctrl : key.ctrl && !key.meta) && !key.alt;
  if (environment.browser && isBrowserReserved(key, primaryOnly)) return true;
  if (!primaryOnly) return false;
  if (!key.shift) return PRIMARY_RESERVED_CODES.has(key.code);
  return key.code === "KeyZ";
}

export function sameShortcut(left: TalkKey, right: TalkKey): boolean {
  return (
    left.ctrl === right.ctrl &&
    left.alt === right.alt &&
    left.shift === right.shift &&
    left.meta === right.meta &&
    left.code === right.code
  );
}

export type ShortcutRefusal =
  | { readonly kind: "invalid" }
  | { readonly kind: "reserved" }
  | { readonly kind: "taken"; readonly command: ShortcutCommand };

export function shortcutRefusal(
  command: ShortcutCommand,
  key: TalkKey,
  overrides: ShortcutOverrides,
  environment: ShortcutEnvironment,
): ShortcutRefusal | null {
  if (!isValidShortcut(key)) return { kind: "invalid" };
  if (isReservedShortcut(key, environment)) return { kind: "reserved" };
  const owner = SHORTCUT_COMMANDS.find(
    (other) => other !== command && sameShortcut(resolveShortcut(other, overrides, environment), key),
  );
  return owner ? { kind: "taken", command: owner } : null;
}

export interface ShortcutKeyEvent {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing?: boolean;
  readonly target?: EventTarget | null;
}

function editableTarget(target: EventTarget | null | undefined): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

function movesCaret(key: ShortcutChord): boolean {
  return !key.ctrl && !key.meta && !key.shift && key.code.startsWith("Arrow");
}

export function shortcutMatches(event: ShortcutKeyEvent, key: ShortcutChord): boolean {
  if (event.isComposing === true || event.code !== key.code) return false;
  if (event.ctrlKey !== key.ctrl || event.altKey !== key.alt) return false;
  if (event.shiftKey !== key.shift || event.metaKey !== key.meta) return false;
  return !(movesCaret(key) && editableTarget(event.target));
}

export function parseShortcutOverrides(value: string | null): ShortcutOverrides {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const overrides: ShortcutOverrides = {};
  for (const [name, entry] of Object.entries(parsed)) {
    const command = SHORTCUT_COMMANDS.find((candidate) => candidate === name);
    const key = command ? parseShortcutChord(entry) : null;
    if (command && key) overrides[command] = key;
  }
  return overrides;
}

function parseShortcutChord(value: unknown): ShortcutChord | null {
  if (typeof value !== "object" || value === null || !("code" in value)) return null;
  const code = value.code;
  if (typeof code !== "string") return null;
  const key: TalkKey = {
    ctrl: "ctrl" in value && value.ctrl === true,
    alt: "alt" in value && value.alt === true,
    shift: "shift" in value && value.shift === true,
    meta: "meta" in value && value.meta === true,
    code,
  };
  return isValidShortcut(key) ? key : null;
}

export function serializeShortcutOverrides(overrides: ShortcutOverrides): string {
  const entries = SHORTCUT_COMMANDS.flatMap((command) => {
    const key = overrides[command];
    return key ? [[command, { ctrl: key.ctrl, alt: key.alt, shift: key.shift, meta: key.meta, code: key.code }]] : [];
  });
  return JSON.stringify(Object.fromEntries(entries));
}

const SYMBOL_TEXT: Record<TalkKeySymbol, string> = { ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "⌘", enter: "↩" };

export function shortcutText(
  key: ShortcutChord,
  platform: TalkKeyPlatform,
  translate: (key: AppTextKey) => string,
): string {
  const parts = talkKeyParts({ key, platform }).map((part) => {
    if ("symbol" in part) return SYMBOL_TEXT[part.symbol];
    if ("text" in part) return translate(part.text);
    return part.cap;
  });
  return parts.join(platform === "darwin" ? "" : "+");
}
