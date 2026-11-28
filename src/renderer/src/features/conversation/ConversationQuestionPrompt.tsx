import type { AgentPromptQuestion } from "@openbot/contracts/ipc";
import { UI_BLOCK_PREVIEW_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/ui-block-preview-edit-v1";
import type { QuestionPromptComposerAnswer } from "@openbot/ui/components/QuestionPromptBubble";
import { createMemo, Loading, Show } from "solid-js";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { QuestionPromptBubble, UiBlockPrompt } from "./conversation-cards";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationProps, PromptAnswerOptions } from "./conversation-types";

function quoted(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function unsentAnswerText(questions: AgentPromptQuestion[], drafts: Record<string, string>): string {
  const typed = questions.flatMap((question) => {
    const text = drafts[question.id]?.trim();
    return text ? [{ question: question.question, text }] : [];
  });
  if (questions.length === 1) return typed[0]?.text ?? "";
  return typed.map(({ question, text }) => `${quoted(question)}\n\n${text}`).join("\n\n");
}

export function ConversationQuestionPrompt(props: {
  elementRef?: (element: HTMLElement | undefined) => void;
  onAnswer?: (answers: Record<string, string[]>, options?: PromptAnswerOptions) => Promise<boolean>;
  registerComposerAnswer?: ((answer: QuestionPromptComposerAnswer) => () => void) | undefined;
}) {
  const {
    props: view,
    openExternalMessageUrl,
    keepUnsentPromptAnswer,
    unsentPromptDrafts,
  } = useConversationViewScope();
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
  const pendingPromptBlock = createMemo(() => (keyedPrompt() ? view.promptUiBlock : undefined));
  const answer = (answers: Record<string, string[]>, options?: PromptAnswerOptions) =>
    (props.onAnswer ?? view.onAnswerPrompt)(answers, options);
  return (
    <Show when={keyedPrompt()} keyed>
      {(entry) => {
        const presentResolution = () =>
          view.onPromptResolutionPresented?.(entry.prompt.agentId, entry.prompt.turnId, entry.prompt.requestId);
        const keepUnsentDrafts = (drafts: Record<string, string> | undefined) => {
          if (keyedPrompt() !== entry) return;
          keepUnsentPromptAnswer(drafts && unsentAnswerText(entry.prompt.questions, drafts), drafts);
        };
        return (
          <Loading>
            <Show
              when={pendingPromptBlock()}
              fallback={
                <QuestionPromptBubble
                  questions={entry.prompt.questions}
                  elementRef={(element) => props.elementRef?.(element)}
                  registerComposerAnswer={props.registerComposerAnswer}
                  drafts={unsentPromptDrafts()}
                  onDraftsChange={keepUnsentDrafts}
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
