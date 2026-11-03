/**
 * Every workflow of the server on one page of its own: which ones run now and at what step,
 * when each scheduled one runs next, how the last run ended, and Run and Stop on each card. A card's
 * name opens that workflow on the canvas. The page shows what the host reports; it starts and stops
 * runs through the same calls as the canvas.
 *
 * Groups: running now, then scheduled, then manual and webhook workflows, each by name. Each group
 * folds, and the page remembers which ones. `top` holds extra groups above them (the issue numbers).
 */

import type { WorkflowRunStatus, WorkflowTriggerType } from "@openbot/contracts/ipc";
import { ArrowLeft, Button, IconButton, Input, Play, Settings, Square } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { createCollapsedGroups } from "./collapsed-groups";
import "./collapsed-groups.css";

export { createCollapsedGroups } from "./collapsed-groups";

export interface OverviewWorkflow {
  id: string;
  title: string;
  steps: number;
  /** The first trigger of the graph: what starts the workflow. */
  trigger: WorkflowTriggerType;
  /** When a schedule fires next, or null. */
  nextDueAt: string | null;
  /** The newest run, or null when the workflow never ran. */
  run: { id: string; number: number; status: WorkflowRunStatus; startedAt: string; endedAt: string | null } | null;
  /** The step that runs now or waits for a decision, named for people, or null. */
  step: string | null;
  /** A colour group for the strip behind the name, or undefined for none. */
  tone?: OverviewTone | undefined;
}

/** The colour groups of the name strip. The page that lists the workflows picks one per card. */
export type OverviewTone = "plan" | "build" | "judge" | "conflict" | "violet";

/** Every tone, in the order a picker lists them. */
export const OVERVIEW_TONES = [
  "plan",
  "build",
  "judge",
  "conflict",
  "violet",
] as const satisfies readonly OverviewTone[];

import type { AppTextKey } from "@openbot/i18n";

/** The run states a card names, as keys of their labels. */
const STATUS_LABEL = {
  running: "workflow.overview.status.running",
  approval: "workflow.overview.status.approval",
  stopping: "workflow.overview.status.stopping",
  done: "workflow.overview.status.done",
  failed: "workflow.overview.status.failed",
  stopped: "workflow.overview.status.stopped",
  idle: "workflow.overview.status.idle",
} as const satisfies Record<WorkflowRunStatus | "idle", AppTextKey>;

const ACTIVE: readonly WorkflowRunStatus[] = ["running", "approval", "stopping"];
const isActive = (workflow: OverviewWorkflow) => workflow.run !== null && ACTIVE.includes(workflow.run.status);

export function WorkflowOverview(props: {
  workflows: readonly OverviewWorkflow[];
  /** Workflows whose Run was pressed and whose run the host has not reported yet. */
  starting: ReadonlySet<string>;
  readOnly: boolean;
  onOpen: (workflowId: string) => void;
  onRun: (workflowId: string) => void;
  onStop: (runId: string) => void;
  /** True until the first read, so the page does not flash its empty notice. */
  loading?: boolean | undefined;
  /** Absent on a page of its own, which the rail leaves. */
  onBack?: (() => void) | undefined;
  /** Opens the settings of the page, when it has any. */
  onSettings?: (() => void) | undefined;
  /** Groups above the workflow groups, such as the issue numbers. They keep their own state. */
  top?: JSX.Element | undefined;
}) {
  const { t, format } = useText();
  const [filter, setFilter] = createSignal("");
  const collapsed = createCollapsedGroups();
  const when = (iso: string) =>
    format.date(new Date(iso), { weekday: "short", hour: "numeric", minute: "2-digit", hour12: format.hour12 });

  const groups = createMemo(() => {
    const needle = filter().trim().toLocaleLowerCase();
    const shown = props.workflows
      .filter((workflow) => !needle || workflow.title.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title));
    const running = shown.filter(isActive);
    const scheduled = shown.filter((workflow) => !isActive(workflow) && workflow.trigger === "schedule");
    const other = shown.filter((workflow) => !isActive(workflow) && workflow.trigger !== "schedule");
    return [
      { key: "running", label: t("workflow.overview.groupRunning"), items: running },
      { key: "scheduled", label: t("workflow.overview.groupScheduled"), items: scheduled },
      { key: "other", label: t("workflow.overview.groupOther"), items: other },
    ].filter((group) => group.items.length > 0);
  });

  const triggerText = (workflow: OverviewWorkflow) => {
    if (workflow.trigger === "schedule")
      return workflow.nextDueAt
        ? t("workflow.overview.next", { time: when(workflow.nextDueAt) })
        : t("workflow.overview.noNext");
    return t(workflow.trigger === "webhook" ? "workflow.overview.webhook" : "workflow.overview.manual");
  };

  const runText = (workflow: OverviewWorkflow) => {
    const run = workflow.run;
    if (!run) return t("workflow.overview.never");
    if (isActive(workflow)) return t("workflow.overview.started", { number: run.number, time: when(run.startedAt) });
    return t("workflow.overview.ended", {
      number: run.number,
      outcome: t(STATUS_LABEL[run.status]),
      time: when(run.endedAt ?? run.startedAt),
    });
  };

  const status = (workflow: OverviewWorkflow): WorkflowRunStatus | "idle" => workflow.run?.status ?? "idle";

  /**
   * An idle card is one row plus its trigger. Its status shows how the last run ended, so the run line
   * shows only after a failed or stopped run. A running card shows when its run started.
   */
  const showsRun = (workflow: OverviewWorkflow) =>
    isActive(workflow) || workflow.run?.status === "failed" || workflow.run?.status === "stopped";

  /** Run on an idle card, Stop on a running one. */
  const actions = (workflow: () => OverviewWorkflow) => (
    <Show
      when={isActive(workflow()) && workflow().run?.status !== "stopping" ? workflow().run : null}
      fallback={
        <Button
          variant="outline"
          size="sm"
          disabled={props.readOnly || isActive(workflow()) || props.starting.has(workflow().id)}
          onClick={() => props.onRun(workflow().id)}
        >
          <Play aria-hidden="true" />
          {t("workflow.overview.run")}
        </Button>
      }
    >
      {(run) => (
        <Button variant="destructive-ghost" size="sm" disabled={props.readOnly} onClick={() => props.onStop(run().id)}>
          <Square aria-hidden="true" />
          {t("workflow.overview.stop")}
        </Button>
      )}
    </Show>
  );

  return (
    <main class="window-page wfo-page" aria-label={t("workflow.overview.title")}>
      <header class="wfo-header">
        <Show when={props.onBack}>
          {(back) => (
            <Button variant="ghost" size="sm" onClick={() => back()()}>
              <ArrowLeft aria-hidden="true" />
              {t("workflow.overview.back")}
            </Button>
          )}
        </Show>
        <h1 class="wfo-title">{t("workflow.overview.title")}</h1>
        <span class="wfo-meta">
          {t("workflow.overview.summary", {
            count: props.workflows.length,
            running: props.workflows.filter(isActive).length,
          })}
        </span>
        <Input
          class="wfo-filter"
          type="search"
          placeholder={t("workflow.overview.filter")}
          aria-label={t("workflow.overview.filter")}
          value={filter()}
          onValueChange={setFilter}
        />
        <Show when={props.onSettings}>
          {(onSettings) => (
            <IconButton
              label={t("workflow.overview.settings.open")}
              variant="ghost"
              class="wfo-settings-open"
              onClick={() => onSettings()()}
            >
              <Settings aria-hidden="true" />
            </IconButton>
          )}
        </Show>
      </header>
      <div class="wfo-body">
        {props.top}
        <Show
          when={groups().length > 0}
          fallback={
            <Show when={!props.loading}>
              <p class="wfo-empty">{t("workflow.overview.empty")}</p>
            </Show>
          }
        >
          <For each={groups()} keyed={(group) => group.key}>
            {(group) => (
              <section class="wfo-group" aria-label={group().label}>
                <h2 class="wfo-group-title">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="wfo-fold"
                    aria-expanded={collapsed.isCollapsed(group().key) ? "false" : "true"}
                    onClick={() => collapsed.toggle(group().key)}
                  >
                    <span
                      class="wfo-caret"
                      aria-hidden="true"
                      data-open={collapsed.isCollapsed(group().key) ? undefined : ""}
                    />
                    {group().label} · {group().items.length}
                  </Button>
                </h2>
                <Show when={!collapsed.isCollapsed(group().key)}>
                  <div class="wfo-grid">
                    <For each={group().items} keyed={(item) => item.id}>
                      {(workflow) => (
                        <article
                          class="wfo-card"
                          data-active={isActive(workflow()) ? "" : undefined}
                          data-compact={isActive(workflow()) ? undefined : ""}
                          data-tone={workflow().tone}
                        >
                          <div class="wfo-card-top">
                            <Button
                              variant="ghost"
                              size="sm"
                              class="wfo-name"
                              aria-label={t("workflow.overview.openCanvas", { name: workflow().title })}
                              title={workflow().title}
                              onClick={() => props.onOpen(workflow().id)}
                            >
                              {workflow().title}
                            </Button>
                            <span class="wfo-status" data-status={status(workflow())}>
                              {t(STATUS_LABEL[status(workflow())])}
                            </span>
                            <Show when={!isActive(workflow())}>{actions(workflow)}</Show>
                          </div>
                          <p class="wfo-line">{triggerText(workflow())}</p>
                          <Show when={showsRun(workflow())}>
                            <p class="wfo-line">{runText(workflow())}</p>
                          </Show>
                          <Show when={isActive(workflow()) ? workflow().step : null}>
                            {(step) => (
                              <p class="wfo-line wfo-step">
                                {workflow().run?.status === "approval"
                                  ? t("workflow.overview.waiting", { step: step() })
                                  : t("workflow.overview.now", { step: step() })}
                              </p>
                            )}
                          </Show>
                          <Show when={isActive(workflow())}>
                            <div class="wfo-actions">{actions(workflow)}</div>
                          </Show>
                        </article>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            )}
          </For>
        </Show>
      </div>
    </main>
  );
}
