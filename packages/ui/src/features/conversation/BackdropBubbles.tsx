import type { ChatBackdropBubbles } from "@openbot/contracts/chat-visual";
import type { AvatarColor } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";

const BackdropBubblesContext = createContext<() => ChatBackdropBubbles | null>(() => null);

export function BackdropBubbles(props: { colors: ChatBackdropBubbles | null; children: JSX.Element }): JSX.Element {
  return <BackdropBubblesContext value={() => props.colors}>{props.children}</BackdropBubblesContext>;
}

export function useBackdropBubbles(): () => ChatBackdropBubbles | null {
  return useContext(BackdropBubblesContext);
}

export function chatBubbleColor(
  backdrop: ChatBackdropBubbles | null,
  author: {
    kind: "you" | "agent" | "member";
    chatColor?: AvatarColor | undefined;
    agent?: { chatColor?: AvatarColor | undefined } | undefined;
  },
): AvatarColor | undefined {
  const themed = author.kind === "you" ? backdrop?.yours : author.kind === "agent" ? backdrop?.agents : undefined;
  return themed ?? author.chatColor ?? author.agent?.chatColor;
}
