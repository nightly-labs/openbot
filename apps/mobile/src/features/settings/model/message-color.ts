import { CHAT_COLOR_PRESETS } from "@openbot/brand/chat-colors";
import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * The color of the user's own message bubbles. `agent` uses the color of the agent in an agent chat
 * and no color in a channel. `custom` uses `customColor` in every chat.
 */
export type MessageColorMode = "none" | "agent" | "custom";

/**
 * How a colored bubble takes its color, as the desktop bubble style: `solid` fills it, `tint` mixes a
 * part of the color into the bubble surface. A bubble with no color keeps the surface.
 */
export type MessageColorStyle = "solid" | "tint";

export interface MessageColorValue {
  mode: MessageColorMode;
  customColor: AvatarColor;
  style: MessageColorStyle;
  /**
   * Off: every bubble is solid, so a backdrop does not show through it. On: the bubbles with no color
   * and the bubbles of other people let the chat background and the backdrop show through, as before.
   */
  seeThrough: boolean;
}

const key = "openbot.mobile.message-color.v1";
/** The earlier on/off switch for the agent color. `"false"` was no color. */
const agentColorKey = "openbot.mobile.agent-color-messages.v1";

const DEFAULT_CUSTOM_MESSAGE_COLOR: AvatarColor =
  CHAT_COLOR_PRESETS.find((preset) => preset.id === "blue")?.value ?? "#4699fe";

export const useMessageColor = create<MessageColorValue & { ready: boolean }>(() => ({
  mode: "agent",
  customColor: DEFAULT_CUSTOM_MESSAGE_COLOR,
  style: "solid",
  seeThrough: false,
  ready: false,
}));

function parseStored(stored: string | null): MessageColorValue | null {
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    return null;
  }
  const fields = new Map<string, unknown>(typeof value === "object" && value !== null ? Object.entries(value) : []);
  const mode = fields.get("mode");
  const customColor = fields.get("customColor");
  const style = fields.get("style");
  const seeThrough = fields.get("seeThrough");
  if (mode !== "none" && mode !== "agent" && mode !== "custom") return null;
  return {
    mode,
    customColor: isAvatarColor(customColor) ? customColor : DEFAULT_CUSTOM_MESSAGE_COLOR,
    // A value from before the style existed is Solid, as the bubbles were.
    style: style === "tint" ? "tint" : "solid",
    seeThrough: seeThrough === true,
  };
}

export async function loadMessageColor(): Promise<void> {
  if (useMessageColor.getState().ready) return;
  try {
    const value =
      parseStored(await SecureStore.getItemAsync(key)) ??
      ((await SecureStore.getItemAsync(agentColorKey)) === "false" ? { mode: "none" as const } : null);
    // A second startup read must not overwrite a change made in Settings.
    if (value && !useMessageColor.getState().ready) useMessageColor.setState(value);
  } finally {
    useMessageColor.setState({ ready: true });
  }
}

export async function saveMessageColor(change: Partial<MessageColorValue>): Promise<void> {
  if (!useMessageColor.getState().ready) return;
  // Apply immediately, including when storage fails.
  useMessageColor.setState(change);
  const { mode, customColor, style, seeThrough } = useMessageColor.getState();
  await SecureStore.setItemAsync(key, JSON.stringify({ mode, customColor, style, seeThrough }));
}

/** The share of the color in a Tint bubble. Dark surfaces need more to show the hue. */
const TINT_SHARE = { light: 0.2, dark: 0.34 } as const;

/** Mixes `share` of `color` into `base`. Both are `#rrggbb`; else null. */
export function mixColor(base: string, color: string, share: number): string | null {
  const from = /^#([0-9a-f]{6})$/iu.exec(base.trim())?.[1];
  const to = /^#([0-9a-f]{6})$/iu.exec(color.trim())?.[1];
  if (!from || !to) return null;
  const a = Number.parseInt(from, 16);
  const b = Number.parseInt(to, 16);
  const channel = (shift: number) => {
    const start = (a >> shift) & 0xff;
    const end = (b >> shift) & 0xff;
    return Math.round(start + (end - start) * share)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** A Tint bubble: the color mixed into the bubble surface. Both are `#rrggbb`; else the color. */
export function tintedMessageColor(color: string, surface: string, dark: boolean): string {
  return mixColor(surface, color, TINT_SHARE[dark ? "dark" : "light"]) ?? color;
}

/** The share of the control fill in a bubble with no color, as the see-through bubble shows it. */
export const PLAIN_BUBBLE_SHARE = 0.6;
/** The share of a member color in that member's bubble, as the see-through bubble shows it. */
export const MEMBER_BUBBLE_SHARE = 0x38 / 0xff;
