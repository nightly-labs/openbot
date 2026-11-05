import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentPromptQuestion,
  type AgentPromptResolution,
  MCP_ELICITATION_DECISION_QUESTION_ID,
} from "@openbot/contracts/ipc";
import { Bubble, BubbleContent, Button, Kbd, Questionnaire, Spinner, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createStore, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import { MarkdownInlineText, markdownPlainText } from "../features/conversation/MarkdownMessageText";
import { isSendShortcutKey, type SendShortcut, sendShortcutAriaKey } from "../features/conversation/send-shortcut";

/** Lets the chat composer answer the open question with its text, as the custom answer field does. */
export interface QuestionPromptComposerAnswer {
  /** Whether the current question takes a typed answer from the composer now. */
  available: () => boolean;
  /** Answers the current question with `text`. False when the form cannot take it. */
  answer: (text: string) => boolean;
}

export interface QuestionPromptBubbleProps {
  questions: AgentPromptQuestion[];
  pending?: boolean;
  readOnly?: boolean;
  resolution?: AgentPromptResolution | null;
  elementRef?: (element: HTMLDivElement | undefined) => void;
  /**
   * Which chord submits a custom answer. Enter keeps the current behavior; in the modifier mode
   * plain Enter does not submit and the single-line field adds no line. The renderer resolves
   * the platform and passes it.
   */
  sendShortcut?: SendShortcut | undefined;
  onSubmit: (answers: Record<string, string[]>) => Promise<boolean>;
  onResolutionPresented?: () => void;
  /** Opens a Markdown link of a question. */
  onOpenLink: (url: string) => void;
  /** Gives the composer answer of this form to the composer. The returned function takes it back. */
  registerComposerAnswer?: ((answer: QuestionPromptComposerAnswer) => () => void) | undefined;
}

/** The time a single pick stays on screen before the next question moves in. */
const PICK_HOLD_MS = 180;

const queuedStageFits: Array<() => (() => void) | undefined> = [];

/**
 * Fits the stages of the bubbles that mount together. All read their page heights before any of
 * them writes: a write before the next read lays out the page again, and a chat can open with many
 * question cards.
 */
function queueStageFit(measure: () => (() => void) | undefined): void {
  if (queuedStageFits.length === 0) {
    queueMicrotask(() => {
      const writes = queuedStageFits.splice(0).map((queued) => queued());
      for (const write of writes) write?.();
    });
  }
  queuedStageFits.push(measure);
}

/**
 * A private answer has its own masked field, never the composer. A plugin consent takes only one of
 * its options, so a typed answer would cancel it.
 */
function acceptsComposerAnswer(question: AgentPromptQuestion): boolean {
  return !question.isSecret && question.id !== MCP_ELICITATION_DECISION_QUESTION_ID;
}

const optionLetter = (index: number) => String.fromCharCode(65 + index);

/** The letter of an answer: the letter of its option, or the letter of the typed row. */
function answerLetter(question: AgentPromptQuestion, answer: string): string {
  const options = question.options ?? [];
  const index = options.findIndex((option) => option.label === answer);
  return optionLetter(index === -1 ? options.length : index);
}

function motionDuration(element: HTMLElement, property: string, fallback: number): number {
  if (prefersReducedMotion()) return 0;
  const value = getComputedStyle(element).getPropertyValue(property).trim();
  if (value.endsWith("ms")) return Number.parseFloat(value) || fallback;
  if (value.endsWith("s")) return (Number.parseFloat(value) || fallback / 1_000) * 1_000;
  return fallback;
}

function summaryResolution(questions: AgentPromptQuestion[], answers: Record<string, string[]>): AgentPromptResolution {
  if (Object.keys(answers).length === 0) return { status: "cancelled" };
  return {
    status: "answered",
    responses: Object.fromEntries(
      questions.map((question) => {
        const values = answers[question.id] ?? [];
        if (values.length === 0) return [question.id, { status: "skipped" }];
        return [question.id, question.isSecret ? { status: "answered" } : { status: "answered", answers: [...values] }];
      }),
    ),
  };
}

/** The question text. An agent can write Markdown in it, such as a link. */
function QuestionText(props: { question: string; onOpenLink: (url: string) => void }) {
  return (
    <MarkdownInlineText body={props.question} agents={[]} onSelectAgent={() => {}} onOpenLink={props.onOpenLink} />
  );
}

type PagePosition = "prev" | "current" | "next";

interface PromptState {
  /** The open page. The page after the last question is the summary. */
  step: number;
  /** The ticked options of each question. A single-select question has one at most. */
  picks: Record<string, string[]>;
  /** The typed answer of each question. */
  drafts: Record<string, string>;
  submitting: boolean;
  /** The question that a screen reader announces when the page changes with no focus in the bubble. */
  announced: string;
  /** The answers that this bubble sent, or the cancellation. */
  sent: AgentPromptResolution | null;
}

export function QuestionPromptBubble(props: QuestionPromptBubbleProps) {
  const { t } = useText();
  const total = () => props.questions.length;
  const [state, setState] = createStore<PromptState>({
    step: untrack(() => (props.resolution ? props.questions.length : 0)),
    picks: {},
    drafts: {},
    submitting: false,
    announced: "",
    sent: null,
  });
  const animateEntrance = untrack(() => !props.resolution);
  let stage: HTMLDivElement | undefined;
  let holdTimer: number | undefined;
  let presentTimer: number | undefined;
  let resolutionPresentationPending = false;

  const resolution = () => props.resolution ?? state.sent;
  const resolved = () => resolution() !== null;
  const index = () => Math.min(state.step, Math.max(0, total() - 1));
  const busy = () => Boolean(props.readOnly || props.pending || state.submitting || resolved());
  const position = (page: number): PagePosition => {
    const step = resolved() ? total() : state.step;
    return page < step ? "prev" : page === step ? "current" : "next";
  };

  /** The answer of a question: the ticked options in the order the question lists them, then the typed one. */
  function answerOf(question: AgentPromptQuestion): string[] {
    const typed = state.drafts[question.id]?.trim() ?? "";
    const picked = state.picks[question.id] ?? [];
    if (!question.multiSelect) return typed ? [typed] : picked.slice(0, 1);
    const labels = (question.options ?? []).map((option) => option.label).filter((label) => picked.includes(label));
    return typed ? [...labels, typed] : labels;
  }

  const currentQuestion = () => props.questions[index()];
  const canGoOn = () => {
    const question = currentQuestion();
    return Boolean(question && answerOf(question).length > 0);
  };

  onCleanup(() => {
    window.clearTimeout(holdTimer);
    window.clearTimeout(presentTimer);
    if (resolutionPresentationPending) presentResolution();
    props.elementRef?.(undefined);
  });

  /** Reads the height of the open page and returns the write that gives it to the stage. */
  function measureStage(step = resolved() ? total() : state.step): (() => void) | undefined {
    const target = stage;
    const page = target?.children[step];
    if (!target?.isConnected || !(page instanceof HTMLElement)) return undefined;
    const height = `${page.offsetHeight}px`;
    return () => {
      target.style.height = height;
    };
  }

  /** The stage takes the height of the open page, so the bubble grows and shrinks with it. */
  function fitStage(step?: number) {
    measureStage(step)?.();
  }

  onSettled(() => {
    if (!stage) return;
    const observer = new ResizeObserver(() => fitStage());
    for (const page of Array.from(stage.children)) observer.observe(page);
    queueStageFit(() => measureStage());
    return () => observer.disconnect();
  });

  function goTo(step: number): void {
    window.clearTimeout(holdTimer);
    const next = Math.max(0, Math.min(total(), step));
    const keepFocus = stage?.closest(".question-prompt-bubble")?.contains(document.activeElement) ?? false;
    const question = props.questions[next];
    setState((draft) => {
      draft.step = next;
      // Focus moves into the new page and reads it; an answer from the composer leaves focus there.
      draft.announced = keepFocus || !question ? "" : markdownPlainText(question.question);
    });
    fitStage(next);
    if (!keepFocus) return;
    queueMicrotask(() => {
      const page = stage?.children[next];
      const target =
        next < total()
          ? (page?.querySelector<HTMLElement>("input:checked") ?? page?.querySelector<HTMLElement>("input"))
          : null;
      (target ?? stage)?.focus({ preventScroll: true });
    });
  }

  function presentResolution(): void {
    if (!resolutionPresentationPending) return;
    resolutionPresentationPending = false;
    props.onResolutionPresented?.();
  }

  async function submit(result: Record<string, string[]>): Promise<void> {
    if (busy()) return;
    window.clearTimeout(holdTimer);
    setState((draft) => {
      draft.submitting = true;
    });
    let completed = false;
    try {
      completed = await props.onSubmit(result);
    } catch {
      completed = false;
    }
    setState((draft) => {
      draft.submitting = false;
      if (completed) draft.sent = summaryResolution(props.questions, result);
    });
    if (!completed) return;
    resolutionPresentationPending = true;
    goTo(total());
    const duration = stage ? motionDuration(stage, "--page-slide-dur", 250) : 0;
    presentTimer = window.setTimeout(presentResolution, duration);
  }

  /** Goes to the next question, or sends the answers after the last one. `values` replaces the answer of `page`. */
  function goOn(page: number, values?: string[]): void {
    window.clearTimeout(holdTimer);
    if (busy()) return;
    if (page < total() - 1) {
      goTo(page + 1);
      return;
    }
    void submit(
      Object.fromEntries(
        props.questions.map((question, questionIndex) => [
          question.id,
          questionIndex === page && values ? values : answerOf(question),
        ]),
      ),
    );
  }

  function choose(question: AgentPromptQuestion, page: number, label: string): void {
    if (busy()) return;
    if (question.multiSelect) {
      // The draft has the writes that the store does not show until the next flush.
      setState((draft) => {
        const picked = draft.picks[question.id];
        if (!picked) {
          draft.picks[question.id] = [label];
          return;
        }
        const at = picked.indexOf(label);
        if (at === -1) picked.push(label);
        else picked.splice(at, 1);
      });
      return;
    }
    setState((draft) => {
      draft.picks[question.id] = [label];
      draft.drafts[question.id] = "";
    });
    window.clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => goOn(page, [label]), PICK_HOLD_MS);
  }

  function type(question: AgentPromptQuestion, value: string): void {
    // A typed answer stops the move that a pick started.
    window.clearTimeout(holdTimer);
    setState((draft) => {
      draft.drafts[question.id] = value;
      // A typed answer replaces the pick of a single-select question.
      if (!question.multiSelect && value.trim()) draft.picks[question.id] = [];
    });
  }

  function skip(page: number): void {
    const question = props.questions[page];
    if (!question || busy()) return;
    setState((draft) => {
      draft.picks[question.id] = [];
      draft.drafts[question.id] = "";
    });
    goOn(page, []);
  }

  function composerAnswerAvailable(): boolean {
    const question = currentQuestion();
    return Boolean(question && state.step < total() && acceptsComposerAnswer(question) && !busy());
  }

  /**
   * The text goes in the custom answer field, so it stays there when the send fails. The store does
   * not show the new value until the next flush, so the answer goes to `goOn` too.
   */
  function answerFromComposer(text: string): boolean {
    const page = index();
    const question = props.questions[page];
    const value = text.trim();
    if (!question || !value || value.length > INPUT_LIMITS.promptAnswerText || !composerAnswerAvailable()) return false;
    const picked = question.multiSelect
      ? (question.options ?? []).map((option) => option.label).filter((label) => answerOf(question).includes(label))
      : [];
    type(question, value);
    goOn(page, [...picked, value]);
    return true;
  }

  onSettled(() => props.registerComposerAnswer?.({ available: composerAnswerAvailable, answer: answerFromComposer }));

  function handleShortcut(event: KeyboardEvent, question: AgentPromptQuestion, page: number): void {
    if (busy() || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) return;
    if (target instanceof HTMLInputElement && target.type !== "radio" && target.type !== "checkbox") return;
    // A link in the question text keeps its own keys.
    if (target instanceof Element && target.closest("a, button")) return;
    const options = question.options ?? [];
    if (event.key === "Enter") {
      event.preventDefault();
      if (answerOf(question).length > 0) goOn(page);
      return;
    }
    if (event.key.length !== 1) return;
    const optionIndex = event.key.toUpperCase().charCodeAt(0) - 65;
    const option = options[optionIndex];
    if (option) {
      event.preventDefault();
      choose(question, page, option.label);
    } else if (optionIndex === options.length) {
      event.preventDefault();
      event.currentTarget instanceof HTMLElement &&
        event.currentTarget.querySelector<HTMLInputElement>(".question-prompt-custom-input")?.focus();
    }
  }

  function handleCustomKey(event: KeyboardEvent, question: AgentPromptQuestion, page: number): void {
    // The browser owns the key that commits an IME composition. Safari sends it after
    // `compositionend` without `isComposing`; keyCode 229 marks it.
    if (event.isComposing || event.keyCode === 229) return;
    const sendShortcut = props.sendShortcut ?? "enter";
    // Enter to send keeps the previous chord: every Enter sends.
    if (sendShortcut === "enter") {
      if (event.key !== "Enter") return;
    } else if (!isSendShortcutKey(event, sendShortcut)) return;
    event.preventDefault();
    if (answerOf(question).length > 0) goOn(page);
  }

  function isPicked(question: AgentPromptQuestion, label: string): boolean {
    if (!question.multiSelect && state.drafts[question.id]?.trim()) return false;
    return state.picks[question.id]?.includes(label) ?? false;
  }

  const detail = (question: AgentPromptQuestion) =>
    question.detail ?? (question.multiSelect ? t("prompt.question.chooseAll") : undefined);

  function QuestionPage(pageProps: { question: AgentPromptQuestion; page: number }) {
    const question = () => pageProps.question;
    return (
      <section
        class="question-prompt-page"
        data-pos={position(pageProps.page)}
        inert={position(pageProps.page) !== "current"}
        aria-hidden={position(pageProps.page) !== "current" ? "true" : undefined}
        aria-label={markdownPlainText(question().question)}
        onKeyDown={(event) => handleShortcut(event, question(), pageProps.page)}
      >
        <header class="question-prompt-header">
          <Questionnaire.Title class="question-prompt-title">
            <QuestionText question={question().question} onOpenLink={props.onOpenLink} />
          </Questionnaire.Title>
          <Show when={detail(question())}>
            {(text) => <Questionnaire.Description class="question-prompt-detail">{text()}</Questionnaire.Description>}
          </Show>
        </header>
        <Questionnaire.Choices
          class="question-prompt-options"
          role={question().multiSelect ? "group" : "radiogroup"}
          aria-label={markdownPlainText(question().question)}
        >
          <For each={question().options ?? []}>
            {(option, optionIndex) => (
              <Questionnaire.Choice
                class="question-prompt-option"
                name={question().id}
                value={option.label}
                multiple={question().multiSelect === true}
                checked={isPicked(question(), option.label)}
                disabled={busy()}
                onChange={(value) => choose(question(), pageProps.page, value)}
              >
                <Kbd class="question-prompt-letter" aria-hidden="true">
                  {optionLetter(optionIndex())}
                </Kbd>
                <span class="question-prompt-option-text">
                  <span class="question-prompt-option-label">{option.label}</span>
                  <Show when={option.description}>
                    <span class="question-prompt-option-description">{option.description}</span>
                  </Show>
                </span>
              </Questionnaire.Choice>
            )}
          </For>
          <label
            class="question-prompt-option question-prompt-custom"
            data-checked={state.drafts[question().id]?.trim() ? "" : undefined}
          >
            <Kbd class="question-prompt-letter" aria-hidden="true">
              {optionLetter(question().options?.length ?? 0)}
            </Kbd>
            <Questionnaire.Input
              class="question-prompt-custom-input"
              type={question().isSecret ? "password" : "text"}
              value={state.drafts[question().id] ?? ""}
              placeholder={
                question().isSecret ? t("prompt.question.privatePlaceholder") : t("prompt.question.somethingElse")
              }
              aria-label={t("prompt.question.customAnswerFor", { question: markdownPlainText(question().question) })}
              aria-keyshortcuts={sendShortcutAriaKey(props.sendShortcut ?? "enter")}
              maxlength={INPUT_LIMITS.promptAnswerText}
              disabled={busy()}
              onValueChange={(value) => type(question(), value)}
              onKeyDown={(event) => handleCustomKey(event, question(), pageProps.page)}
            />
          </label>
        </Questionnaire.Choices>
      </section>
    );
  }

  /** The answers of a question in the summary, or null for a skipped question. */
  function summaryRows(question: AgentPromptQuestion): Array<{ letter: string; text: string }> | null {
    const current = resolution();
    if (current?.status !== "answered") return null;
    const response = current.responses[question.id];
    if (!response || response.status === "skipped") return null;
    const custom = optionLetter(question.options?.length ?? 0);
    if (question.isSecret || !response.answers) return [{ letter: custom, text: t("prompt.question.privateAnswer") }];
    if (response.answers.length === 0) return null;
    return response.answers.map((answer) => ({ letter: answerLetter(question, answer), text: answer }));
  }

  const statusTitle = () => {
    const status = resolution()?.status;
    if (status === "cancelled") return t("prompt.question.cancelled");
    if (status === "expired") return t("prompt.question.expired");
    return t("prompt.question.answersSent");
  };

  function Summary() {
    return (
      <section
        class="question-prompt-page question-prompt-summary"
        data-pos={position(total())}
        inert={!resolved()}
        aria-label={resolved() ? statusTitle() : undefined}
      >
        <Show when={resolved()}>
          <Show
            when={resolution()?.status === "answered"}
            fallback={
              <p class="question-prompt-closed" role="status">
                <X aria-hidden="true" />
                {statusTitle()}
              </p>
            }
          >
            <p class="sr-only" role="status">
              {statusTitle()}
            </p>
            <For each={props.questions}>
              {(question) => (
                <section class="question-prompt-section" aria-label={markdownPlainText(question.question)}>
                  <h2 class="question-prompt-title">
                    <QuestionText question={question.question} onOpenLink={props.onOpenLink} />
                  </h2>
                  <Show
                    when={summaryRows(question)}
                    fallback={
                      <p class="question-prompt-answer question-prompt-answer-skipped">
                        <Kbd class="question-prompt-letter" aria-hidden="true">
                          –
                        </Kbd>
                        {t("prompt.question.skipped")}
                      </p>
                    }
                  >
                    {(rows) => (
                      <ul class="question-prompt-answers">
                        <For each={rows()}>
                          {(row) => (
                            <li class="question-prompt-answer">
                              <Kbd class="question-prompt-letter" data-answered="" aria-hidden="true">
                                {row.letter}
                              </Kbd>
                              {row.text}
                            </li>
                          )}
                        </For>
                      </ul>
                    )}
                  </Show>
                </section>
              )}
            </For>
          </Show>
        </Show>
      </section>
    );
  }

  return (
    <Bubble
      ref={(element) => props.elementRef?.(element)}
      variant="muted"
      class="question-prompt-bubble"
      data-state={resolved() ? "done" : busy() ? "pending" : "idle"}
      data-entrance={animateEntrance ? "" : undefined}
    >
      <BubbleContent>
        <Show
          when={total() > 0}
          fallback={
            <section class="question-prompt-empty" aria-label={t("prompt.question.label")}>
              <strong>{t("prompt.question.emptyTitle")}</strong>
              <span>{t("prompt.question.emptyBody")}</span>
            </section>
          }
        >
          <Questionnaire.Root
            class="question-prompt-form"
            current={index() + 1}
            total={total()}
            disabled={busy()}
            aria-label={t("prompt.question.label")}
            onPrevious={() => goTo(index() - 1)}
            onSkip={() => skip(index())}
            onCancel={() => void submit({})}
            onSubmit={(event) => event.preventDefault()}
          >
            <Show when={!resolved()}>
              <Questionnaire.Cancel
                size="icon-xs"
                class="question-prompt-cancel"
                aria-label={t("prompt.question.cancel")}
                title={t("prompt.question.cancel")}
              >
                <X aria-hidden="true" />
              </Questionnaire.Cancel>
            </Show>
            <p class="sr-only" aria-live="polite">
              {resolved() ? "" : state.announced}
            </p>
            <div ref={stage} class="question-prompt-stage" tabindex="-1">
              <For each={props.questions}>{(question, page) => <QuestionPage question={question} page={page()} />}</For>
              <Summary />
            </div>
            <div
              class="question-prompt-fold"
              data-open={resolved() ? "false" : "true"}
              inert={resolved()}
              aria-hidden={resolved() ? "true" : undefined}
            >
              <div class="question-prompt-fold-inner">
                <footer class="question-prompt-footer">
                  <Show when={total() > 1}>
                    <Questionnaire.Progress class="question-prompt-progress">
                      <For each={props.questions}>
                        {(_question, dot) => (
                          <span
                            class="question-prompt-dot"
                            data-state={dot() < index() ? "done" : dot() === index() ? "current" : "next"}
                          />
                        )}
                      </For>
                    </Questionnaire.Progress>
                  </Show>
                  <span class="question-prompt-actions">
                    <Show when={index() > 0}>
                      <Questionnaire.Previous variant="secondary" size="sm" class="question-prompt-pill">
                        {t("common.back")}
                      </Questionnaire.Previous>
                    </Show>
                    <Questionnaire.Skip variant="secondary" size="sm" class="question-prompt-pill">
                      {t("prompt.question.skip")}
                    </Questionnaire.Skip>
                    <Button
                      type="button"
                      size="sm"
                      class="question-prompt-pill"
                      disabled={busy() || !canGoOn()}
                      onClick={() => goOn(index())}
                    >
                      <Show
                        when={state.submitting || props.pending}
                        fallback={index() === total() - 1 ? t("common.done") : t("prompt.question.next")}
                      >
                        <Spinner size="sm" />
                        {t("common.sending")}
                      </Show>
                    </Button>
                  </span>
                </footer>
              </div>
            </div>
          </Questionnaire.Root>
        </Show>
      </BubbleContent>
    </Bubble>
  );
}
