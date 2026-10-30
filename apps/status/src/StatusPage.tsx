import { AppLogo } from "@openbot/brand";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Rss from "lucide-solid/icons/rss";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import {
  formatClock,
  formatDay,
  formatDayTime,
  formatDuration,
  formatLongDay,
  formatMinutes,
  formatMonth,
  formatTime,
  formatUptime,
  STAGE_LABELS,
  STATE_LABELS,
} from "./format";
import {
  currentState,
  type Incident,
  type IncidentUpdate,
  isActive,
  SERVICES,
  type ServiceId,
  type StatusDay,
  type StatusFile,
  type StatusState,
  serviceDays,
  serviceName,
  uptimePercent,
  worseState,
} from "./model";
import "./status.css";

export const ISSUES_URL = "https://github.com/nightly-labs/openbot/issues?q=label%3Astatus";
const SITE_URL = "https://openbot.run";
/** A scheduled run can start late, but a check older than this means that the checks stopped. */
const LATE_CHECK_MS = 30 * 60_000;

type Range = 30 | 90;

export interface StatusPageProps {
  status: StatusFile;
  /** The time that the page shows the status for. */
  now: string;
}

function StateDot(props: { state: StatusState | null }) {
  return <span class="status-dot" data-state={props.state ?? "none"} aria-hidden="true" />;
}

function StateLabel(props: { state: StatusState | null }) {
  return (
    <span class="status-state" data-state={props.state ?? "none"}>
      {props.state ? STATE_LABELS[props.state] : "No data"}
    </span>
  );
}

function RangeToggle(props: { range: Range; onChange: (range: Range) => void }) {
  return (
    <div class="status-toggle">
      <For each={[30, 90] as const}>
        {(range) => (
          <button
            type="button"
            aria-pressed={props.range === range ? "true" : "false"}
            onClick={() => props.onChange(range)}
          >
            {range} days
          </button>
        )}
      </For>
    </div>
  );
}

function UpdateList(props: { updates: readonly IncidentUpdate[]; state: StatusState }) {
  return (
    <ol class="status-updates" data-state={props.state}>
      <For each={props.updates}>
        {(update) => (
          <li class="status-update">
            <p class="status-update-head">
              <span class="status-update-stage">{STAGE_LABELS[update.stage]}</span>
              <time class="status-muted" datetime={update.at}>
                {formatDayTime(update.at)}
              </time>
            </p>
            <p class="status-update-body">{update.body}</p>
          </li>
        )}
      </For>
    </ol>
  );
}

function ServiceTags(props: { ids: readonly ServiceId[] }) {
  return (
    <ul class="status-tags" aria-label="Affected">
      <For each={props.ids}>{(id) => <li class="status-tag">{serviceName(id)}</li>}</For>
    </ul>
  );
}

/** "Oct 11, 07:10 – 08:05 UTC · 55 min", or "Started Oct 16, 09:12 UTC · 53 min so far" while it is open. */
function incidentWhen(incident: Incident, now: string) {
  if (incident.kind === "maintenance" && Date.parse(incident.startedAt) > Date.parse(now)) {
    return `Scheduled ${formatDayTime(incident.startedAt)}${incident.resolvedAt ? ` – ${formatTime(incident.resolvedAt)}` : ""}`;
  }
  if (incident.resolvedAt === null || Date.parse(incident.resolvedAt) > Date.parse(now)) {
    return `Started ${formatDayTime(incident.startedAt)} · ${formatDuration(incident.startedAt, now)} so far`;
  }
  const sameDay = incident.startedAt.slice(0, 10) === incident.resolvedAt.slice(0, 10);
  const range = sameDay
    ? `${formatDay(incident.startedAt)}, ${formatClock(incident.startedAt)} – ${formatTime(incident.resolvedAt)}`
    : `${formatDayTime(incident.startedAt)} – ${formatDayTime(incident.resolvedAt)}`;
  return `${range} · ${formatDuration(incident.startedAt, incident.resolvedAt)}`;
}

/** Newest first, grouped by month. */
function byMonth(incidents: readonly Incident[]) {
  const months: { label: string; incidents: Incident[] }[] = [];
  for (const incident of [...incidents].sort((a, b) => b.startedAt.localeCompare(a.startedAt))) {
    const label = formatMonth(incident.startedAt);
    const month = months.at(-1);
    if (month?.label === label) month.incidents.push(incident);
    else months.push({ label, incidents: [incident] });
  }
  return months;
}

function checkedText(checkedAt: string | null, now: string) {
  if (checkedAt === null) return "Not checked yet";
  const sameDay = checkedAt.slice(0, 10) === now.slice(0, 10);
  const text = `Checked ${sameDay ? formatTime(checkedAt) : formatDayTime(checkedAt)}`;
  return Date.parse(now) - Date.parse(checkedAt) > LATE_CHECK_MS ? `${text} · Checks are late` : text;
}

/** The overall state, then each service with its daily bars, then past incidents by month. */
export function StatusPage(props: StatusPageProps) {
  const [range, setRange] = createSignal<Range>(90);
  const incidents = () => props.status.incidents;
  const states = createMemo(() =>
    props.status.services.map((service) => currentState(service, incidents(), props.now)),
  );
  const overall = () =>
    states().reduce<StatusState | null>((worst, state) => (state ? worseState(worst ?? state, state) : worst), null);
  const affected = () => states().filter((state) => state !== null && state !== "operational").length;
  const notices = createMemo(() =>
    incidents()
      .filter(
        (incident) =>
          isActive(incident, props.now) ||
          (incident.kind === "maintenance" && Date.parse(incident.startedAt) > Date.parse(props.now)),
      )
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
  );
  const history = createMemo(() =>
    byMonth(incidents().filter((incident) => !notices().includes(incident) && incident.resolvedAt !== null)),
  );
  const rows = createMemo(() =>
    SERVICES.flatMap((info) => {
      const service = props.status.services.find((item) => item.id === info.id);
      return service ? [{ info, service, days: serviceDays(service, incidents(), range(), props.now) }] : [];
    }),
  );

  return (
    <div class="status-page">
      <header class="status-header">
        <a class="status-brand" href={SITE_URL} aria-label="OpenBot home">
          <AppLogo variant="production" class="status-brand-logo" />
          <span>OpenBot</span>
        </a>
      </header>

      <main class="status-main">
        <header class="status-hero">
          <h1 class="status-title">OpenBot status</h1>
          <div class="status-hero-actions">
            <a class="status-button" href="feed.xml" type="application/atom+xml">
              <Rss class="status-button-icon" aria-hidden="true" />
              RSS feed
            </a>
            <a class="status-button" data-icon="github" href={ISSUES_URL}>
              Watch incidents
            </a>
          </div>
        </header>

        <section class="status-card status-banner" data-state={overall() ?? "none"} aria-label="Current status">
          <StateDot state={overall()} />
          <h2 class="status-banner-title">
            {overall() === null
              ? "Waiting for the first check"
              : overall() === "operational"
                ? "All systems operational"
                : `${affected()} of ${SERVICES.length} services affected`}
          </h2>
          <span class="status-muted">{checkedText(props.status.checkedAt, props.now)}</span>
        </section>

        <Show when={notices().length > 0}>
          <div class="status-stack">
            <For each={notices()}>
              {(incident) => (
                <article class="status-card status-notice" data-state={incident.impact}>
                  <div class="status-notice-head">
                    <h3 class="status-notice-title">
                      <StateDot state={incident.impact} />
                      <a class="status-link" href={incident.url}>
                        {incident.title}
                      </a>
                    </h3>
                    <p class="status-muted">{incidentWhen(incident, props.now)}</p>
                    <ServiceTags ids={incident.components} />
                  </div>
                  <UpdateList updates={incident.updates} state={incident.impact} />
                </article>
              )}
            </For>
          </div>
        </Show>

        <section class="status-section" aria-labelledby="status-services">
          <div class="status-section-head">
            <h2 id="status-services" class="status-section-title">
              Services
            </h2>
            <RangeToggle range={range()} onChange={setRange} />
          </div>
          <ul class="status-card status-services">
            <For each={rows()}>
              {(row, index) => (
                <li class="status-service">
                  <div class="status-service-head">
                    <div>
                      <h3 class="status-service-name">{row.info.name}</h3>
                      <p class="status-service-description">{row.info.description}</p>
                    </div>
                    <StateLabel state={states()[index()] ?? null} />
                  </div>
                  <DayBars days={row.days} name={row.info.name} range={range()} />
                  <div class="status-bars-foot">
                    <span>{range()} days ago</span>
                    <strong>{formatUptime(uptimePercent(row.days))} uptime</strong>
                    <span>Today</span>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </section>

        <section class="status-section" aria-labelledby="status-history">
          <div class="status-section-head">
            <h2 id="status-history" class="status-section-title">
              Past incidents
            </h2>
          </div>
          <Show
            when={history().length > 0}
            fallback={<p class="status-card status-empty status-muted">No incidents in the last 90 days.</p>}
          >
            <For each={history()}>
              {(month) => (
                <div class="status-month">
                  <h3 class="status-month-title">{month.label}</h3>
                  <ul>
                    <For each={month.incidents}>{(incident) => <HistoryRow incident={incident} now={props.now} />}</For>
                  </ul>
                </div>
              )}
            </For>
          </Show>
        </section>
      </main>

      <footer class="status-footer">
        <a class="status-link" href={SITE_URL}>
          openbot.run
        </a>
        <span class="status-muted">Times are in UTC. The page updates every minute.</span>
      </footer>
    </div>
  );
}

function dayText(day: StatusDay) {
  if (day.check === null || day.check.checks === 0) return "No data";
  if (day.check.failedMinutes > 0) return `Not available for ${formatMinutes(day.check.failedMinutes)}`;
  if (day.check.degradedMinutes > 0) return `Slow for ${formatMinutes(day.check.degradedMinutes)}`;
  return "No problems";
}

function DayBars(props: { days: readonly StatusDay[]; name: string; range: Range }) {
  const [hover, setHover] = createSignal<number | null>(null);
  const incidentCount = () => new Set(props.days.flatMap((day) => day.incidents.map((item) => item.id))).size;
  const hovered = () => {
    const index = hover();
    return index === null ? undefined : props.days[index];
  };
  /** The hovered bar's centre as a fraction of the row. The tooltip shifts by the same fraction of its own width, so it stays inside the row. */
  const tooltipAt = () => ((hover() ?? 0) + 0.5) / props.days.length;

  return (
    <div
      class="status-bars"
      role="img"
      aria-label={`${props.name}: ${formatUptime(uptimePercent(props.days))} uptime in the last ${props.range} days, ${incidentCount()} incidents`}
      onPointerLeave={() => setHover(null)}
    >
      <For each={props.days}>
        {(day, index) => (
          <span
            class="status-bar"
            data-state={day.state ?? "none"}
            data-hover={hover() === index() ? "" : undefined}
            onPointerEnter={() => setHover(index())}
          />
        )}
      </For>
      <Show when={hovered()}>
        {(day) => (
          <div
            class="status-tooltip"
            aria-hidden="true"
            style={{ left: `${tooltipAt() * 100}%`, "--status-tooltip-at": String(tooltipAt()) }}
          >
            <p class="status-tooltip-date">{formatLongDay(day().date)}</p>
            <Show when={day().incidents.length > 0} fallback={<p class="status-muted">{dayText(day())}</p>}>
              <For each={day().incidents}>
                {(incident) => (
                  <p class="status-state" data-state={incident.impact}>
                    {incident.title}
                  </p>
                )}
              </For>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

function HistoryRow(props: { incident: Incident; now: string }) {
  const [open, setOpen] = createSignal(false);
  const bodyId = createUniqueId();
  return (
    <li class="status-incident" data-state={props.incident.impact}>
      <button
        type="button"
        class="status-incident-title"
        aria-expanded={open() ? "true" : "false"}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <StateDot state={props.incident.impact} />
        {props.incident.title}
        <ChevronDown class="status-incident-chevron" aria-hidden="true" />
      </button>
      <p class="status-muted status-incident-meta">
        {incidentWhen(props.incident, props.now)} · {props.incident.components.map(serviceName).join(", ")}
      </p>
      <Show when={open()}>
        <div id={bodyId} class="status-incident-body">
          <UpdateList updates={props.incident.updates} state={props.incident.impact} />
          <a class="status-link" href={props.incident.url}>
            Open the issue
          </a>
        </div>
      </Show>
    </li>
  );
}
