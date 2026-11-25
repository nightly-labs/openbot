import type { AgentSummary, QuitGuard } from "@openbot/contracts/ipc";
import type { BrowserWindow, Input } from "electron";

const HOLD_MS = 1_200;
const DOUBLE_PRESS_MS = 500;
const HINT_MS = 1_200;
const RELEASE_QUIET_MS = 600;
const FIRST_REPEAT_QUIET_MS = 2_000;

export interface QuitShortcutOptions {
  quit: () => void;
  isQuitting: () => boolean;
  workingAgents: () => AgentSummary[];
  guard: () => QuitGuard;
  showHint: (window: BrowserWindow, agents: AgentSummary[] | null) => void;
}

export interface QuitShortcut {
  handleInput: (window: BrowserWindow, input: Input) => boolean;
  handleBlur: (window: BrowserWindow) => void;
}

interface Hold {
  window: BrowserWindow;
  agents: AgentSummary[];
  startedAt: number;
  lastKeyAt: number;
  repeatGapMs: number;
}

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

export function isQuitGuarded(choice: QuitGuard, agents: readonly AgentSummary[]): boolean {
  return choice === "always" || (choice === "working" && agents.length > 0);
}

function isQuitShortcut(input: Input): boolean {
  if (input.type !== "keyDown" || !input.meta || input.control || input.alt || input.shift) return false;
  const key = input.key.toLowerCase();
  return key === "q" || (input.code === "KeyQ" && !/^[a-z]$/.test(key));
}
