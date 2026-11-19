import { CHAT_COLOR_PRESETS } from "@openbot/brand/chat-colors";
import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

export type MessageColorMode = "none" | "agent" | "custom";

export type MessageColorStyle = "solid" | "tint";

export interface MessageColorValue {
  mode: MessageColorMode;
  customColor: AvatarColor;
  style: MessageColorStyle;
  seeThrough: boolean;
}

const key = "openbot.mobile.message-color.v1";
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
    if (value && !useMessageColor.getState().ready) useMessageColor.setState(value);
  } finally {
    useMessageColor.setState({ ready: true });
  }
}

export async function saveMessageColor(change: Partial<MessageColorValue>): Promise<void> {
  if (!useMessageColor.getState().ready) return;
  useMessageColor.setState(change);
  const { mode, customColor, style, seeThrough } = useMessageColor.getState();
  await SecureStore.setItemAsync(key, JSON.stringify({ mode, customColor, style, seeThrough }));
}

const TINT_SHARE = { light: 0.2, dark: 0.34 } as const;

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

export function tintedMessageColor(color: string, surface: string, dark: boolean): string {
  return mixColor(surface, color, TINT_SHARE[dark ? "dark" : "light"]) ?? color;
}

export const PLAIN_BUBBLE_SHARE = 0.6;
export const MEMBER_BUBBLE_SHARE = 0x38 / 0xff;
