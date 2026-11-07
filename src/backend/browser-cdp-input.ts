import { Effect, Option } from "effect";
import type { SendCommand } from "./browser-cdp-values";
import { type BrowserOperationError, browserFailure, browserSync } from "./browser-effects";

export interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

/** A path longer than this starts this far from the target, so it crosses few other elements. */
const MAX_POINTER_PATH = 160;
const POINTER_PATH_STEPS = 3;
// Longer than a frame of a throttled tab, and short against the wait of a tab with no frames.
const POINTER_PATH_MOVE_WAIT = "100 millis";

/**
 * Moves the pointer to `to` in a few events along a slight curve, as a hand does, instead of in
 * one jump. The path starts at `from` when it is near, otherwise a short distance away. The events
 * have no delay between them.
 *
 * Chromium acknowledges a pointer move on the page's next frame. A tab with no frames, such as a
 * hidden tab of a window that does not draw, acknowledges a move only after a second or more. When
 * a path move is not acknowledged in time, the rest of the path is skipped, so the pointer goes to
 * `to` with no more wait than one move.
 */
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
  // A bend at right angles to the line, up to a tenth of its length.
  const bend = (Math.random() - 0.5) * 0.2;
  const points: PointerPoint[] = [];
  for (let step = 0; step < POINTER_PATH_STEPS; step += 1) {
    const rest = 1 - step / POINTER_PATH_STEPS;
    // Fast at the start and slow near the target.
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

/** A press holds the button for 30 to 60 ms, as a quick human click does. A press with no hold is a bot signal. */
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
  // A named key gets its character from the alias table; a single-character shortcut is its own.
  // A command modifier gets none, because `Ctrl+S` is a command rather than an `s` in the document.
  // Shift is not one of those: `Shift+Enter` is how a composer spells "line break, do not submit",
  // and suppressing its character made the shortcut fire a key event, insert nothing, and report
  // success. Which glyph Shift produces is only knowable for the alias keys, whose text does not
  // depend on it, and for a letter -- `Shift+1` is `!` on a US layout and something else on half a
  // dozen others, so it stays a key event rather than a guessed character.
  const character = keyText ?? (key.length === 1 ? (shiftOnly ? shiftedLetter(key) : key) : undefined);
  // A real `Shift+a` reports `A` in `event.key`, not an `a` with a shift flag beside it, and the
  // character event has to agree with the key events around it.
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
      // The keypress has to agree with the keydown around it. Without the mask CDP defaults it to
      // zero, so `Shift+Enter` arrives at the page as an unshifted Enter -- and a composer that
      // decides between "send" and "line break" in its keypress handler sends the message.
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

// The keys of a US layout: each character with its unshifted and shifted twin, `code` and key code.
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

/**
 * Text up to this length is typed as key events, one key per character, as a person types it. A
 * page that counts key events before it accepts a value then accepts it. Longer text, and each
 * character that has no key on a US layout, is inserted as text: it is faster, and key events
 * would give no more. Empty text is inserted too: it deletes the selection, as a replace needs.
 */
const MAX_KEYED_TEXT = 128;

/**
 * Code editors such as CodeMirror and Monaco add a closing bracket, quote or tag, or an indent,
 * when a person types one of these characters. Text that has one is inserted in one piece, so the
 * field gets the exact text.
 */
const EDITOR_COMPLETED_TEXT = /[\n\r([{'"`<]/;

interface TextChecks {
  /**
   * Tells whether the first key event reached the page. Chromium can drop key events for a tab that
   * it accepts inserted text for, as for a hidden tab under Xvfb, and drops them with no error. The
   * rest of the text is then inserted, as it was before keys.
   */
  readonly keyArrived?: Effect.Effect<boolean, BrowserOperationError>;
  /**
   * Saves the field text for `keyArrived` again. It runs when text was inserted before the first
   * key, so that the inserted text does not read as a key that arrived.
   */
  readonly saveText?: Effect.Effect<void, BrowserOperationError>;
  /**
   * Runs before each key or insert after the first one, with the count of characters that the page
   * already has. It fails when a key handler moved focus or the deadline passed, so that the error
   * can tell the caller that part of the text is in the field. Focus that moves after the last
   * character, as in a one-time code box, is not a failure.
   */
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
    // The characters before the first key have no US key, so they were inserted.
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
  // A character that has no US key keeps the key event that Chromium gives an unknown key.
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

// `text` is the character the key produces, and only the keys that produce one carry it. Chromium
// decides implicit form submission and text insertion from the character event, not the key event:
// without `\r` here, `press("Enter")` fires `keydown` and nothing else, so a plain `<form>` with no
// script never submits and a textarea never gains a line. `Tab` stays characterless on purpose --
// the browser moves focus on the key event, and a character dispatched afterwards would land in
// whatever gained focus.
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
  return { key, code: key.length === 1 && /[a-z]/i.test(key) ? `Key${upper}` : upper };
}

/**
 * The key code and character of a named key, as `KeyboardEvent.key` spells it. Chromium runs an
 * editing command such as Backspace or an arrow from the key code, and submits a form from Enter's
 * character, so a named key that has neither does nothing in the page.
 */
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

/** Chromium's `Input.dispatchKeyEvent` bit for Shift, the one modifier that still yields a character. */
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
