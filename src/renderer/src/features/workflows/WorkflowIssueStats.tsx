/**
 * GitHub issue numbers at the top of All workflows: the open issues per label (with the ones that have
 * no label, and the ones that wait on the owner), then what closed in the last 170 hours per priority.
 * The page shows what the issue-stats helper reports; it reads nothing from GitHub itself.
 */

import { Button } from "@openbot/ui";
import { createCollapsedGroups } from "@openbot/ui/features/workflows/WorkflowOverview";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Show } from "solid-js";
import { appPort } from "../../app-port";
import "./workflow-issue-stats.css";

export interface IssueLabelRow {
  name: string;
  count: number;
  opened24h: number;
  closed24h: number;
}

export interface IssuePriorityRow {
  /** P0 to P3, or "none" for issues closed without a priority. */
  key: string;
  done: number;
  dropped: number;
  /** Closed per day, oldest first; the last entry is the latest 24 hours. */
  days: readonly number[];
}

export interface IssueStats {
  generatedAt: string;
  refreshMs: number;
  repo: string;
  /** Set when the last refresh failed; the numbers are then the last good ones. */
  error?: string | undefined;
  open: {
    total: number;
    forOwner: number;
    untagged: readonly { number: number; title: string }[];
    labels: readonly IssueLabelRow[];
  };
  closed: { windowHours: number; total: number; priorities: readonly IssuePriorityRow[] };
}

/** True for a payload with the shape this page draws, so that a stray answer cannot blank the page. */
export function isIssueStats(value: unknown): value is IssueStats {
  if (typeof value !== "object" || value === null) return false;
  if (!("generatedAt" in value) || typeof value.generatedAt !== "string") return false;
  if (!("open" in value) || typeof value.open !== "object" || value.open === null) return false;
  if (!("labels" in value.open) || !Array.isArray(value.open.labels)) return false;
  if (!("untagged" in value.open) || !Array.isArray(value.open.untagged)) return false;
  if (!("closed" in value) || typeof value.closed !== "object" || value.closed === null) return false;
  return "priorities" in value.closed && Array.isArray(value.closed.priorities);
}

/** Labels that need a person get a colour; the rest stay plain. */
const LABEL_TONE: Readonly<Record<string, "owner" | "bad">> = {
  "needs-owner": "owner",
  "needs-plan": "owner",
  "plan-ready": "owner",
  "owner-actions": "owner",
  "agent-failed": "bad",
  conflict: "bad",
  "test-red": "bad",
  "judge:reject": "bad",
};

/** How the issue-stats helper starts, for the notice a user sees without it. See issue-stats-source. */
const HELPER_COMMAND = "node scripts/issue-stats.cjs";
const OWNER_LABELS = "needs-owner,needs-plan,plan-ready,owner-actions";
const PRIORITY_LABELS = ["P0", "P1", "P2", "P3"];

/** A GitHub issue search for the repo, in the form of the search box (label:"x" is:open ...). */
const searchUrl = (repo: string, query: string) => `https://github.com/${repo}/issues?q=${encodeURIComponent(query)}`;

/** The closed-group search: what the card counts, from the day the 170 hours began. */
function closedQuery(stats: IssueStats, priority: string): string {
  const since = new Date(Date.parse(stats.generatedAt) - stats.closed.windowHours * 3_600_000)
    .toISOString()
    .slice(0, 10);
  const scope =
    priority === "none" ? PRIORITY_LABELS.map((label) => `-label:${label}`).join(" ") : `label:"${priority}"`;
  return `is:closed closed:>=${since} ${scope}`;
}

/** Opens a link in the default browser through the app, so the window itself never navigates. */
const openLink = (url: string) => (event: MouseEvent) => {
  event.preventDefault();
  void appPort().openUrl(url);
};

export function WorkflowIssueStats(props: {
  stats: IssueStats | undefined;
  /** The last read failed. With stats it means they are old; without, there is nothing to show. */
  error: string | null;
  loading: boolean;
}) {
  const { t, format } = useText();
  const collapsed = createCollapsedGroups();
  const [showUntagged, setShowUntagged] = createSignal(false);

  const at = (iso: string) => format.date(new Date(iso), { hour: "numeric", minute: "2-digit", hour12: format.hour12 });
  const weekday = (generatedAt: string, index: number, length: number) =>
    format.date(new Date(Date.parse(generatedAt) - (length - 1 - index) * 86_400_000), { weekday: "short" });

  const peak = createMemo(() => Math.max(1, ...(props.stats?.closed.priorities ?? []).flatMap((row) => row.days)));

  const fold = (key: string, title: string, summary: string) => (
    <h2 class="wfo-group-title">
      <Button
        variant="ghost"
        size="sm"
        class="wfo-fold"
        aria-expanded={collapsed.isCollapsed(key) ? "false" : "true"}
        onClick={() => collapsed.toggle(key)}
      >
        <span class="wfo-caret" aria-hidden="true" data-open={collapsed.isCollapsed(key) ? undefined : ""} />
        {title}
        <span class="wfoi-summary">{summary}</span>
      </Button>
    </h2>
  );

  return (
    <>
      <Show when={props.stats === undefined}>
        <section class="wfo-group wfoi" aria-label={t("workflow.overview.issues.openTitle")}>
          <p class="wfo-line">
            {props.loading
              ? t("workflow.overview.issues.loading")
              : t("workflow.overview.issues.unavailable", { command: HELPER_COMMAND })}
          </p>
        </section>
      </Show>
      <Show when={props.stats}>
        {(stats) => (
          <>
            <section class="wfo-group wfoi" aria-label={t("workflow.overview.issues.openTitle")}>
              {fold(
                "issues-open",
                t("workflow.overview.issues.openTitle"),
                t("workflow.overview.issues.openSummary", { open: stats().open.total, owner: stats().open.forOwner }),
              )}
              <Show when={!collapsed.isCollapsed("issues-open")}>
                <div class="wfoi-chips">
                  <a
                    class="wfoi-chip"
                    data-tone="owner"
                    title={t("workflow.overview.issues.forOwnerHint")}
                    href={searchUrl(stats().repo, `is:open label:${OWNER_LABELS}`)}
                    onClick={openLink(searchUrl(stats().repo, `is:open label:${OWNER_LABELS}`))}
                  >
                    <b>{stats().open.forOwner}</b> {t("workflow.overview.issues.forOwner")}
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="wfoi-chip"
                    data-tone={stats().open.untagged.length > 0 ? "bad" : undefined}
                    aria-expanded={showUntagged() ? "true" : "false"}
                    disabled={stats().open.untagged.length === 0}
                    onClick={() => setShowUntagged((open) => !open)}
                  >
                    <b>{stats().open.untagged.length}</b> {t("workflow.overview.issues.noLabel")}
                  </Button>
                  <span class="wfo-meta wfoi-stamp">
                    {t(props.error ? "workflow.overview.issues.updatedStale" : "workflow.overview.issues.updated", {
                      time: at(stats().generatedAt),
                      minutes: Math.round(stats().refreshMs / 60000),
                    })}
                  </span>
                </div>
                <Show when={showUntagged() && stats().open.untagged.length > 0}>
                  <ul class="wfoi-untagged">
                    <li>
                      <a
                        href={searchUrl(stats().repo, "is:open no:label")}
                        onClick={openLink(searchUrl(stats().repo, "is:open no:label"))}
                      >
                        {t("workflow.overview.issues.openOnGithub")}
                      </a>
                    </li>
                    <For each={stats().open.untagged} keyed={(issue) => issue.number}>
                      {(issue) => (
                        <li>
                          <a
                            href={`https://github.com/${stats().repo}/issues/${issue().number}`}
                            onClick={openLink(`https://github.com/${stats().repo}/issues/${issue().number}`)}
                          >
                            #{issue().number}
                          </a>{" "}
                          {issue().title}
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <div class="wfoi-grid">
                  <For each={stats().open.labels} keyed={(row) => row.name}>
                    {(row) => (
                      <a
                        class="wfoi-card"
                        data-tone={LABEL_TONE[row().name]}
                        href={searchUrl(stats().repo, `is:open label:"${row().name}"`)}
                        onClick={openLink(searchUrl(stats().repo, `is:open label:"${row().name}"`))}
                      >
                        <span class="wfoi-name" title={row().name}>
                          {row().name}
                        </span>
                        <b class="wfoi-count">{row().count}</b>
                        <span class="wfoi-delta" title={t("workflow.overview.issues.delta")}>
                          +{row().opened24h} · −{row().closed24h}
                        </span>
                      </a>
                    )}
                  </For>
                </div>
              </Show>
            </section>

            <section
              class="wfo-group wfoi"
              aria-label={t("workflow.overview.issues.closedTitle", { hours: stats().closed.windowHours })}
            >
              {fold(
                "issues-closed",
                t("workflow.overview.issues.closedTitle", { hours: stats().closed.windowHours }),
                t("workflow.overview.issues.closedSummary", { count: stats().closed.total }),
              )}
              <Show when={!collapsed.isCollapsed("issues-closed")}>
                <div class="wfoi-grid wfoi-grid-priority">
                  <For each={stats().closed.priorities} keyed={(row) => row.key}>
                    {(row) => (
                      <a
                        class="wfoi-card wfoi-priority"
                        data-priority={row().key}
                        href={searchUrl(stats().repo, closedQuery(stats(), row().key))}
                        onClick={openLink(searchUrl(stats().repo, closedQuery(stats(), row().key)))}
                      >
                        <span class="wfoi-name">
                          {row().key === "none" ? t("workflow.overview.issues.noPriority") : row().key}
                        </span>
                        <b class="wfoi-count">{row().done}</b>
                        <span class="wfoi-delta">
                          {row().dropped > 0
                            ? t("workflow.overview.issues.doneDropped", { dropped: row().dropped })
                            : t("workflow.overview.issues.done")}
                        </span>
                        <div
                          class="wfoi-bars"
                          role="img"
                          aria-label={t("workflow.overview.issues.perDay", { days: row().days.join(", ") })}
                        >
                          <For each={row().days}>
                            {(day, index) => (
                              <span
                                class="wfoi-bar"
                                style={{ height: `${Math.max(day > 0 ? 12 : 4, (day / peak()) * 100)}%` }}
                                title={`${weekday(stats().generatedAt, index(), row().days.length)}: ${day}`}
                              />
                            )}
                          </For>
                        </div>
                      </a>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </>
        )}
      </Show>
    </>
  );
}
