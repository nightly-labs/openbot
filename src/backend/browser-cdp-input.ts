import { Effect, Option } from "effect";
import type { SendCommand } from "./browser-cdp-values";
import { type BrowserOperationError, browserFailure, browserSync } from "./browser-effects";

export interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

const MAX_POINTER_PATH = 160;
const POINTER_PATH_STEPS = 3;
const POINTER_PATH_MOVE_WAIT = "100 millis";

export const dispatchPointerMove = Effect.fn("Browser.dispatchPointerMove")(function* (
  send: SendCommand,
  from: PointerPoint | undefined,
  to: PointerPoint,
  modifiers: number,
  sessionId?: string,
) {
  const path = pointerPath(from, to);
  const target = path.pop() ?? to;
  for (const point of path) {
    const acknowledged = yield* send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", ...point, modifiers },
      sessionId,
    ).pipe(Effect.timeoutOption(POINTER_PATH_MOVE_WAIT));
    if (Option.isNone(acknowledged)) break;
  }
  yield* send("Input.dispatchMouseEvent", { type: "mouseMoved", ...target, modifiers }, sessionId);
});

function pointerPath(from: PointerPoint | undefined, to: PointerPoint): PointerPoint[] {
  let dx = from ? from.x - to.x : 0;
  let dy = from ? from.y - to.y : 0;
  const distance = Math.hypot(dx, dy);
  if (distance < 2) {
    const angle = Math.random() * 2 * Math.PI;
    const length = 24 + Math.random() * 24;
    dx = Math.cos(angle) * length;
    dy = Math.sin(angle) * length;
  } else if (distance > MAX_POINTER_PATH) {
    dx *= MAX_POINTER_PATH / distance;
    dy *= MAX_POINTER_PATH / distance;
  }
  const bend = (Math.random() - 0.5) * 0.2;
  const points: PointerPoint[] = [];
  for (let step = 0; step < POINTER_PATH_STEPS; step += 1) {
    const rest = 1 - step / POINTER_PATH_STEPS;
    const along = rest * rest;
    const curve = Math.sin(Math.PI * rest) * bend;
    points.push({
      x: Math.max(0, Math.round((to.x + dx * along - dy * curve) * 100) / 100),
      y: Math.max(0, Math.round((to.y + dy * along + dx * curve) * 100) / 100),
    });
  }
  points.push(to);
  return points;
}

function pressHold() {
  return Effect.sleep(30 + Math.floor(Math.random() * 30));
}

export const dispatchMouseClick = Effect.fn("Browser.dispatchMouseClick")(function* (
  send: SendCommand,
  coordinates: { x: number; y: number },
  button: "left" | "middle" | "right",
  totalClicks: number,
  modifiers: number,
  sessionId?: string,
  from?: PointerPoint,
) {
  yield* dispatchPointerMove(send, from, coordinates, modifiers, sessionId);
  for (let clickCount = 1; clickCount <= totalClicks; clickCount += 1) {
    let released = false;
    yield* Effect.gen(function* () {
      yield* send(
        "Input.dispatchMouseEvent",
        { type: "mousePressed", ...coordinates, button, clickCount, modifiers },
        sessionId,
      );
      yield* pressHold();
      yield* send(
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", ...coordinates, button, clickCount, modifiers },
        sessionId,
      );
      released = true;
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() =>
          released
            ? Effect.void
            : send(
                "Input.dispatchMouseEvent",
                { type: "mouseReleased", ...coordinates, button, clickCount, modifiers },
                sessionId,
              ).pipe(Effect.ignore),
        ),
      ),
    );
  }
});

export const dispatchShortcut = Effect.fn("Browser.dispatchShortcut")(function* (
  send: SendCommand,
  shortcut: string,
  sessionId?: string,
) {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 5) return yield* browserFailure(new Error("Invalid browser shortcut."));
  const key = parts.pop();
  if (!key) return yield* browserFailure(new Error("Invalid browser shortcut."));
  const modifierNames: string[] = [];
  for (const part of parts) {
    const modifier = normalizeModifier(part);
    if (!modifier) return yield* browserFailure(new Error(`Invalid browser shortcut: ${shortcut}`));
    modifierNames.push(modifier);
  }
  const { text: keyText, ...normalized } = yield* browserSync(() => normalizeKey(key));
  const modifiers = modifierMask(modifierNames);
  const shiftOnly = modifiers === SHIFT_MODIFIER;
  const character = keyText ?? (key.length === 1 ? (shiftOnly ? shiftedLetter(key) : key) : undefined);
  const keyInfo = shiftOnly && keyText === undefined && character ? { ...normalized, key: character } : normalized;
  const pressedModifiers: string[] = [];
  let keyPressed = false;
  yield* Effect.gen(function* () {
    for (const modifier of modifierNames) {
      yield* send(
        "Input.dispatchKeyEvent",
        {
          type: "rawKeyDown",
          key: modifier,
          code: `${modifier}Left`,
          modifiers: modifierMask([...pressedModifiers, modifier]),
        },
        sessionId,
      );
      pressedModifiers.push(modifier);
    }
    yield* send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...keyInfo, modifiers }, sessionId);
    keyPressed = true;
    if (character !== undefined && (modifiers === 0 || shiftOnly))
      yield* send("Input.dispatchKeyEvent", { type: "char", ...keyInfo, modifiers, text: character }, sessionId);
    yield* send("Input.dispatchKeyEvent", { type: "keyUp", ...keyInfo, modifiers }, sessionId);
    keyPressed = false;
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        if (keyPressed) {
          yield* send("Input.dispatchKeyEvent", { type: "keyUp", ...keyInfo, modifiers }, sessionId).pipe(
            Effect.ignore,
          );
        }
        for (const modifier of [...pressedModifiers].reverse()) {
          yield* send(
            "Input.dispatchKeyEvent",
            { type: "keyUp", key: modifier, code: `${modifier}Left`, modifiers: 0 },
            sessionId,
          ).pipe(Effect.ignore);
        }
      }).pipe(Effect.orDie),
    ),
  );
});

function normalizeModifier(value: string) {
  const lower = value.toLowerCase();
  if (lower === "cmd" || lower === "command" || lower === "meta") return "Meta";
  if (lower === "ctrl" || lower === "control") return "Control";
  if (lower === "alt" || lower === "option") return "Alt";
  if (lower === "shift") return "Shift";
  return null;
}

const US_SYMBOL_KEYS: readonly (readonly [string, string, string, number])[] = [
  ["`", "~", "Backquote", 192],
  ["-", "_", "Minus", 189],
  ["=", "+", "Equal", 187],
  ["[", "{", "BracketLeft", 219],
  ["]", "}", "BracketRight", 221],
  ["\\", "|", "Backslash", 220],
  [";", ":", "Semicolon", 186],
  ["'", '"', "Quote", 222],
  [",", "<", "Comma", 188],
  [".", ">", "Period", 190],
  ["/", "?", "Slash", 191],
  ["1", "!", "Digit1", 49],
  ["2", "@", "Digit2", 50],
  ["3", "#", "Digit3", 51],
  ["4", "$", "Digit4", 52],
  ["5", "%", "Digit5", 53],
  ["6", "^", "Digit6", 54],
  ["7", "&", "Digit7", 55],
  ["8", "*", "Digit8", 56],
  ["9", "(", "Digit9", 57],
  ["0", ")", "Digit0", 48],
];

interface UsKey {
  readonly code: string;
  readonly keyCode: number;
  readonly shift: boolean;
}

const US_KEYS: ReadonlyMap<string, UsKey> = new Map<string, UsKey>([
  [" ", { code: "Space", keyCode: 32, shift: false }],
  ...[..."abcdefghijklmnopqrstuvwxyz"].flatMap((letter): Array<[string, UsKey]> => {
    const upper = letter.toUpperCase();
    const key = { code: `Key${upper}`, keyCode: upper.charCodeAt(0) };
    return [
      [letter, { ...key, shift: false }],
      [upper, { ...key, shift: true }],
    ];
  }),
  ...US_SYMBOL_KEYS.flatMap(
    ([plain, shifted, code, keyCode]): Array<[string, UsKey]> => [
      [plain, { code, keyCode, shift: false }],
      [shifted, { code, keyCode, shift: true }],
    ],
  ),
]);

const DIGIT_KEY_CODE = /^(Digit|Numpad)([0-9])$/u;

export function printableKeyCode(key: string, code: string): number | undefined {
  const digit = DIGIT_KEY_CODE.exec(code);
  if (digit) return (digit[1] === "Digit" ? 48 : 96) + Number(digit[2]);
  return US_KEYS.get(key)?.keyCode;
}

const MAX_KEYED_TEXT = 128;

const EDITOR_COMPLETED_TEXT = /[\n\r([{'"`<]/;

interface TextChecks {
  readonly keyArrived?: Effect.Effect<boolean, BrowserOperationError>;
  readonly saveText?: Effect.Effect<void, BrowserOperationError>;
  readonly beforeNext?: (typed: number, total: number) => Effect.Effect<void, BrowserOperationError>;
}

export const dispatchText = Effect.fn("Browser.dispatchText")(function* (
  send: SendCommand,
  text: string,
  sessionId?: string,
  checks: TextChecks = {},
) {
  if (text.length === 0 || text.length > MAX_KEYED_TEXT || EDITOR_COMPLETED_TEXT.test(text)) {
    yield* send("Input.insertText", { text }, sessionId);
    return;
  }
  const characters = [...text];
  let typed = 0;
  const beforePiece = Effect.suspend(() =>
    typed > 0 && checks.beforeNext ? checks.beforeNext(typed, characters.length) : Effect.void,
  );
  const insert = (piece: string) =>
    beforePiece.pipe(
      Effect.andThen(send("Input.insertText", { text: piece }, sessionId)),
      Effect.andThen(
        Effect.sync(() => {
          typed += [...piece].length;
        }),
      ),
    );
  let pending = "";
  let keyed = false;
  for (const [index, character] of characters.entries()) {
    if (!US_KEYS.has(character)) {
      pending += character;
      continue;
    }
    if (pending) yield* insert(pending);
    pending = "";
    yield* beforePiece;
    if (!keyed && index > 0 && checks.saveText) yield* checks.saveText;
    yield* dispatchTextKey(send, character, sessionId);
    typed += 1;
    if (!keyed && checks.keyArrived && !(yield* checks.keyArrived)) {
      yield* insert(characters.slice(index).join(""));
      return;
    }
    keyed = true;
  }
  if (pending) yield* insert(pending);
});

export const dispatchTextKey = Effect.fn("Browser.dispatchTextKey")(function* (
  send: SendCommand,
  character: string,
  sessionId?: string,
) {
  const usKey = US_KEYS.get(character);
  const key = {
    key: character,
    code: usKey?.code ?? "Unidentified",
    ...(usKey ? { windowsVirtualKeyCode: usKey.keyCode, modifiers: usKey.shift ? SHIFT_MODIFIER : 0 } : {}),
  };
  let released = false;
  yield* Effect.gen(function* () {
    yield* send(
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", ...key, text: character, unmodifiedText: character },
      sessionId,
    );
    yield* send(
      "Input.dispatchKeyEvent",
      { type: "char", ...key, text: character, unmodifiedText: character },
      sessionId,
    );
    yield* send("Input.dispatchKeyEvent", { type: "keyUp", ...key }, sessionId);
    released = true;
  }).pipe(
    Effect.ensuring(
      Effect.suspend(() =>
        released
          ? Effect.void
          : send("Input.dispatchKeyEvent", { type: "keyUp", ...key }, sessionId).pipe(Effect.ignore),
      ),
    ),
  );
});

const KEY_ALIASES: Record<string, [string, string, number?, string?]> = {
  enter: ["Enter", "Enter", 13, "\r"],
  tab: ["Tab", "Tab", 9],
  escape: ["Escape", "Escape", 27],
  esc: ["Escape", "Escape", 27],
  backspace: ["Backspace", "Backspace", 8],
  delete: ["Delete", "Delete", 46],
  space: [" ", "Space", 32, " "],
  arrowup: ["ArrowUp", "ArrowUp", 38],
  arrowdown: ["ArrowDown", "ArrowDown", 40],
  arrowleft: ["ArrowLeft", "ArrowLeft", 37],
  arrowright: ["ArrowRight", "ArrowRight", 39],
  home: ["Home", "Home", 36],
  end: ["End", "End", 35],
  pageup: ["PageUp", "PageUp", 33],
  pagedown: ["PageDown", "PageDown", 34],
};

function normalizeKey(key: string): {
  key: string;
  code: string;
  windowsVirtualKeyCode?: number | undefined;
  nativeVirtualKeyCode?: number | undefined;
  text?: string;
} {
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias) {
    const nativeVirtualKeyCode = macNativeVirtualKeyCode(alias[0]);
    return {
      ...(alias[3] === undefined ? {} : { text: alias[3] }),
      key: alias[0],
      code: alias[1],
      ...(alias[2] === undefined ? {} : { windowsVirtualKeyCode: alias[2] }),
      ...(nativeVirtualKeyCode === undefined ? {} : { nativeVirtualKeyCode }),
    };
  }
  if (!/^[\w\-.,/;='[\]`]{1,20}$/u.test(key)) throw new Error(`Unsupported browser key: ${key}`);
  const upper = key.length === 1 ? key.toUpperCase() : key;
  const usKey = key.length === 1 ? US_KEYS.get(key) : undefined;
  return {
    key,
    code: key.length === 1 && /[a-z]/i.test(key) ? `Key${upper}` : upper,
    ...(usKey ? { windowsVirtualKeyCode: usKey.keyCode } : {}),
  };
}

export function namedKey(key: string): {
  windowsVirtualKeyCode?: number | undefined;
  nativeVirtualKeyCode?: number | undefined;
  text?: string;
} {
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias?.[0] !== key) return {};
  return {
    windowsVirtualKeyCode: alias[2],
    nativeVirtualKeyCode: macNativeVirtualKeyCode(key),
    ...(alias[3] === undefined ? {} : { text: alias[3] }),
  };
}

function macNativeVirtualKeyCode(key: string): number | undefined {
  return process.platform === "darwin" ? { ArrowUp: 126, ArrowDown: 125, Home: 115 }[key] : undefined;
}

export const SHIFT_MODIFIER = 8;

function shiftedLetter(key: string): string | undefined {
  return /^[a-z]$/i.test(key) ? key.toUpperCase() : undefined;
}

export function modifierMask(values: string[]) {
  let result = 0;
  for (const value of values) {
    const normalized = normalizeModifier(value) ?? value;
    if (normalized === "Alt") result |= 1;
    if (normalized === "Control") result |= 2;
    if (normalized === "Meta") result |= 4;
    if (normalized === "Shift") result |= SHIFT_MODIFIER;
  }
  return result;
}

export function buttonMask(button: "left" | "middle" | "right"): 1 | 2 | 4 {
  if (button === "left") return 1;
  return button === "right" ? 2 : 4;
}
