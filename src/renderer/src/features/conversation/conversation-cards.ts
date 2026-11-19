import { lazy } from "solid-js";

export const ApprovalCard = lazy(() =>
  import("@openbot/ui/features/conversation/ConversationPrompts").then((module) => ({ default: module.ApprovalCard })),
);
export const QuestionPromptBubble = lazy(() =>
  import("@openbot/ui/components/QuestionPromptBubble").then((module) => ({ default: module.QuestionPromptBubble })),
);
export const UiBlockPrompt = lazy(() =>
  import("./UiBlockPrompt").then((module) => ({ default: module.UiBlockPrompt })),
);

export function preloadConversationCards() {
  void ApprovalCard.preload();
  void QuestionPromptBubble.preload();
  void UiBlockPrompt.preload();
}
