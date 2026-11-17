import type { ChatBackdropBubbles } from "@openbot/contracts/chat-visual";
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
