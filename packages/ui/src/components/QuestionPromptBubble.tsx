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

export interface QuestionPromptComposerAnswer {
  available: () => boolean;
  answer: (text: string) => boolean;
}

export interface QuestionPromptBubbleProps {
  questions: AgentPromptQuestion[];
  pending?: boolean;
  readOnly?: boolean;
  resolution?: AgentPromptResolution | null;
  elementRef?: (element: HTMLDivElement | undefined) => void;
  sendShortcut?: SendShortcut | undefined;
  onSubmit: (answers: Record<string, string[]>) => Promise<boolean>;
  onResolutionPresented?: () => void;
  onOpenLink: (url: string) => void;
  registerComposerAnswer?: ((answer: QuestionPromptComposerAnswer) => () => void) | undefined;
}

const PICK_HOLD_MS = 180;
const CHOICE_ARROW_STEPS: Partial<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

const queuedStageFits: Array<() => (() => void) | undefined> = [];

function moveChoiceFocus(input: HTMLInputElement, step: number): boolean {
  const group = input.closest('[role="radiogroup"]');
  if (!group) return false;
  const choices = Array.from(
    group.querySelectorAll<HTMLInputElement>('input[type="radio"]:enabled, input.question-prompt-custom-input:enabled'),
  );
  const current = choices.indexOf(input);
  if (current < 0 || choices.length < 2) return false;
  choices[(current + step + choices.length) % choices.length]?.focus();
  return true;
}

function queueStageFit(measure: () => (() => void) | undefined): void {
  if (queuedStageFits.length === 0) {
    queueMicrotask(() => {
      const writes = queuedStageFits.splice(0).map((queued) => queued());
      for (const write of writes) write?.();
    });
  }
  queuedStageFits.push(measure);
}

function acceptsComposerAnswer(question: AgentPromptQuestion): boolean {
  return !question.isSecret && question.id !== MCP_ELICITATION_DECISION_QUESTION_ID;
}

const optionLetter = (index: number) => String.fromCharCode(65 + index);

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

function QuestionText(props: { question: string; onOpenLink: (url: string) => void }) {
  return (
    <MarkdownInlineText body={props.question} agents={[]} onSelectAgent={() => {}} onOpenLink={props.onOpenLink} />
  );
}

type PagePosition = "prev" | "current" | "next";

interface PromptState {
  step: number;
  picks: Record<string, string[]>;
  drafts: Record<string, string>;
  submitting: boolean;
  announced: string;
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
  let card: HTMLDivElement | undefined;
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

  function measureStage(step = resolved() ? total() : state.step): (() => void) | undefined {
    const target = stage;
    const page = target?.children[step];
    if (!target?.isConnected || !(page instanceof HTMLElement)) return undefined;
    const height = `${page.offsetHeight}px`;
    return () => {
      target.style.height = height;
    };
  }

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
    const toOption = keepFocus && document.activeElement?.matches(":focus-visible") === true;
    const question = props.questions[next];
    setState((draft) => {
      draft.step = next;
      draft.announced = keepFocus || !question ? "" : markdownPlainText(question.question);
    });
    fitStage(next);
    if (keepFocus) {
      queueMicrotask(() => {
        const page = stage?.children[next];
        const selectedInput =
          question && !question.multiSelect && state.drafts[question.id]?.trim()
            ? ".question-prompt-custom-input"
            : "input:checked";
        const target =
          question && toOption
            ? (page?.querySelector<HTMLElement>(selectedInput) ?? page?.querySelector<HTMLElement>("input"))
            : null;
        (target ?? stage)?.focus({ preventScroll: true });
      });
    }
    if (next < total()) queueMicrotask(revealCardTop);
  }

  function revealCardTop(): void {
    const scroller = card && scrollingAncestor(card);
    if (card && scroller && card.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
      card.scrollIntoView({ block: "start" });
    }
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
    window.clearTimeout(holdTimer);
    setState((draft) => {
      draft.drafts[question.id] = value;
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
    if (target instanceof Element && target.closest("a, button")) return;
    const radio = target instanceof HTMLInputElement && target.type === "radio" ? target : null;
    const step = CHOICE_ARROW_STEPS[event.key];
    if (radio && step !== undefined) {
      event.preventDefault();
      moveChoiceFocus(radio, step);
      return;
    }

    const options = question.options ?? [];
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.repeat) return;
      const focusedOption = radio ? options.find((option) => option.label === radio.value) : undefined;
      if (focusedOption) {
        choose(question, page, focusedOption.label);
      } else if (answerOf(question).length > 0) {
        goOn(page);
      }
      return;
    }
    if (event.key.length !== 1) return;
    const optionIndex = event.key.toUpperCase().charCodeAt(0) - 65;
    const option = options[optionIndex];
    if (option) {
      event.preventDefault();
      if (!event.repeat) choose(question, page, option.label);
    } else if (optionIndex === options.length) {
      event.preventDefault();
      event.currentTarget instanceof HTMLElement &&
        event.currentTarget.querySelector<HTMLInputElement>(".question-prompt-custom-input")?.focus();
    }
  }

  function handleCustomKey(event: KeyboardEvent, question: AgentPromptQuestion, page: number): void {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement && moveChoiceFocus(target, event.key === "ArrowUp" ? -1 : 1)) {
        event.preventDefault();
      }
      return;
    }
    const sendShortcut = props.sendShortcut ?? "enter";
    if (sendShortcut === "enter") {
      if (event.key !== "Enter") return;
    } else if (!isSendShortcutKey(event, sendShortcut)) return;
    event.preventDefault();
    if (!event.repeat && answerOf(question).length > 0) goOn(page);
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

  function ClosedOptions(optionsProps: { question: AgentPromptQuestion }) {
    return (
      <Show when={optionsProps.question.options?.length}>
        <ul class="question-prompt-answers">
          <For each={optionsProps.question.options}>
            {(option, optionIndex) => (
              <li class="question-prompt-answer question-prompt-answer-closed">
                <Kbd class="question-prompt-letter" aria-hidden="true">
                  {optionLetter(optionIndex())}
                </Kbd>
                {option.label}
              </li>
            )}
          </For>
        </ul>
      </Show>
    );
  }

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
          </Show>
          <For each={props.questions}>
            {(question) => (
              <section class="question-prompt-section" aria-label={markdownPlainText(question.question)}>
                <h2 class="question-prompt-title">
                  <QuestionText question={question.question} onOpenLink={props.onOpenLink} />
                </h2>
                <Show when={resolution()?.status === "answered"} fallback={<ClosedOptions question={question} />}>
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
                </Show>
              </section>
            )}
          </For>
        </Show>
      </section>
    );
  }

  return (
    <Bubble
      ref={(element) => {
        card = element;
        props.elementRef?.(element);
      }}
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

function scrollingAncestor(element: HTMLElement): HTMLElement | undefined {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
  }
  return undefined;
}
