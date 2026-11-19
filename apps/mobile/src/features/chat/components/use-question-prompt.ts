import type { AgentPromptResolution, RespondToPromptInput } from "@openbot/contracts/ipc";
import { useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import { answeredPromptResolution, nextUnansweredQuestion } from "@/features/chat/model/question-prompt";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";

interface PromptState {
  scope: string;
  index: number;
  answers: Record<string, string[]>;
  drafts: Record<string, string>;
  pending: boolean;
  failedAnswers: Record<string, string[]> | null;
  resolution: AgentPromptResolution | null;
  /** The person chose to answer the current question with the chat composer. */
  replyInChat: boolean;
}

function initialState(scope: string): PromptState {
  return {
    scope,
    index: 0,
    answers: {},
    drafts: {},
    pending: false,
    failedAnswers: null,
    resolution: null,
    replyInChat: false,
  };
}

export function useQuestionPrompt(
  agentId: string,
  message: Extract<ChatMessage, { kind: "question" }> | undefined,
  canSend: boolean,
  respond: (agentId: string, input: RespondToPromptInput) => Promise<void>,
) {
  const scope = JSON.stringify([agentId, message?.id]);
  const [stored, setState] = useState(() => initialState(scope));
  // A new form never inherits drafts (especially private answers) from its predecessor.
  const state = stored.scope === scope ? stored : initialState(scope);
  if (stored.scope !== scope) setState(state);
  const submitting = useRef(new Set<string>());
  const prompt = message?.prompt;
  const resolution = prompt?.resolution ?? state.resolution;
  const question = resolution ? undefined : prompt?.questions[state.index];
  const disabled = !canSend || state.pending || Boolean(resolution) || !prompt;
  const messageId = message?.id;

  return useMemo(() => {
    function update(change: Partial<PromptState>): void {
      setState((current) => (current.scope === scope ? { ...current, ...change } : current));
    }

    async function send(answers: Record<string, string[]>): Promise<void> {
      if (disabled || !prompt || submitting.current.has(scope))
        throw new Error(currentText().t("mobile.chat.question.sendFailed"));
      submitting.current.add(scope);
      update({ pending: true, failedAnswers: null });
      try {
        await respond(agentId, { requestId: prompt.requestId, answers });
        update({ resolution: answeredPromptResolution(prompt.questions, answers), answers: {}, drafts: {} });
      } finally {
        submitting.current.delete(scope);
        update({ pending: false });
      }
    }

    async function submit(answers: Record<string, string[]>): Promise<void> {
      if (disabled || !prompt || submitting.current.has(scope)) return;
      await send(answers).then(
        () => void haptics.notification("success"),
        () => {
          void haptics.notification("error");
          update({ failedAnswers: answers });
        },
      );
    }

    function answer(values: string[]): void {
      if (disabled || !question || !prompt || submitting.current.has(scope)) return;
      const answers = { ...state.answers, [question.id]: values };
      const next = nextUnansweredQuestion(prompt.questions, answers, state.index);
      update({
        answers,
        drafts: { ...state.drafts, [question.id]: "" },
        failedAnswers: null,
        index: next ?? state.index,
        replyInChat: false,
      });
      if (next === null) void submit(answers);
    }

    return {
      messageId,
      index: state.index,
      question,
      resolution,
      disabled,
      pending: state.pending,
      failedAnswers: state.failedAnswers,
      draft: question ? (state.drafts[question.id] ?? "") : "",
      setDraft: (text: string) => {
        if (question && !disabled) update({ drafts: { ...state.drafts, [question.id]: text } });
      },
      replyInChat: state.replyInChat,
      setReplyInChat: (replyInChat: boolean) => {
        if (disabled) return;
        void haptics.selection();
        update({ replyInChat });
      },
      setIndex: (index: number) => {
        if (disabled || !prompt?.questions[index]) return;
        void haptics.selection();
        update({ index, replyInChat: false });
      },
      answer,
      submit,
      send,
    };
  }, [scope, messageId, state, question, resolution, disabled, prompt, respond, agentId]);
}

export type QuestionPromptController = ReturnType<typeof useQuestionPrompt>;
