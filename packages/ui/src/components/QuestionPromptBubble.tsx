import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentPromptQuestion, AgentPromptResolution } from "@openbot/contracts/ipc";
import {
  Badge,
  Bubble,
  BubbleContent,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Kbd,
  LoaderCircle,
  PencilLine,
  Questionnaire,
  Spinner,
  X,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";

export interface QuestionPromptBubbleProps {
  questions: AgentPromptQuestion[];
  pending?: boolean;
  readOnly?: boolean;
  resolution?: AgentPromptResolution | null;
  elementRef?: (element: HTMLDivElement | undefined) => void;
  onSubmit: (answers: Record<string, string[]>) => Promise<boolean>;
  onResolutionPresented?: () => void;
}

type QuestionAnswers = Record<string, string>;
type QuestionFlags = Record<string, boolean>;
type PageContent = { kind: "question"; index: number } | { kind: "resolution"; resolution: AgentPromptResolution };

function questionPageContent(content: PageContent): Extract<PageContent, { kind: "question" }> | undefined {
  return content.kind === "question" ? content : undefined;
}

function resolutionPageContent(content: PageContent): Extract<PageContent, { kind: "resolution" }> | undefined {
  return content.kind === "resolution" ? content : undefined;
}

function motionDuration(element: HTMLElement, property: string, fallback: number): number {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
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

function CompletedQuestionPrompt(props: { questions: AgentPromptQuestion[]; resolution: AgentPromptResolution }) {
  const { t } = useText();
  const title = () => {
    if (props.resolution.status === "cancelled") return t("prompt.question.cancelled");
    if (props.resolution.status === "expired") return t("prompt.question.expired");
    return t("prompt.question.answersSent");
  };

  function answerLabel(question: AgentPromptQuestion): string {
    if (props.resolution.status !== "answered") return "";
    const response = props.resolution.responses[question.id];
    if (!response || response.status === "skipped") return t("prompt.question.skipped");
    if (question.isSecret || !response.answers) return t("prompt.question.privateAnswer");
    return response.answers.length > 0 ? response.answers.join(", ") : t("prompt.question.skipped");
  }

  return (
    <section class="question-prompt-complete" aria-label={title()} data-state={props.resolution.status}>
      <header class="question-prompt-complete-header">
        <span class="question-prompt-complete-status" role="status">
          {props.resolution.status === "answered" ? <CircleCheck aria-hidden="true" /> : <X aria-hidden="true" />}
          <strong>{title()}</strong>
        </span>
      </header>

      <Show when={props.resolution.status === "answered"}>
        <ItemGroup class="question-prompt-complete-answers">
          <For each={props.questions}>
            {(question) => (
              <Item size="compact">
                <ItemContent>
                  <ItemDescription>{question.question}</ItemDescription>
                  <ItemTitle>{answerLabel(question)}</ItemTitle>
                </ItemContent>
              </Item>
            )}
          </For>
        </ItemGroup>
      </Show>
    </section>
  );
}

export function QuestionPromptBubble(props: QuestionPromptBubbleProps) {
  const { t } = useText();
  const initialContent = (): PageContent | null => {
    if (props.resolution) return { kind: "resolution", resolution: props.resolution };
    return props.questions.length > 0 ? { kind: "question", index: 0 } : null;
  };
  const initialPage = untrack(initialContent);
  const [step, setStep] = createSignal(0);
  const [answers, setAnswers] = createSignal<QuestionAnswers>({});
  const [customAnswers, setCustomAnswers] = createSignal<QuestionFlags>({});
  const [customDrafts, setCustomDrafts] = createSignal<QuestionAnswers>({});
  const [skipped, setSkipped] = createSignal<QuestionFlags>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [transitioning, setTransitioning] = createSignal(false);
  const [activeSlot, setActiveSlot] = createSignal<0 | 1>(0);
  const [visiblePage, setVisiblePage] = createSignal<1 | 2>(1);
  const [slotPages, setSlotPages] = createSignal<[PageContent | null, PageContent | null]>([initialPage, null]);
  const [slotPageIds, setSlotPageIds] = createSignal<[1 | 2, 1 | 2]>([1, 2]);
  const customInputs = new Map<string, HTMLInputElement>();
  const pageElements: Array<HTMLElement | undefined> = [];
  let stage: HTMLDivElement | undefined;
  let transitionTimer: number | undefined;
  let queuedInteraction: (() => void) | undefined;
  let resolutionPresentationPending = false;

  const questionCount = () => props.questions.length;
  const showingResolution = () => slotPages()[activeSlot()]?.kind === "resolution";
  const interactionDisabled = () =>
    Boolean(props.readOnly || props.pending || submitting() || props.resolution || showingResolution());
  const busy = () => Boolean(interactionDisabled() || transitioning());

  onCleanup(() => {
    if (transitionTimer !== undefined) window.clearTimeout(transitionTimer);
    queuedInteraction = undefined;
    if (resolutionPresentationPending) presentResolution();
    props.elementRef?.(undefined);
  });

  createEffect(
    () => ({ count: questionCount(), resolution: props.resolution, step: step() }),
    ({ count, resolution, step: currentStep }) => {
      if (count === 0 || resolution) return;
      if (currentStep >= count) setStep(Math.max(0, count - 1));
    },
  );

  function transitionTo(content: PageContent, direction: "forward" | "back", after?: () => void): void {
    if (transitioning() || !stage) return;
    const fromHeight = stage.getBoundingClientRect().height;
    stage.dataset.preparing = "";
    stage.style.height = `${fromHeight}px`;
    const fromSlot = activeSlot();
    const toSlot: 0 | 1 = fromSlot === 0 ? 1 : 0;
    const fromPageId = direction === "forward" ? 1 : 2;
    const toPageId = direction === "forward" ? 2 : 1;
    setTransitioning(true);
    setSlotPages((current) => {
      const next: [PageContent | null, PageContent | null] = [...current];
      next[toSlot] = content;
      return next;
    });
    setSlotPageIds((current) => {
      const next: [1 | 2, 1 | 2] = [...current];
      next[fromSlot] = fromPageId;
      next[toSlot] = toPageId;
      return next;
    });
    setVisiblePage(fromPageId);

    queueMicrotask(() => {
      if (!stage) return;
      const toElement = pageElements[toSlot];
      void stage.offsetHeight;
      delete stage.dataset.preparing;
      if (toElement) stage.style.height = `${toElement.scrollHeight}px`;
      setVisiblePage(toPageId);
      const duration = motionDuration(stage, "--page-slide-dur", 250);
      const finishTransition = () => {
        setActiveSlot(toSlot);
        setSlotPages((current) => {
          const next: [PageContent | null, PageContent | null] = [...current];
          next[fromSlot] = null;
          return next;
        });
        setTransitioning(false);
        transitionTimer = undefined;
        stage?.style.removeProperty("height");
        after?.();
        const interaction = queuedInteraction;
        queuedInteraction = undefined;
        if (interaction) queueMicrotask(interaction);
      };
      if (duration === 0) finishTransition();
      else transitionTimer = window.setTimeout(finishTransition, duration);
    });
  }

  function performWhenReady(action: () => void): void {
    if (interactionDisabled()) return;
    if (transitioning()) {
      queuedInteraction = () => performWhenReady(action);
      return;
    }
    action();
  }

  function moveTo(target: number): void {
    performWhenReady(() => {
      const next = Math.max(0, Math.min(questionCount() - 1, target));
      if (next === step()) return;
      const direction = next > step() ? "forward" : "back";
      setStep(next);
      transitionTo({ kind: "question", index: next }, direction, () => {
        const question = props.questions[next];
        if (!question) return;
        queueMicrotask(() => {
          if (!question.options?.length || customAnswers()[question.id]) {
            customInputs.get(question.id)?.focus();
            return;
          }
          const page = pageElements[activeSlot()];
          (
            page?.querySelector<HTMLInputElement>(".ui-questionnaire-choice-input:checked") ??
            page?.querySelector<HTMLInputElement>(".ui-questionnaire-choice-input:not(:disabled)")
          )?.focus();
        });
      });
    });
  }

  function isResolved(question: AgentPromptQuestion, nextAnswers = answers(), nextSkipped = skipped()): boolean {
    return Boolean(nextSkipped[question.id] || nextAnswers[question.id]?.trim());
  }

  function resultFor(nextAnswers: QuestionAnswers, nextSkipped: QuestionFlags): Record<string, string[]> {
    return Object.fromEntries(
      props.questions.map((question) => [
        question.id,
        nextSkipped[question.id] ? [] : [nextAnswers[question.id]?.trim() ?? ""],
      ]),
    );
  }

  function nextUnresolvedIndex(currentIndex: number, nextAnswers: QuestionAnswers, nextSkipped: QuestionFlags): number {
    for (let offset = 1; offset <= questionCount(); offset += 1) {
      const candidate = (currentIndex + offset) % questionCount();
      const question = props.questions[candidate];
      if (question && !isResolved(question, nextAnswers, nextSkipped)) return candidate;
    }
    return -1;
  }

  async function submit(result: Record<string, string[]>): Promise<void> {
    if (busy()) return;
    setSubmitting(true);
    let completed = false;
    try {
      completed = await props.onSubmit(result);
    } catch {
      completed = false;
    }
    setSubmitting(false);
    if (!completed) return;
    resolutionPresentationPending = true;
    transitionTo({ kind: "resolution", resolution: summaryResolution(props.questions, result) }, "forward", () =>
      presentResolution(),
    );
  }

  function presentResolution(): void {
    if (!resolutionPresentationPending) return;
    resolutionPresentationPending = false;
    props.onResolutionPresented?.();
  }

  function finishQuestion(questionIndex: number, nextAnswers: QuestionAnswers, nextSkipped: QuestionFlags): void {
    setAnswers(nextAnswers);
    setSkipped(nextSkipped);
    const unresolvedIndex = nextUnresolvedIndex(questionIndex, nextAnswers, nextSkipped);
    if (unresolvedIndex === -1) {
      void submit(resultFor(nextAnswers, nextSkipped));
      return;
    }
    moveTo(unresolvedIndex);
  }

  function chooseOption(question: AgentPromptQuestion, questionIndex: number, value: string): void {
    performWhenReady(() => {
      const nextAnswers = { ...answers(), [question.id]: value };
      const nextSkipped = { ...skipped(), [question.id]: false };
      setCustomAnswers((current) => ({ ...current, [question.id]: false }));
      finishQuestion(questionIndex, nextAnswers, nextSkipped);
    });
  }

  function commitCustomAnswer(question: AgentPromptQuestion, questionIndex: number): void {
    performWhenReady(() => {
      const value = customDrafts()[question.id]?.trim() ?? "";
      if (!value) return;
      const nextAnswers = { ...answers(), [question.id]: value };
      const nextSkipped = { ...skipped(), [question.id]: false };
      setCustomAnswers((current) => ({ ...current, [question.id]: true }));
      finishQuestion(questionIndex, nextAnswers, nextSkipped);
    });
  }

  function skipQuestion(question: AgentPromptQuestion, questionIndex: number): void {
    performWhenReady(() => finishQuestion(questionIndex, answers(), { ...skipped(), [question.id]: true }));
  }

  function handleShortcut(event: KeyboardEvent, question: AgentPromptQuestion, questionIndex: number): void {
    if (busy() || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    const optionIndex = event.key.toUpperCase().charCodeAt(0) - 65;
    const option = question.options?.[optionIndex];
    if (!option || event.key.length !== 1) return;
    event.preventDefault();
    chooseOption(question, questionIndex, option.label);
  }

  function PromptNavigation() {
    return (
      <Questionnaire.Root
        current={step() + 1}
        total={questionCount()}
        disabled={busy()}
        class="question-prompt-navigation-root"
        aria-label={t("prompt.question.controls")}
        onPrevious={() => moveTo(step() - 1)}
        onNext={() => moveTo(step() + 1)}
        onCancel={() => performWhenReady(() => void submit({}))}
        onSubmit={(event) => event.preventDefault()}
      >
        <nav class="question-prompt-navigation" aria-label={t("prompt.question.navigation")}>
          <Questionnaire.Previous
            size="icon-xs"
            class="question-prompt-navigation-button"
            aria-label={t("prompt.question.previous")}
            title={t("prompt.question.previous")}
          >
            <ChevronLeft aria-hidden="true" />
          </Questionnaire.Previous>
          <Questionnaire.Progress>
            {t("prompt.question.progress", { current: step() + 1, total: questionCount() })}
          </Questionnaire.Progress>
          <Questionnaire.Next
            variant="ghost"
            size="icon-xs"
            class="question-prompt-navigation-button"
            aria-label={t("prompt.question.next")}
            title={t("prompt.question.next")}
          >
            <ChevronRight aria-hidden="true" />
          </Questionnaire.Next>
          <Questionnaire.Cancel
            size="icon-xs"
            class="question-prompt-navigation-button question-prompt-cancel"
            aria-label={t("prompt.question.cancel")}
            title={t("prompt.question.cancel")}
          >
            <X aria-hidden="true" />
          </Questionnaire.Cancel>
        </nav>
      </Questionnaire.Root>
    );
  }

  function QuestionPage(pageProps: { index: number }) {
    const question = () => props.questions[pageProps.index];
    return (
      <Show when={question()}>
        {(current) => (
          <Questionnaire.Root
            current={pageProps.index + 1}
            total={questionCount()}
            disabled={busy()}
            aria-label={t("prompt.question.label")}
            onPrevious={() => moveTo(pageProps.index - 1)}
            onNext={() => moveTo(pageProps.index + 1)}
            onSkip={() => skipQuestion(current(), pageProps.index)}
            onCancel={() => void submit({})}
            onKeyDown={(event) => handleShortcut(event, current(), pageProps.index)}
            onSubmit={(event) => event.preventDefault()}
          >
            <header class="question-prompt-header conversation-interaction-header">
              <Questionnaire.Title>{current().question}</Questionnaire.Title>
              <Badge variant="warning-light" class="conversation-interaction-status">
                <LoaderCircle class="conversation-interaction-spinner" data-icon="inline-start" aria-hidden="true" />
                {t("prompt.inputRequired")}
              </Badge>
            </header>
            <Questionnaire.Choices role="radiogroup" aria-label={current().question}>
              <ItemGroup class="question-prompt-options">
                <For each={current().options ?? []}>
                  {(option, optionIndex) => (
                    <Questionnaire.Choice
                      name={current().id}
                      value={option.label}
                      checked={answers()[current().id] === option.label && !customAnswers()[current().id]}
                      disabled={busy()}
                      onChange={(value) => chooseOption(current(), pageProps.index, value)}
                    >
                      <Item size="compact">
                        <ItemMedia>
                          <Kbd aria-hidden="true">{String.fromCharCode(65 + optionIndex())}</Kbd>
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{option.label}</ItemTitle>
                          <Show when={option.description}>
                            <ItemDescription>{option.description}</ItemDescription>
                          </Show>
                        </ItemContent>
                        <span class="question-prompt-choice-arrow" aria-hidden="true">
                          <ChevronRight />
                        </span>
                      </Item>
                    </Questionnaire.Choice>
                  )}
                </For>

                <div class="question-prompt-custom-row" data-selected={customAnswers()[current().id] ? "" : undefined}>
                  <span class="question-prompt-pencil">
                    <PencilLine aria-hidden="true" />
                  </span>
                  <Questionnaire.Input
                    ref={(element) => customInputs.set(current().id, element)}
                    type={current().isSecret ? "password" : "text"}
                    value={customDrafts()[current().id] ?? ""}
                    placeholder={
                      current().isSecret ? t("prompt.question.privatePlaceholder") : t("prompt.customPlaceholder")
                    }
                    aria-label={t("prompt.question.customAnswerFor", { question: current().question })}
                    maxlength={INPUT_LIMITS.promptAnswerText}
                    disabled={busy()}
                    onValueChange={(value) => setCustomDrafts((drafts) => ({ ...drafts, [current().id]: value }))}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      commitCustomAnswer(current(), pageProps.index);
                    }}
                  />
                  <div class="question-prompt-inline-actions">
                    <Show when={submitting() || props.pending}>
                      <span class="question-prompt-sending" role="status">
                        <Spinner size="sm" />
                        {t("common.sending")}
                      </span>
                    </Show>
                    <Questionnaire.Skip size="xs">{t("prompt.question.skip")}</Questionnaire.Skip>
                  </div>
                </div>
              </ItemGroup>
            </Questionnaire.Choices>
          </Questionnaire.Root>
        )}
      </Show>
    );
  }

  return (
    <Bubble
      ref={(element) => props.elementRef?.(element)}
      variant="muted"
      class="question-prompt-bubble"
      data-state={busy() ? "pending" : "idle"}
    >
      <BubbleContent class="conversation-interaction-card">
        <Show
          when={initialContent()}
          fallback={
            <section class="question-prompt-empty" aria-label={t("prompt.question.label")}>
              <strong>{t("prompt.question.emptyTitle")}</strong>
              <span>{t("prompt.question.emptyBody")}</span>
            </section>
          }
        >
          <div class="question-prompt-layout">
            <div
              ref={stage}
              class="question-prompt-stage t-page-slide"
              data-page={visiblePage()}
              data-transitioning={transitioning() ? "" : undefined}
              aria-live="polite"
            >
              <For each={[0, 1] as const}>
                {(slot) => (
                  <section
                    ref={(element) => {
                      pageElements[slot] = element;
                    }}
                    class="question-prompt-page t-page"
                    data-page-id={slotPageIds()[slot]}
                    aria-hidden={visiblePage() === slotPageIds()[slot] ? undefined : "true"}
                  >
                    <Show when={slotPages()[slot]}>
                      {(content) => (
                        <Show
                          when={questionPageContent(content())}
                          fallback={
                            <Show when={resolutionPageContent(content())}>
                              {(resolutionPage) => (
                                <CompletedQuestionPrompt
                                  questions={props.questions}
                                  resolution={resolutionPage().resolution}
                                />
                              )}
                            </Show>
                          }
                        >
                          {(questionPage) => <QuestionPage index={questionPage().index} />}
                        </Show>
                      )}
                    </Show>
                  </section>
                )}
              </For>
            </div>
            <Show when={slotPages()[activeSlot()]?.kind === "question"}>
              <PromptNavigation />
            </Show>
          </div>
        </Show>
      </BubbleContent>
    </Bubble>
  );
}
