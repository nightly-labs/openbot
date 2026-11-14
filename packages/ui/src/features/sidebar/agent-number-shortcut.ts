import type { DesktopPlatform, SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import { sidebarAgentOrder } from "./sidebar-agent-order";
import type { SidebarPinnedItem } from "./sidebar-pins";

/**
 * A key chord an agent number shortcut may act on. A real `KeyboardEvent` carries every field; a
 * visual reply's page reports the six it sends (`ChatVisualKey`) and no `altGraph`, so that one is
 * optional and false when it is absent. That is safe because the page drops an AltGr key itself and
 * never forwards it (see the bootstrap in `@openbot/contracts/chat-visual`).
 */
export interface AgentNumberShortcutKey {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** `event.getModifierState("AltGraph")`. AltGr sends Ctrl and Alt together, so it is not this chord. */
  altGraph?: boolean | undefined;
  isComposing?: boolean | undefined;
  repeat?: boolean | undefined;
}

/** The parts of the sidebar that place an agent in its rows: its layout, its pins and its hidden set. */
export interface SidebarAgentNumberingView {
  layout: SidebarLayoutSnapshot;
  pinnedItems: readonly SidebarPinnedItem[];
  hiddenAgentIds: ReadonlySet<string>;
}

const AGENT_NUMBER_CODES = new Set([
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

/**
 * Whether the key is the agent number chord in either platform form: `⌘⌥1-9` on macOS and
 * `Ctrl+Alt+1-9` elsewhere. The page of a visual reply cannot report the platform, so it forwards
 * both forms and the app checks the platform itself.
 */
export function isAgentNumberShortcutKey(key: AgentNumberShortcutKey): boolean {
  if (key.altGraph || key.isComposing || key.repeat || key.shiftKey) return false;
  if (!AGENT_NUMBER_CODES.has(key.code)) return false;
  return (key.metaKey && key.altKey && !key.ctrlKey) || (key.ctrlKey && key.altKey && !key.metaKey);
}

/**
 * The agent number the chord asks for, or null when the event is not the chord for this platform.
 * `⌘⌥1-9` on macOS and `Ctrl+Alt+1-9` on Windows and Linux; the number comes from `event.code`
 * (`Digit1` to `Digit9`) because Option changes `event.key` on macOS, and AltGr, an IME composition
 * and a held key are not the chord.
 */
export function agentNumberFromShortcut(key: AgentNumberShortcutKey, platform: DesktopPlatform): number | null {
  if (!isAgentNumberShortcutKey(key)) return null;
  const isMac = platform === "darwin";
  if (isMac ? !key.metaKey : !key.ctrlKey) return null;
  return Number(key.code.slice("Digit".length));
}

/**
 * The agents the numbers name: every agent the sidebar can show except the hidden ones, in the
 * order the sidebar draws its rows. A collapsed group still counts, so a number opens the same
 * agent when the group opens, and so do the pinned and waiting agents, which the sidebar draws in
 * their own groups. The order is the one global search lists agents in, so an agent keeps its
 * number between the two.
 */
export function numberedSidebarAgents(
  agents: readonly { id: string }[],
  view: SidebarAgentNumberingView,
): { id: string }[] {
  return sidebarAgentOrder(agents, view).filter((agent) => !view.hiddenAgentIds.has(agent.id));
}

/**
 * The agent a number names, or null when the slot is empty or the agent is already selected: both
 * are a no-op, and the caller must not change the selection for either.
 */
export function numberedSidebarAgentTarget(
  agents: readonly { id: string }[],
  view: SidebarAgentNumberingView,
  number: number,
  activeAgentId: string | null | undefined,
): { id: string } | null {
  const agent = numberedSidebarAgents(agents, view)[number - 1];
  if (!agent) return null;
  if (activeAgentId && agent.id === activeAgentId) return null;
  return agent;
}
