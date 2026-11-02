import { AGENT_CONTEXT_CATEGORIES, type AgentContextCategory, type AgentContextState } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  CircleCheck,
  LoaderCircle,
  Marker,
  MarkerContent,
  MessageCirclePlus,
  Minimize2,
  Popover,
  RadialProgress,
  type RadialProgressTone,
  TriangleAlert,
} from "@openbot/ui";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentNewChatDialog } from "./AgentNewChatDialog";
import { CloseIcon } from "./ConversationIcons";
import { formatChatTimestamp } from "./chat-timestamp";

export interface ContextUsageView {
  usedTokens: number;
  windowTokens: number;
  /**
   * The share of the window (0-1) at which the thread compacts without a request.
   * Null when nothing compacts this thread on its own.
   */
  autoCompactAt: number | null;
  nativeManaged?: boolean;
  estimated?: boolean;
  compacting: boolean;
  lastCompaction?: { beforeTokens: number; afterTokens: number } | undefined;
  /** What fills `usedTokens`. Absent when the provider gives only a total. */
  categories?: readonly { category: AgentContextCategory; tokens: number }[] | undefined;
}

/** The meter's view of a thread's context state, or undefined when its provider reported no usage. */
export function contextUsageView(state: AgentContextState | undefined): ContextUsageView | undefined {
  const usage = state?.usage;
  if (!usage) return undefined;
  const compaction = state.compaction;
  return {
    ...usage,
    compacting: compaction?.status === "running",
    ...(compaction?.status === "completed" &&
    compaction.beforeTokens !== undefined &&
    compaction.afterTokens !== undefined
      ? { lastCompaction: { beforeTokens: compaction.beforeTokens, afterTokens: compaction.afterTokens } }
      : {}),
  };
}

const CATEGORY_LABEL = {
  systemPrompt: "composer.context.category.systemPrompt",
  memoryFiles: "composer.context.category.memoryFiles",
  tools: "composer.context.category.tools",
  skills: "composer.context.category.skills",
  toolResults: "composer.context.category.toolResults",
  messages: "composer.context.category.messages",
  other: "composer.context.category.other",
} as const satisfies Record<AgentContextCategory, AppTextKey>;

/** The rows with tokens, in the fixed order that also gives each its colour. */
function categoryRows(usage: ContextUsageView): { category: AgentContextCategory; tokens: number }[] {
  const rows = usage.categories ?? [];
  return AGENT_CONTEXT_CATEGORIES.flatMap((category) => {
    const tokens = rows.find((row) => row.category === category)?.tokens ?? 0;
    return tokens > 0 ? [{ category, tokens }] : [];
  });
}

function usedShare(usage: ContextUsageView): number {
  return usage.windowTokens > 0 ? Math.min(1, Math.max(0, usage.usedTokens / usage.windowTokens)) : 0;
}

/*
 * Below half the window the ring stays as quiet as the other toolbar icons: the reader has nothing to
 * do. It takes the warning colour 10 points before the compaction point, and the danger colour only
 * when nothing will compact the thread and it is nearly full.
 */
function meterLevel(usage: ContextUsageView): "quiet" | "normal" | RadialProgressTone {
  const share = usedShare(usage);
  if (!usage.nativeManaged && usage.autoCompactAt === null && share >= 0.9) return "danger";
  if (share >= (usage.autoCompactAt ?? 0.9) - 0.1) return "warning";
  return share < 0.5 ? "quiet" : "normal";
}

/**
 * The composer's context ring and the popover it opens. It shows how full the agent's provider
 * thread is and when it compacts. `newChat` adds the New chat action, which asks first. `compact`
 * adds the Compact action, for a thread that OpenBot compacts (`autoCompactAt` is set).
 */
export function ContextUsageMeter(props: {
  usage: ContextUsageView;
  newChat?:
    | {
        agent: Pick<AgentProfile, "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;
        start: () => Promise<void>;
      }
    | undefined;
  compact?: (() => Promise<void>) | undefined;
}) {
  const { t, format, errorMessage } = useText();
  const [open, setOpen] = createSignal(false);
  const [compaction, setCompaction] = createSignal<
    { phase: "idle" } | { phase: "requesting" } | { phase: "refused"; message: string }
  >({ phase: "idle" });
  const compact = () => (props.usage.autoCompactAt === null ? undefined : props.compact);
  const compactError = () => {
    const current = compaction();
    return current.phase === "refused" ? current.message : null;
  };
  const requestCompaction = async (start: () => Promise<void>) => {
    setCompaction({ phase: "requesting" });
    try {
      await start();
      setCompaction({ phase: "idle" });
      setOpen(false);
    } catch (error) {
      setCompaction({ phase: "refused", message: errorMessage(error, t("composer.context.compactFailed")) });
    }
  };
  const [confirming, setConfirming] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLElement>();
  const percent = () => format.percent(usedShare(props.usage), { maximumFractionDigits: 0 });
  const level = () => meterLevel(props.usage);
  const ringTone = (): RadialProgressTone => {
    const current = level();
    return current === "quiet" || current === "normal" ? "accent" : current;
  };
  let popover: HTMLElement | undefined;
  return (
    <>
      <Popover.Root
        open={open()}
        onOpenChange={(next) => {
          // A refusal belongs to the moment it happened: the turn it waited for can end meanwhile.
          if (next && compaction().phase === "refused") setCompaction({ phase: "idle" });
          setOpen(next);
        }}
        placement="top-end"
        gutter={8}
      >
        <Popover.Trigger
          ref={setTrigger}
          class="composer-button context-meter-trigger"
          aria-label={
            props.usage.compacting
              ? t("composer.context.labelCompacting")
              : t(props.usage.estimated ? "composer.context.labelEstimated" : "composer.context.label", {
                  percent: percent(),
                })
          }
        >
          <RadialProgress
            class="context-meter-ring"
            aria-hidden="true"
            value={props.usage.compacting ? 28 : usedShare(props.usage) * 100}
            tone={ringTone()}
            data-level={level()}
            data-compacting={props.usage.compacting ? "" : undefined}
          />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content ref={(element) => (popover = element)} class="ui-popover-menu-surface context-meter-popover">
            <ContentExitMotion panel={() => popover} />
            <header class="context-meter-header">
              <Popover.Title class="context-meter-title">{t("composer.context.title")}</Popover.Title>
              <span class="context-meter-percent" data-level={level()}>
                {t("composer.context.percent", { percent: percent() })}
              </span>
            </header>
            <ContextUsageBar usage={props.usage} />
            <p class="context-meter-tokens">
              {t(props.usage.estimated ? "composer.context.tokensEstimated" : "composer.context.tokens", {
                used: format.compact(props.usage.usedTokens),
                total: format.compact(props.usage.windowTokens),
              })}
            </p>
            <Show when={categoryRows(props.usage).length > 0}>
              <ul class="context-meter-categories" aria-label={t("composer.context.breakdown")}>
                <For each={categoryRows(props.usage)}>
                  {(row) => (
                    <li class="context-meter-category" data-category={row.category}>
                      <span class="context-meter-swatch" aria-hidden="true" />
                      <span class="context-meter-category-label">{t(CATEGORY_LABEL[row.category])}</span>
                      <span class="context-meter-category-tokens">{format.compact(row.tokens)}</span>
                    </li>
                  )}
                </For>
                <li class="context-meter-category" data-category="free">
                  <span class="context-meter-swatch" aria-hidden="true" />
                  <span class="context-meter-category-label">{t("composer.context.category.free")}</span>
                  <span class="context-meter-category-tokens">
                    {format.compact(Math.max(0, props.usage.windowTokens - props.usage.usedTokens))}
                  </span>
                </li>
              </ul>
            </Show>
            <Popover.Description class="context-meter-note">
              <Show
                when={props.usage.autoCompactAt}
                fallback={t(props.usage.nativeManaged ? "composer.context.nativeAuto" : "composer.context.noAuto")}
              >
                {(at) => (
                  <>{t("composer.context.autoAt", { percent: format.percent(at(), { maximumFractionDigits: 0 }) })}</>
                )}
              </Show>
              <Show when={props.usage.lastCompaction}>
                {(last) => (
                  <>
                    {" "}
                    {t("composer.context.lastCompaction", {
                      before: format.compact(last().beforeTokens),
                      after: format.compact(last().afterTokens),
                    })}
                  </>
                )}
              </Show>
            </Popover.Description>
            <Show when={compactError()}>
              {(message) => (
                <p class="context-meter-note" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={props.newChat || compact()}>
              {/* Menu rows under a divider: they act on the whole context, so they sit apart from the figures. */}
              <footer class="context-meter-footer">
                <Show when={compact()}>
                  {(start) => (
                    <Button
                      variant="ghost"
                      type="button"
                      class="context-meter-action"
                      disabled={props.usage.compacting || compaction().phase === "requesting"}
                      onClick={() => void requestCompaction(start())}
                    >
                      <Minimize2 aria-hidden="true" />
                      <span>{t("composer.context.compact")}</span>
                    </Button>
                  )}
                </Show>
                <Show when={props.newChat}>
                  <Button
                    variant="ghost"
                    type="button"
                    class="context-meter-action"
                    aria-haspopup="dialog"
                    disabled={props.usage.compacting}
                    onClick={() => {
                      setOpen(false);
                      setConfirming(true);
                    }}
                  >
                    <MessageCirclePlus aria-hidden="true" />
                    <span>{t("composer.newChat.action")}</span>
                  </Button>
                </Show>
              </footer>
            </Show>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Show when={props.newChat}>
        {(newChat) => (
          <AgentNewChatDialog
            agent={newChat().agent}
            open={confirming()}
            onClose={() => setConfirming(false)}
            start={() => newChat().start()}
            restoreFocusTarget={trigger()}
          />
        )}
      </Show>
    </>
  );
}

/**
 * The used share, split by category when the provider gives one, then free space, with a tick where
 * the automatic compaction runs.
 */
function ContextUsageBar(props: { usage: ContextUsageView }) {
  const rows = () => categoryRows(props.usage);
  const rowsTotal = () => rows().reduce((sum, row) => sum + row.tokens, 0);
  return (
    <div class="context-usage-bar" aria-hidden="true">
      <Show
        when={rows().length > 0}
        fallback={
          <Show when={usedShare(props.usage) > 0}>
            <span class="context-usage-segment" data-category="used" style={{ "flex-grow": usedShare(props.usage) }} />
          </Show>
        }
      >
        <For each={rows()}>
          {(row) => (
            <span
              class="context-usage-segment"
              data-category={row.category}
              style={{ "flex-grow": (usedShare(props.usage) * row.tokens) / rowsTotal() }}
            />
          )}
        </For>
      </Show>
      <span class="context-usage-segment" data-category="free" style={{ "flex-grow": 1 - usedShare(props.usage) }} />
      <Show when={props.usage.autoCompactAt}>
        {(at) => <span class="context-usage-threshold" style={{ left: `${at() * 100}%` }} />}
      </Show>
    </div>
  );
}

/** The duration to expect when this agent has not compacted before. */
const DEFAULT_COMPACTION_MS = 30_000;

/** How long the finished state stays: long enough to read the result, short enough not to sit over the reply. */
const COMPACTION_DONE_HOLD_MS = 2_000;

/*
 * Past this multiple of the expected duration, the estimate has stopped near 95% for long enough to
 * look frozen, so the notice shows the elapsed time, which still moves.
 */
const COMPACTION_SLOW_FACTOR = 2;

/*
 * Providers report no compaction progress, so the share is an estimate from the elapsed time. The
 * curve slows as it nears 95% and holds there until the provider reports the end, so a slow
 * compaction never reads as done before it is.
 */
function estimatedCompaction(elapsedMs: number, expectedMs: number): number {
  return 0.95 * (1 - Math.exp((-2.5 * Math.max(0, elapsedMs)) / Math.max(1, expectedMs)));
}

/**
 * The composer notice while the provider compacts the thread. It takes the slab the usage limit and
 * sign-in notices use, because it is the same kind of state: the agent accepts no turn until it ends.
 *
 * `expectedMs` is the agent's last compaction duration. `completed` shows 100% for
 * `COMPACTION_DONE_HOLD_MS`; `failed` stays until the user dismisses it. Either way the notice then
 * slides down under the input and calls `onDone`, and the caller removes it.
 */
export function ComposerCompactionNotice(props: {
  startedAt: number;
  expectedMs?: number | undefined;
  status?: ContextCompactionView["status"] | undefined;
  onDone?: (() => void) | undefined;
}) {
  const { t, format } = useText();
  const [now, setNow] = createSignal(Date.now());
  const [leaving, setLeaving] = createSignal(false);
  const status = () => props.status ?? "running";
  createEffect(status, (current) => {
    setLeaving(false);
    if (current === "completed") {
      const hold = window.setTimeout(() => setLeaving(true), COMPACTION_DONE_HOLD_MS);
      return () => window.clearTimeout(hold);
    }
    if (current === "failed") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  });
  const expectedMs = () => props.expectedMs ?? DEFAULT_COMPACTION_MS;
  const elapsedMs = () => Math.max(0, now() - props.startedAt);
  const progress = () => {
    if (status() === "completed") return format.percent(1, { maximumFractionDigits: 0 });
    if (elapsedMs() > COMPACTION_SLOW_FACTOR * expectedMs()) {
      const seconds = Math.floor(elapsedMs() / 1000);
      return t("composer.compaction.elapsed", {
        minutes: format.number(Math.floor(seconds / 60)),
        seconds: format.number(seconds % 60, { minimumIntegerDigits: 2 }),
      });
    }
    return format.percent(estimatedCompaction(elapsedMs(), expectedMs()), {
      maximumFractionDigits: 0,
      roundingMode: "floor",
    });
  };
  return (
    <div
      class="composer-notice context-compaction-notice"
      data-tone={status() === "completed" ? "success" : "warning"}
      data-leaving={leaving() ? "" : undefined}
      role="status"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && leaving()) props.onDone?.();
      }}
      onKeyDown={(event) => {
        if (status() !== "failed" || event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        setLeaving(true);
      }}
    >
      <Switch fallback={<LoaderCircle class="composer-notice-icon composer-spinner" aria-hidden="true" />}>
        <Match when={status() === "completed"}>
          <CircleCheck class="composer-notice-icon" aria-hidden="true" />
        </Match>
        <Match when={status() === "failed"}>
          <TriangleAlert class="composer-notice-icon" aria-hidden="true" />
        </Match>
      </Switch>
      <p class="context-compaction-notice-copy">
        <strong>{t(COMPACTION_LABELS[status()])}</strong>
        <Show when={status() === "failed"}>
          <span> · {t("chat.compaction.continues")}</span>
        </Show>
      </p>
      <Show
        when={status() === "failed"}
        fallback={
          /* Hidden from the live region: a value that changes four times a second must not be read out. */
          <span
            class="context-compaction-notice-percent"
            aria-hidden="true"
            title={status() === "running" ? t("composer.compaction.estimated") : undefined}
          >
            {progress()}
          </span>
        }
      >
        <Button
          variant="ghost"
          type="button"
          size="sm"
          class="composer-notice-dismiss"
          aria-label={t("composer.notice.dismiss")}
          data-cuelume-tap="close"
          onClick={() => setLeaving(true)}
        >
          <CloseIcon />
        </Button>
      </Show>
    </div>
  );
}

export interface ContextCompactionView {
  status: "running" | "completed" | "failed";
  timestamp: string;
  beforeTokens?: number | undefined;
  afterTokens?: number | undefined;
}

const COMPACTION_LABELS = {
  running: "chat.compaction.running",
  completed: "chat.compaction.completed",
  failed: "chat.compaction.failed",
} as const satisfies Record<ContextCompactionView["status"], AppTextKey>;

/** The conversation row where a provider thread was compacted. It reads like the other action markers. */
export function ContextCompactionMarker(props: { compaction: ContextCompactionView }) {
  const { t, format } = useText();
  return (
    <Marker
      class="chat-action-marker context-compaction-marker"
      role="status"
      aria-live="polite"
      data-status={props.compaction.status}
    >
      <div class="context-compaction-body">
        <MarkerContent class="chat-action-marker-content">
          <span class="context-compaction-icon" aria-hidden="true">
            <Show
              when={props.compaction.status === "running"}
              fallback={
                <Show when={props.compaction.status === "failed"} fallback={<CircleCheck />}>
                  <TriangleAlert />
                </Show>
              }
            >
              <LoaderCircle class="composer-spinner" />
            </Show>
          </span>
          <span class="chat-action-marker-label">{t(COMPACTION_LABELS[props.compaction.status])}</span>
          <Show when={props.compaction.beforeTokens !== undefined && props.compaction.afterTokens !== undefined}>
            <span class="context-compaction-detail">
              ·{" "}
              {t("chat.compaction.tokens", {
                before: format.compact(props.compaction.beforeTokens ?? 0),
                after: format.compact(props.compaction.afterTokens ?? 0),
              })}
            </span>
          </Show>
          <Show when={props.compaction.status === "failed"}>
            <span class="context-compaction-detail">· {t("chat.compaction.continues")}</span>
          </Show>
          <time class="chat-action-marker-time" datetime={props.compaction.timestamp}>
            {formatChatTimestamp(new Date(props.compaction.timestamp), format)}
          </time>
        </MarkerContent>
      </div>
    </Marker>
  );
}
