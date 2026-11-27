import { UI_BLOCK_PREVIEW_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/ui-block-preview-edit-v1";
import { withWholePromptText } from "@openbot/team-client/runtime-attention";
import type { QuestionPromptComposerAnswer } from "@openbot/ui/components/QuestionPromptBubble";
import { createMemo, Loading, Show } from "solid-js";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { QuestionPromptBubble, UiBlockPrompt } from "./conversation-cards";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationProps, PromptAnswerOptions } from "./conversation-types";

export function ConversationQuestionPrompt(props: {
  elementRef?: (element: HTMLElement | undefined) => void;
  onAnswer?: (answers: Record<string, string[]>, options?: PromptAnswerOptions) => Promise<boolean>;
  registerComposerAnswer?: ((answer: QuestionPromptComposerAnswer) => () => void) | undefined;
}) {
  const { props: view, openExternalMessageUrl, keepUnsentPromptAnswer } = useConversationViewScope();
  let cachedPrompt: { key: string; prompt: NonNullable<ConversationProps["prompt"]> } | null = null;
  const promptKey = (prompt: NonNullable<ConversationProps["prompt"]>) =>
    JSON.stringify([prompt.turnId, String(prompt.requestId)]);
  const keyedPrompt = createMemo(() => {
    const prompt = view.prompt;
    if (!prompt) {
      cachedPrompt = null;
      return null;
    }
    const key = promptKey(prompt);
    if (cachedPrompt?.key === key) return cachedPrompt;
    cachedPrompt = { key, prompt };
    return cachedPrompt;
  });
  const pendingPromptBlock = createMemo(() => (keyedPrompt() ? view.promptUiBlock : undefined));
  const answer = (answers: Record<string, string[]>, options?: PromptAnswerOptions) =>
    (props.onAnswer ?? view.onAnswerPrompt)(answers, options);
  return (
    <Show when={keyedPrompt()} keyed>
      {(entry) => {
        let shown = entry.prompt;
        const shownQuestions = () => {
          const latest = view.prompt;
          if (latest && promptKey(latest) === entry.key) shown = withWholePromptText(shown, latest.questions);
          return shown.questions;
        };
        const presentResolution = () =>
          view.onPromptResolutionPresented?.(entry.prompt.agentId, entry.prompt.turnId, entry.prompt.requestId);
        return (
          <Loading>
            <Show
              when={pendingPromptBlock()}
              fallback={
                <QuestionPromptBubble
                  questions={shownQuestions()}
                  elementRef={(element) => props.elementRef?.(element)}
                  registerComposerAnswer={props.registerComposerAnswer}
                  sendShortcut={deviceSendShortcut(view.platform)}
                  onSubmit={answer}
                  onResolutionPresented={presentResolution}
                  onOpenLink={(url) => void openExternalMessageUrl(url)}
                />
              }
            >
              {(block) => (
                <UiBlockPrompt
                  block={block()}
                  agents={view.agents}
                  agentId={entry.prompt.agentId}
                  onSelectAgent={view.onSelectAgent}
                  onOpenLink={(url) => void openExternalMessageUrl(url)}
                  elementRef={(element) => props.elementRef?.(element)}
                  onAnswer={answer}
                  canEditPreview={serverSupportsCapability(view.server, UI_BLOCK_PREVIEW_EDIT_CAPABILITY)}
                  onUnsentPreviewChange={keepUnsentPromptAnswer}
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
