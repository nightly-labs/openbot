import { CHAT_COLOR_PRESETS } from "@openbot/brand/chat-colors";
import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * The color of the user's own message bubbles. `agent` uses the color of the agent in an agent chat
 * and no color in a channel. `custom` uses `customColor` in every chat.
 */
export type MessageColorMode = "none" | "agent" | "custom";

export interface MessageColorValue {
  mode: MessageColorMode;
  customColor: AvatarColor;
}

const key = "openbot.mobile.message-color.v1";
/** The earlier on/off switch for the agent color. `"false"` was no color. */
const agentColorKey = "openbot.mobile.agent-color-messages.v1";

const DEFAULT_CUSTOM_MESSAGE_COLOR: AvatarColor =
  CHAT_COLOR_PRESETS.find((preset) => preset.id === "blue")?.value ?? "#4699fe";

export const useMessageColor = create<MessageColorValue & { ready: boolean }>(() => ({
  mode: "agent",
  customColor: DEFAULT_CUSTOM_MESSAGE_COLOR,
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
  if (mode !== "none" && mode !== "agent" && mode !== "custom") return null;
  return { mode, customColor: isAvatarColor(customColor) ? customColor : DEFAULT_CUSTOM_MESSAGE_COLOR };
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
  const { mode, customColor } = useMessageColor.getState();
  await SecureStore.setItemAsync(key, JSON.stringify({ mode, customColor }));
}
