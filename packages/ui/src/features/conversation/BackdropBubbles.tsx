import type { ChatBackdropBubbles } from "@openbot/contracts/chat-visual";
import type { AvatarColor } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";

/**
 * The chat bubble colors of the backdrop that shows now, or null. A backdrop page can bring them
 * (`chatBackdropBubbles`), so an agent's scene and the bubbles make one theme. They replace the chat
 * colors of the reader's own bubbles and of the agents' bubbles while that backdrop shows; another
 * person's bubble keeps its own color.
 */
const BackdropBubblesContext = createContext<() => ChatBackdropBubbles | null>(() => null);

export function BackdropBubbles(props: { colors: ChatBackdropBubbles | null; children: JSX.Element }): JSX.Element {
  return <BackdropBubblesContext value={() => props.colors}>{props.children}</BackdropBubblesContext>;
}

export function useBackdropBubbles(): () => ChatBackdropBubbles | null {
  return useContext(BackdropBubblesContext);
}

/**
 * The tint of a chat bubble: the backdrop color first, then the author's chat color, then the agent's.
 * The chat and the agent dock both read it here, so one agent has the same bubbles in both.
 */
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
