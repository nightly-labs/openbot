import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  ChevronDown,
  CircleCheck,
  LoaderCircle,
  Marker,
  MarkerContent,
  Minimize2,
  Popover,
  RadialProgress,
  type RadialProgressTone,
  TriangleAlert,
} from "@openbot/ui";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { createEffect, createSignal, createUniqueId, For, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { CloseIcon } from "./ConversationIcons";
import { formatChatTimestamp } from "./chat-timestamp";

/** Where the tokens in a provider thread go. Only providers that count them per category report this. */
export type ContextUsageCategory = "system" | "tools" | "memory" | "messages";

export interface ContextUsageView {
  usedTokens: number;
  windowTokens: number;
  /**
   * The share of the window (0-1) at which the thread compacts without a request.
   * Null when nothing compacts this thread on its own.
   */
  autoCompactAt: number | null;
  /** Ordered as the provider reports them. The sum stays at or below `usedTokens`. */
  categories?: readonly { category: ContextUsageCategory; tokens: number }[] | undefined;
  nativeManaged?: boolean;
  estimated?: boolean;
  compacting: boolean;
  lastCompaction?: { beforeTokens: number; afterTokens: number } | undefined;
}

const CATEGORY_LABELS = {
  system: "composer.context.category.system",
  tools: "composer.context.category.tools",
  memory: "composer.context.category.memory",
  messages: "composer.context.category.messages",
} as const satisfies Record<ContextUsageCategory, AppTextKey>;

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
 * thread is, what fills it, and when it compacts. `onCompact` adds the manual compaction action;
 * leave it out for a provider that cannot compact on request.
 */
export function ContextUsageMeter(props: { usage: ContextUsageView; onCompact?: (() => void) | undefined }) {
  const { t, format } = useText();
  const percent = () => format.percent(usedShare(props.usage), { maximumFractionDigits: 0 });
  const level = () => meterLevel(props.usage);
  const ringTone = (): RadialProgressTone => {
    const current = level();
    return current === "quiet" || current === "normal" ? "accent" : current;
  };
  let popover: HTMLElement | undefined;
  return (
    <Popover.Root placement="top-end" gutter={8}>
      <Popover.Trigger
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
          <Show when={props.usage.categories?.length}>
            <ContextUsageLegend usage={props.usage} />
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
          <Show when={props.onCompact}>
            {(compact) => (
              <footer class="context-meter-footer">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  class="context-meter-action"
                  disabled={props.usage.compacting}
                  onClick={() => compact()()}
                >
                  <Show when={props.usage.compacting} fallback={<Minimize2 aria-hidden="true" />}>
                    <LoaderCircle class="composer-spinner" aria-hidden="true" />
                  </Show>
                  {props.usage.compacting ? t("composer.context.compacting") : t("composer.context.compact")}
                </Button>
              </footer>
            )}
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** One segment per reported category, then free space, with a tick where the automatic compaction runs. */
function ContextUsageBar(props: { usage: ContextUsageView }) {
  const categorized = () => props.usage.categories?.reduce((sum, entry) => sum + entry.tokens, 0) ?? 0;
  const segments = () => {
    const window = Math.max(1, props.usage.windowTokens);
    const reported = props.usage.categories ?? [];
    const rest = Math.max(0, props.usage.usedTokens - categorized());
    return [
      ...reported.map((entry) => ({ key: entry.category, share: entry.tokens / window })),
      ...(rest > 0 || reported.length === 0 ? [{ key: "used" as const, share: rest / window }] : []),
    ].filter((segment) => segment.share > 0);
  };
  return (
    <div class="context-usage-bar" aria-hidden="true">
      <For each={segments()}>
        {(segment) => (
          <span class="context-usage-segment" data-category={segment.key} style={{ "flex-grow": segment.share }} />
        )}
      </For>
      <span class="context-usage-segment" data-category="free" style={{ "flex-grow": 1 - usedShare(props.usage) }} />
      <Show when={props.usage.autoCompactAt}>
        {(at) => <span class="context-usage-threshold" style={{ left: `${at() * 100}%` }} />}
      </Show>
    </div>
  );
}

function ContextUsageLegend(props: { usage: ContextUsageView }) {
  const { t, format } = useText();
  return (
    <ul class="context-usage-legend" aria-label={t("composer.context.breakdown")}>
      <For each={props.usage.categories ?? []}>
        {(entry) => (
          <li class="context-usage-legend-row" data-category={entry.category}>
            <span class="context-usage-swatch" aria-hidden="true" />
            <span>{t(CATEGORY_LABELS[entry.category])}</span>
            <span class="context-usage-legend-value">{format.compact(entry.tokens)}</span>
          </li>
        )}
      </For>
      <li class="context-usage-legend-row" data-category="free">
        <span class="context-usage-swatch" aria-hidden="true" />
        <span>{t("composer.context.category.free")}</span>
        <span class="context-usage-legend-value">
          {format.compact(Math.max(0, props.usage.windowTokens - props.usage.usedTokens))}
        </span>
      </li>
    </ul>
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
  heldMessages?: number | undefined;
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
        <Show
          when={status() === "failed"}
          fallback={
            <Show when={props.heldMessages}>
              {(count) => <span> · {t("chat.compaction.held", { count: count() })}</span>}
            </Show>
          }
        >
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
  /** Queued messages that wait for the compaction to finish. Only meaningful while it runs. */
  heldMessages?: number | undefined;
  /** The text the provider kept in place of the earlier messages, when it reports one. */
  summary?: string | undefined;
}

const COMPACTION_LABELS = {
  running: "chat.compaction.running",
  completed: "chat.compaction.completed",
  failed: "chat.compaction.failed",
} as const satisfies Record<ContextCompactionView["status"], AppTextKey>;

/** The conversation row where a provider thread was compacted. It reads like the other action markers. */
export function ContextCompactionMarker(props: { compaction: ContextCompactionView }) {
  const { t, format } = useText();
  const [expanded, setExpanded] = createSignal(false);
  const summaryId = createUniqueId();
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
          <Show when={props.compaction.status === "running" && props.compaction.heldMessages}>
            {(count) => (
              <span class="context-compaction-detail">· {t("chat.compaction.held", { count: count() })}</span>
            )}
          </Show>
          <Show when={props.compaction.status === "failed"}>
            <span class="context-compaction-detail">· {t("chat.compaction.continues")}</span>
          </Show>
          <time class="chat-action-marker-time" datetime={props.compaction.timestamp}>
            {formatChatTimestamp(new Date(props.compaction.timestamp), format)}
          </time>
          <Show when={props.compaction.status === "completed" && props.compaction.summary}>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              class="context-compaction-toggle"
              aria-expanded={expanded() ? "true" : "false"}
              aria-controls={summaryId}
              aria-label={expanded() ? t("chat.compaction.hideSummary") : t("chat.compaction.showSummary")}
              onClick={() => setExpanded((open) => !open)}
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </Show>
        </MarkerContent>
        <Show when={expanded() && props.compaction.summary}>
          {(summary) => (
            <section id={summaryId} class="context-compaction-summary" aria-label={t("chat.compaction.summary")}>
              {summary()}
            </section>
          )}
        </Show>
      </div>
    </Marker>
  );
}
