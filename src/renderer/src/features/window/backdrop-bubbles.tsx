import type { ChatBackdropBubbles } from "@openbot/contracts/chat-visual";
import { BackdropBubbles } from "@openbot/ui/features/conversation/BackdropBubbles";
import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";

const [shownBubbles, setShownBubbles] = createSignal<ChatBackdropBubbles | null>(null);

export function setShownBackdropBubbles(bubbles: ChatBackdropBubbles | null): void {
  setShownBubbles(bubbles);
}

export function WindowBackdropBubbles(props: { children: JSX.Element }): JSX.Element {
  return <BackdropBubbles colors={shownBubbles()}>{props.children}</BackdropBubbles>;
}
