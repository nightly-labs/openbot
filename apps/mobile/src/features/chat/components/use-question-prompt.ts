import type { AgentPromptResolution, RespondToPromptInput } from "@openbot/contracts/ipc";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/features/chat/model/chat-messages";
import { answeredPromptResolution, nextUnansweredQuestion } from "@/features/chat/model/question-prompt";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";

interface PromptState {
  scope: string;
  index: number;
  answers: Record<string, string[]>;
  drafts: Record<string, string>;
  picks: Record<string, string[]>;
  pending: boolean;
  failedAnswers: Record<string, string[]> | null;
  resolution: AgentPromptResolution | null;
  replyInChat: boolean;
}

function initialState(scope: string): PromptState {
  return {
    scope,
    index: 0,
    answers: {},
    drafts: {},
    picks: {},
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
  onUnsentPreview?: (text: string) => void,
  automaticAnswer = false,
) {
  const scope = JSON.stringify([agentId, message?.id]);
  const [stored, setState] = useState(() => initialState(scope));
  const state = stored.scope === scope ? stored : initialState(scope);
  if (stored.scope !== scope) setState(state);
  const submitting = useRef(new Set<string>());
  const unsentPreview = useRef<{ scope: string; text: string } | undefined>(undefined);
  useEffect(() => {
    const unsent = unsentPreview.current;
    if (!unsent || unsent.scope === scope) return;
    unsentPreview.current = undefined;
    onUnsentPreview?.(unsent.text);
  }, [scope, onUnsentPreview]);
  const prompt = message?.prompt;
  const resolution = prompt?.resolution ?? state.resolution;
  const question = resolution ? undefined : prompt?.questions[state.index];
  const disabled = !canSend || state.pending || Boolean(resolution) || !prompt;
  const messageId = message?.id;

  return useMemo(() => {
    const picked = question?.multiSelect
      ? (question.options ?? [])
          .map((option) => option.label)
          .filter((label) => state.picks[question.id]?.includes(label))
      : [];
    function update(change: Partial<PromptState>): void {
      setState((current) => (current.scope === scope ? { ...current, ...change } : current));
    }

    async function send(answers: Record<string, string[]>): Promise<void> {
      if (disabled || !prompt || submitting.current.has(scope))
        throw new Error(currentText().t("mobile.chat.question.sendFailed"));
      submitting.current.add(scope);
      update({ pending: true, failedAnswers: null });
      const unsent = unsentPreview.current;
      unsentPreview.current = undefined;
      try {
        await respond(agentId, { requestId: prompt.requestId, answers });
        update({ resolution: answeredPromptResolution(prompt.questions, answers), answers: {}, drafts: {}, picks: {} });
      } catch (error) {
        unsentPreview.current ??= unsent;
        throw error;
      } finally {
        submitting.current.delete(scope);
        update({ pending: false });
      }
    }

    async function submit(answers: Record<string, string[]>): Promise<boolean> {
      if (disabled || !prompt || submitting.current.has(scope)) return false;
      return send(answers).then(
        () => {
          void haptics.notification("success");
          return true;
        },
        () => {
          void haptics.notification("error");
          update({ failedAnswers: answers });
          return false;
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

    function togglePick(label: string): void {
      if (disabled || !question?.multiSelect) return;
      void haptics.selection();
      const current = state.picks[question.id] ?? [];
      const picks = current.includes(label) ? current.filter((item) => item !== label) : [...current, label];
      update({ picks: { ...state.picks, [question.id]: picks }, failedAnswers: null });
    }

    function answerText(text: string): void {
      answer([...picked, text]);
    }

    return {
      agentId,
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
      setUnsentPreview: (text: string | undefined) => {
        unsentPreview.current = text === undefined ? undefined : { scope, text };
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
      picked,
      togglePick,
      answer,
      answerText,
      submit,
      send,
      automaticAnswer,
    };
  }, [scope, messageId, state, question, resolution, disabled, prompt, respond, agentId, automaticAnswer]);
}

export type QuestionPromptController = ReturnType<typeof useQuestionPrompt>;
