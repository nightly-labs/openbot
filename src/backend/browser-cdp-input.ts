import type { SendCommand } from "./browser-cdp-values";

export async function dispatchMouseClick(
  send: SendCommand,
  coordinates: { x: number; y: number },
  button: "left" | "middle" | "right",
  totalClicks: number,
  modifiers: number,
  sessionId?: string,
): Promise<void> {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...coordinates, modifiers }, sessionId);
  for (let clickCount = 1; clickCount <= totalClicks; clickCount += 1) {
    await send(
      "Input.dispatchMouseEvent",
      { type: "mousePressed", ...coordinates, button, clickCount, modifiers },
      sessionId,
    );
    await send(
      "Input.dispatchMouseEvent",
      { type: "mouseReleased", ...coordinates, button, clickCount, modifiers },
      sessionId,
    );
  }
}

export async function dispatchShortcut(send: SendCommand, shortcut: string, sessionId?: string): Promise<void> {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 5) throw new Error("Invalid browser shortcut.");
  const key = parts.pop();
  if (!key) throw new Error("Invalid browser shortcut.");
  const modifierNames: string[] = [];
  for (const part of parts) {
    const modifier = normalizeModifier(part);
    if (!modifier) throw new Error(`Invalid browser shortcut: ${shortcut}`);
    modifierNames.push(modifier);
  }
  const { text: keyText, ...normalized } = normalizeKey(key);
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
  try {
    for (const modifier of modifierNames) {
      await send(
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
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...keyInfo, modifiers }, sessionId);
    keyPressed = true;
    if (character !== undefined && (modifiers === 0 || shiftOnly))
      // The keypress has to agree with the keydown around it. Without the mask CDP defaults it to
      // zero, so `Shift+Enter` arrives at the page as an unshifted Enter -- and a composer that
      // decides between "send" and "line break" in its keypress handler sends the message.
      await send("Input.dispatchKeyEvent", { type: "char", ...keyInfo, modifiers, text: character }, sessionId);
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...keyInfo, modifiers }, sessionId);
    keyPressed = false;
  } finally {
    if (keyPressed) {
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...keyInfo, modifiers }, sessionId).catch(() => undefined);
    }
    for (const modifier of [...pressedModifiers].reverse()) {
      await send(
        "Input.dispatchKeyEvent",
        { type: "keyUp", key: modifier, code: `${modifier}Left`, modifiers: 0 },
        sessionId,
      ).catch(() => undefined);
    }
  }
}

function normalizeModifier(value: string) {
  const lower = value.toLowerCase();
  if (lower === "cmd" || lower === "command" || lower === "meta") return "Meta";
  if (lower === "ctrl" || lower === "control") return "Control";
  if (lower === "alt" || lower === "option") return "Alt";
  if (lower === "shift") return "Shift";
  return null;
}

export async function dispatchTextKey(send: SendCommand, character: string, sessionId?: string): Promise<void> {
  const upper = character.toUpperCase();
  const code = /^[a-z]$/i.test(character) ? `Key${upper}` : "Unidentified";
  await send(
    "Input.dispatchKeyEvent",
    { type: "rawKeyDown", key: character, code, text: character, unmodifiedText: character },
    sessionId,
  );
  await send(
    "Input.dispatchKeyEvent",
    { type: "char", key: character, code, text: character, unmodifiedText: character },
    sessionId,
  );
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: character, code }, sessionId);
}

function normalizeKey(key: string): {
  key: string;
  code: string;
  windowsVirtualKeyCode?: number;
  nativeVirtualKeyCode?: number;
  text?: string;
} {
  // `text` is the character the key produces, and only the keys that produce one carry it. Chromium
  // decides implicit form submission and text insertion from the character event, not the key event:
  // without `\r` here, `press("Enter")` fires `keydown` and nothing else, so a plain `<form>` with no
  // script never submits and a textarea never gains a line. `Tab` stays characterless on purpose --
  // the browser moves focus on the key event, and a character dispatched afterwards would land in
  // whatever gained focus.
  const aliases: Record<string, [string, string, number?, string?]> = {
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
  const alias = aliases[key.toLowerCase()];
  const macNativeVirtualKeyCode =
    process.platform === "darwin" ? { ArrowUp: 126, ArrowDown: 125, Home: 115 }[alias?.[0] ?? ""] : undefined;
  if (alias)
    return {
      ...(alias[3] === undefined ? {} : { text: alias[3] }),
      key: alias[0],
      code: alias[1],
      windowsVirtualKeyCode: alias[2],
      nativeVirtualKeyCode: macNativeVirtualKeyCode,
    };
  if (!/^[\w\-.,/;='[\]`]{1,20}$/u.test(key)) throw new Error(`Unsupported browser key: ${key}`);
  const upper = key.length === 1 ? key.toUpperCase() : key;
  return { key, code: key.length === 1 && /[a-z]/i.test(key) ? `Key${upper}` : upper };
}

/** Chromium's `Input.dispatchKeyEvent` bit for Shift, the one modifier that still yields a character. */
const SHIFT_MODIFIER = 8;

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
