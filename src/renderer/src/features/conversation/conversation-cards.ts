import { lazy } from "solid-js";

/**
 * The cards of an agent's requests come from lazy chunks. Each card has one definition here, so that
 * one preload serves every place that draws it: a card that was not loaded draws one frame late, and
 * the chat moves under it.
 */
export const ApprovalCard = lazy(() =>
  import("@openbot/ui/features/conversation/ConversationPrompts").then((module) => ({ default: module.ApprovalCard })),
);
export const QuestionPromptBubble = lazy(() =>
  import("@openbot/ui/components/QuestionPromptBubble").then((module) => ({ default: module.QuestionPromptBubble })),
);
export const UiBlockPrompt = lazy(() =>
  import("./UiBlockPrompt").then((module) => ({ default: module.UiBlockPrompt })),
);

/** Loads the cards after the first chat opens, so a chat that opens later draws its card in its first frame. */
export function preloadConversationCards() {
  void ApprovalCard.preload();
  void QuestionPromptBubble.preload();
  void UiBlockPrompt.preload();
}
