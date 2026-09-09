export interface ChatLayout {
  viewport: number;
  content: number;
  header: number;
  tailY: number;
  tailHeight: number;
}

/** Minimum native inset, including the space occupied by the composer/keyboard. */
export function chatBlankSpace(layout: ChatLayout): number {
  "worklet";
  return Math.max(0, layout.viewport - layout.header - layout.tailHeight);
}

export function chatEndOffset(layout: ChatLayout, inset: number): number {
  "worklet";
  return Math.max(0, layout.content + inset - layout.viewport);
}

export function chatSendOffset(layout: ChatLayout, inset: number): number {
  "worklet";
  return Math.min(Math.max(0, layout.tailY - layout.header), chatEndOffset(layout, inset));
}

export function chatContentIsVisible(layout: ChatLayout, scrollY: number, obstruction: number): boolean {
  "worklet";
  // Blank space is not unread content. Only the keyboard and composer obscure messages.
  return layout.content <= scrollY + layout.viewport - obstruction + 2;
}
