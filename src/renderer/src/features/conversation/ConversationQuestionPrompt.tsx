import type { QuestionPromptComposerAnswer } from "@openbot/ui/components/QuestionPromptBubble";
import { createMemo, Loading, lazy, Show } from "solid-js";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationProps, PromptAnswerOptions } from "./conversation-types";

/**
 * The question that the open thread waits for, as a card. The agent's chat and an open side thread show it.
 * `elementRef` gets the card, for the chat that keeps it in view. `onAnswer` replaces the view's answer.
 * `registerComposerAnswer` lets the message box of the same chat answer the question.
 */
export function ConversationQuestionPrompt(props: {
  elementRef?: (element: HTMLElement | undefined) => void;
  onAnswer?: (answers: Record<string, string[]>, options?: PromptAnswerOptions) => Promise<boolean>;
  registerComposerAnswer?: ((answer: QuestionPromptComposerAnswer) => () => void) | undefined;
}) {
  const { props: view, openExternalMessageUrl } = useConversationViewScope();
  let cachedPrompt: { key: string; prompt: NonNullable<ConversationProps["prompt"]> } | null = null;
  const keyedPrompt = createMemo(() => {
    const prompt = view.prompt;
    if (!prompt) {
      cachedPrompt = null;
      return null;
    }
    const key = JSON.stringify([prompt.turnId, String(prompt.requestId)]);
    if (cachedPrompt?.key === key) return cachedPrompt;
    cachedPrompt = { key, prompt };
    return cachedPrompt;
  });
  /**
   * The block of the waiting prompt draws it as a card. Until the block's message arrives, or when the
   * agent asked without one, the prompt's questions draw it.
   */
  const pendingPromptBlock = createMemo(() => (keyedPrompt() ? view.promptUiBlock : undefined));
  const answer = (answers: Record<string, string[]>, options?: PromptAnswerOptions) =>
    (props.onAnswer ?? view.onAnswerPrompt)(answers, options);
  return (
    <Show when={keyedPrompt()} keyed>
      {(entry) => {
        const presentResolution = () =>
          view.onPromptResolutionPresented?.(entry.prompt.agentId, entry.prompt.turnId, entry.prompt.requestId);
        return (
          <Loading>
            <Show
              when={pendingPromptBlock()}
              fallback={
                <QuestionPromptBubble
                  questions={entry.prompt.questions}
                  elementRef={(element) => props.elementRef?.(element)}
                  registerComposerAnswer={props.registerComposerAnswer}
                  sendShortcut={deviceSendShortcut(view.platform)}
                  onSubmit={answer}
                  onResolutionPresented={presentResolution}
                />
              }
            >
              {(block) => (
                <UiBlockPrompt
                  block={block()}
                  agents={view.agents}
                  onSelectAgent={view.onSelectAgent}
                  onOpenLink={(url) => void openExternalMessageUrl(url)}
                  elementRef={(element) => props.elementRef?.(element)}
                  onAnswer={answer}
                  onAnswered={presentResolution}
                />
              )}
            </Show>
          </Loading>
        );
      }}
    </Show>
  );
}

const QuestionPromptBubble = lazy(() =>
  import("@openbot/ui/components/QuestionPromptBubble").then((module) => ({ default: module.QuestionPromptBubble })),
);
const UiBlockPrompt = lazy(() => import("./UiBlockPrompt").then((module) => ({ default: module.UiBlockPrompt })));
