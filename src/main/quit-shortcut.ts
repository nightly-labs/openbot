import type { AgentSummary, QuitGuard } from "@openbot/contracts/ipc";
import type { BrowserWindow, Input } from "electron";

/** How long `Cmd + Q` must be held before OpenBot quits. */
const HOLD_MS = 1_200;
/** The longest time between two presses that still counts as a double press. */
const DOUBLE_PRESS_MS = 500;
/** How long the hint stays after the last press or repeat. */
const HINT_MS = 1_200;
/** The shortest quiet time after the last repeat that counts as a release. */
const RELEASE_QUIET_MS = 600;
/**
 * The quiet time before the first repeat. The longest "Delay until repeat" in the macOS keyboard
 * settings is 1.8 s, and a shorter wait would quit while a held second press is still down.
 */
const FIRST_REPEAT_QUIET_MS = 2_000;

export interface QuitShortcutOptions {
  /** Starts the quit. */
  quit: () => void;
  isQuitting: () => boolean;
  /** The agents that work now, here and on the servers on this computer. A quit stops them. */
  workingAgents: () => AgentSummary[];
  /** The user's choice, read at each first press. */
  guard: () => QuitGuard;
  /** Shows the hint in the window, with the agents that work. Null removes it. */
  showHint: (window: BrowserWindow, agents: AgentSummary[] | null) => void;
}

export interface QuitShortcut {
  /** True when the key is part of `Cmd + Q`. The caller then stops it, which also stops the menu item. */
  handleInput: (window: BrowserWindow, input: Input) => boolean;
  /** Focus went to another window or app, so the keys that follow are not for this window. */
  handleBlur: (window: BrowserWindow) => void;
}

interface Hold {
  window: BrowserWindow;
  /** The agents that worked at the first press. The hint names them for the whole hold. */
  agents: AgentSummary[];
  startedAt: number;
  lastKeyAt: number;
  repeatGapMs: number;
}

/**
 * `Cmd + Q` is next to `Cmd + W` and `Cmd + A`, and one press stopped OpenBot with its agents and
 * routines (#4149). In a focused OpenBot page, while an agent works, OpenBot quits only when the user
 * holds the keys or presses them twice, and a hint in the window names the agents and tells how. With
 * no agent at work, a quit stops nothing, so one press quits. The user can guard every quit, or turn
 * the guard off so that one press always quits (#5500).
 *
 * macOS sends no key up for Q while Command is held, so the repeats of the held key show the hold.
 * The keys stay held when the hold is complete. If OpenBot quit then, macOS would give the next
 * repeats to the app that comes to the front, and that app would quit too. OpenBot therefore hides
 * the window and waits for the release: a key up, the loss of focus, or a quiet time with no repeat.
 */
export function createQuitShortcut({
  quit,
  isQuitting,
  workingAgents,
  guard,
  showHint,
}: QuitShortcutOptions): QuitShortcut {
  let lastPress: { window: BrowserWindow; at: number } | null = null;
  let hold: Hold | null = null;
  let hintWindow: BrowserWindow | null = null;
  let hintAgents: AgentSummary[] = [];
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  let waitingForRelease = false;

  function hideHint(): void {
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
    const window = hintWindow;
    hintWindow = null;
    if (window && !window.isDestroyed()) showHint(window, null);
  }

  function keepHint(window: BrowserWindow, agents: AgentSummary[]): void {
    // The repeats of one hold send the same list. A new hold in the same window can name other agents.
    if (hintWindow !== window) hideHint();
    if (hintWindow !== window || hintAgents !== agents) {
      hintWindow = window;
      hintAgents = agents;
      showHint(window, agents);
    }
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, HINT_MS);
  }

  function finish(): void {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = null;
    waitingForRelease = false;
    hold = null;
    quit();
  }

  function waitForRelease(current: Hold): void {
    if (releaseTimer) clearTimeout(releaseTimer);
    const quietMs =
      current.repeatGapMs > 0 ? Math.max(RELEASE_QUIET_MS, current.repeatGapMs * 2) : FIRST_REPEAT_QUIET_MS;
    releaseTimer = setTimeout(finish, quietMs);
  }

  function complete(current: Hold): void {
    waitingForRelease = true;
    hideHint();
    // A full-screen window cannot be made clear. It stays until the quit hides every window. A clear
    // window lets clicks through to the app that the user sees behind it.
    if (!current.window.isDestroyed() && !current.window.isFullScreen()) {
      current.window.setOpacity(0);
      current.window.setIgnoreMouseEvents(true);
    }
    waitForRelease(current);
  }

  return {
    handleInput(window, input) {
      if (!isQuitShortcut(input)) {
        if (waitingForRelease && input.type === "keyUp") finish();
        else if (hold && (input.type === "keyUp" || input.key !== "Meta")) hold = null;
        return false;
      }
      if (isQuitting()) return true;
      const now = Date.now();
      if (waitingForRelease) {
        if (hold) {
          if (input.isAutoRepeat && hold.lastKeyAt < now) hold.repeatGapMs = now - hold.lastKeyAt;
          hold.lastKeyAt = now;
          waitForRelease(hold);
        }
        return true;
      }
      if (input.isAutoRepeat) {
        if (hold?.window !== window) return true;
        hold.repeatGapMs = now - hold.lastKeyAt;
        hold.lastKeyAt = now;
        keepHint(window, hold.agents);
        if (now - hold.startedAt >= HOLD_MS) complete(hold);
        return true;
      }
      // Two presses count only in one window, which showed the hint after the first.
      const doublePress = lastPress?.window === window && now - lastPress.at <= DOUBLE_PRESS_MS;
      lastPress = { window, at: now };
      const choice = doublePress ? "never" : guard();
      const agents = choice === "never" ? [] : workingAgents();
      const guarded = isQuitGuarded(choice, agents);
      hold = { window, agents, startedAt: now, lastKeyAt: now, repeatGapMs: 0 };
      if (guarded) keepHint(window, agents);
      else complete(hold);
      return true;
    },
    handleBlur(window) {
      if (hold?.window !== window) return;
      if (waitingForRelease) finish();
      else hold = null;
    },
  };
}

/** True when `Cmd + Q` asks for a hold or a second press before it quits. */
export function isQuitGuarded(choice: QuitGuard, agents: readonly AgentSummary[]): boolean {
  return choice === "always" || (choice === "working" && agents.length > 0);
}

/**
 * The menu item matches the typed character, so `Cmd + Q` follows the keyboard layout. A layout with
 * no Latin letters, such as Russian, uses the key in the Q place, as macOS does for menu items.
 */
function isQuitShortcut(input: Input): boolean {
  if (input.type !== "keyDown" || !input.meta || input.control || input.alt || input.shift) return false;
  const key = input.key.toLowerCase();
  return key === "q" || (input.code === "KeyQ" && !/^[a-z]$/.test(key));
}
