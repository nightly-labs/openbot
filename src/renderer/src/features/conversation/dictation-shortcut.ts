import type { VoicePhase } from "@openbot/ui/features/conversation/VoiceRecordingMorph";

/** A press of the dictation key this long, with no other key, starts a recording that ends at release. */
export const DICTATION_HOLD_MS = 500;
/** Two short presses this close start a recording that runs until the next press. */
export const DICTATION_DOUBLE_TAP_MS = 400;

interface DictationShortcutOptions {
  /** The `KeyboardEvent.code` of the dictation key, or undefined while the shortcut is off. */
  key: () => string | undefined;
  phase: () => VoicePhase;
  /** Dictation can start in this chat now. */
  canStart: () => boolean;
  start: () => void;
  stop: () => void;
  now?: () => number;
  /** Runs `run` after `ms`, and returns what cancels it. */
  schedule?: (run: () => void, ms: number) => () => void;
}

/**
 * The dictation key. It is a modifier alone, so it never types into the message box. Hold it to
 * speak and let go to stop, or press it twice to speak hands-free and once more to stop. A press
 * with another key is a chord of that key and does nothing here.
 */
export function createDictationShortcut(options: DictationShortcutOptions) {
  const now = options.now ?? (() => performance.now());
  const schedule =
    options.schedule ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  /** When the key went down, while it is down. */
  let downAt: number | undefined;
  /** Another key went down during this press. */
  let chord = false;
  let cancelHold: (() => void) | undefined;
  /** The recording of this press started at the hold, so the release ends it. */
  let startedByHold = false;
  let lastTapAt = Number.NEGATIVE_INFINITY;

  function clearHold(): void {
    cancelHold?.();
    cancelHold = undefined;
  }

  function startable(): boolean {
    return options.phase() === "idle" && options.canStart();
  }

  function keyDown(event: Pick<KeyboardEvent, "code" | "repeat">): void {
    const key = options.key();
    if (!key) return;
    if (event.code !== key) {
      if (downAt !== undefined) {
        chord = true;
        clearHold();
      }
      // A key typed between two presses makes them two single presses.
      lastTapAt = Number.NEGATIVE_INFINITY;
      return;
    }
    if (event.repeat || downAt !== undefined) return;
    downAt = now();
    chord = false;
    if (!startable()) return;
    cancelHold = schedule(() => {
      cancelHold = undefined;
      if (downAt === undefined || chord || !startable()) return;
      startedByHold = true;
      lastTapAt = Number.NEGATIVE_INFINITY;
      options.start();
    }, DICTATION_HOLD_MS);
  }

  function keyUp(event: Pick<KeyboardEvent, "code">): void {
    if (event.code !== options.key() || downAt === undefined) return;
    const heldFor = now() - downAt;
    downAt = undefined;
    clearHold();
    if (startedByHold) {
      startedByHold = false;
      // A microphone that is still opening cannot stop yet: the recording then runs until the next press.
      if (options.phase() === "recording") options.stop();
      return;
    }
    if (chord || heldFor >= DICTATION_HOLD_MS) return;
    if (options.phase() === "recording") {
      lastTapAt = Number.NEGATIVE_INFINITY;
      options.stop();
      return;
    }
    const at = now();
    if (at - lastTapAt <= DICTATION_DOUBLE_TAP_MS && startable()) {
      lastTapAt = Number.NEGATIVE_INFINITY;
      options.start();
      return;
    }
    lastTapAt = at;
  }

  /** The window lost the focus, so the release of a held key never comes here. */
  function blur(): void {
    lastTapAt = Number.NEGATIVE_INFINITY;
    if (downAt === undefined) return;
    downAt = undefined;
    clearHold();
    if (!startedByHold) return;
    startedByHold = false;
    if (options.phase() === "recording") options.stop();
  }

  return { keyDown, keyUp, blur, dispose: clearHold };
}
