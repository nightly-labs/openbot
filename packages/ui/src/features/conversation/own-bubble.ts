import { type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { avatarHeadColor } from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import type { ChatMessageAuthor } from "./ChatMessageRow";

export const CHAT_BUBBLE_STYLES = ["solid", "tint", "classic"] as const;
export type ChatBubbleStyle = (typeof CHAT_BUBBLE_STYLES)[number];
export const DEFAULT_CHAT_BUBBLE_STYLE: ChatBubbleStyle = "solid";

export const CHAT_BUBBLE_STYLE_LABEL = {
  solid: "settings.bubbleStyle.solid",
  tint: "settings.bubbleStyle.tint",
  classic: "settings.bubbleStyle.classic",
} as const satisfies Record<ChatBubbleStyle, AppTextKey>;

export function isChatBubbleStyle(value: unknown): value is ChatBubbleStyle {
  return CHAT_BUBBLE_STYLES.some((style) => style === value);
}

function agentFaceColor(agent: AgentProfile): AvatarColor | undefined {
  if (agent.avatarUrl !== null) return undefined;
  const color = avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor ?? null).toLowerCase();
  return isAvatarColor(color) ? color : undefined;
}

export function ownMessageAuthor(input: {
  name: string;
  style: ChatBubbleStyle;
  agent: AgentProfile | undefined;
  chatColor: AvatarColor | undefined;
}): ChatMessageAuthor {
  const color = input.style === "classic" || input.agent === undefined ? undefined : agentFaceColor(input.agent);
  if (color === undefined) return { kind: "you", name: input.name, chatColor: input.chatColor };
  return { kind: "you", name: input.name, chatColor: color, solidBubble: input.style === "solid" };
}

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

export function solidBubbleTakesDarkText(color: AvatarColor): boolean {
  const value = Number.parseInt(color.slice(1), 16);
  const luminance =
    0.2126 * linearChannel((value >> 16) & 0xff) +
    0.7152 * linearChannel((value >> 8) & 0xff) +
    0.0722 * linearChannel(value & 0xff);
  return 1.05 / (luminance + 0.05) < 3;
}
