import {
  type ConversationUiBlock,
  type UiBlockResponse,
  type UiBlockState,
  uiBlockAnswersFromResponse,
  uiBlockFallbackQuestions,
  uiBlockOutcomeText,
} from "@openbot/contracts/ui-blocks";
import type { AgentProfile } from "@openbot/ui/data";
import { MarkdownMessageText } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { UiBlockingBlock } from "@openbot/ui/features/conversation/ui-blocks/UiBlockingBlock";
import { useText } from "@openbot/ui/text";
import { createSignal, onCleanup } from "solid-js";
import type { PromptAnswerOptions } from "./conversation-types";

export interface UiBlockPromptProps {
  /** A block the person answers through the prompt it sits beside. */
  block: ConversationUiBlock;
  agents: AgentProfile[];
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  /**
   * Sends the answers to the block's fallback questions through the prompt route. Absent for a block
   * in the history, which only shows its stored state.
   */
  onAnswer?: ((answers: Record<string, string[]>, options?: PromptAnswerOptions) => Promise<boolean>) | undefined;
  /** The answer went through and the card shows it. */
  onAnswered?: (() => void) | undefined;
  /** Gets the card's element, and undefined once the card is gone. */
  elementRef?: ((element: HTMLElement | undefined) => void) | undefined;
}

/**
 * An agent's blocking block as a card. The card's response goes out as the answers to the block's
 * fallback questions, the same way a client that only knows the questions answers, so the host
 * reads both alike. A skip answers every question with nothing.
 */
export function UiBlockPrompt(props: UiBlockPromptProps) {
  const { t, format, errorMessage } = useText();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string>();
  // What this client sent, shown frozen until the host's stored state replaces it.
  const [sent, setSent] = createSignal<UiBlockState>();
  onCleanup(() => props.elementRef?.(undefined));
  const stored = (): UiBlockState =>
    props.block.state.status === "pending" ? (sent() ?? props.block.state) : props.block.state;
  // The host stores the outcome with English list commas; draw it again in the reader's language.
  const state = (): UiBlockState => {
    const current = stored();
    if (current.status !== "answered" || !current.response) return current;
    const outcome = uiBlockOutcomeText(props.block.spec, current.response, format.list);
    return outcome.trim() ? { ...current, outcome } : current;
  };

  async function send(answers: Record<string, string[]>, frozen: UiBlockState): Promise<void> {
    const answer = props.onAnswer;
    if (!answer || busy() || state().status !== "pending") return;
    setBusy(true);
    setError(undefined);
    let failure: string | undefined;
    const fail = (cause: unknown) => {
      failure = errorMessage(cause, t("uiBlock.error.answerFailed"));
    };
    let completed = false;
    try {
      completed = await answer(answers, { onError: fail });
    } catch (cause) {
      fail(cause);
    }
    setBusy(false);
    if (!completed) {
      setError(failure ?? t("uiBlock.error.answerFailed"));
      return;
    }
    setSent(frozen);
    props.onAnswered?.();
  }

  function respond(response: UiBlockResponse): void {
    const spec = props.block.spec;
    const outcome = uiBlockOutcomeText(spec, response);
    void send(uiBlockAnswersFromResponse(spec, response), {
      status: "answered",
      response,
      ...(outcome.trim() ? { outcome } : {}),
    });
  }

  function skip(): void {
    const answers = Object.fromEntries(uiBlockFallbackQuestions(props.block.spec).map((question) => [question.id, []]));
    void send(answers, { status: "closed" });
  }

  return (
    <UiBlockingBlock
      spec={props.block.spec}
      state={state()}
      busy={busy()}
      error={error()}
      disabled={!props.onAnswer}
      onRespond={respond}
      onSkip={props.onAnswer ? skip : undefined}
      elementRef={(element) => props.elementRef?.(element)}
      renderPreview={(markdown) => (
        <div class="message-markdown">
          <MarkdownMessageText
            imagesAsLinks
            body={markdown}
            agents={props.agents}
            onSelectAgent={props.onSelectAgent}
            onOpenLink={props.onOpenLink}
          />
        </div>
      )}
    />
  );
}
