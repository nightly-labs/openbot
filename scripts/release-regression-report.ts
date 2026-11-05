import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactText } from "@openbot/logging";
import { type Connection, connectClickHouse, credentials, type QueryResult, runQuery } from "./openpanel-sql";
import { readScriptArguments } from "./script-arguments";

// Compares the newest desktop release with the release before it, from production analytics in the
// OpenPanel ClickHouse (read-only user, see scripts/openpanel-sql.ts). It writes the full report to
// .openbot-build/release-regression/report.json and, with --discord, sends the table to the webhook
// in RELEASE_REGRESSION_WEBHOOK_URL as colored embeds. The GitHub workflow release-regression.yml runs it with --quiet:
// the repository is public, so its log must show no numbers, counts or error details. Those go only
// to the private Discord channel. With --state, the workflow sends only when a status changed, on
// Monday as a weekly summary, and on a manual run (--always).
const USAGE = `Usage:
  bun scripts/release-regression-report.ts [options]
Options:
  --discord        send the report to RELEASE_REGRESSION_WEBHOOK_URL
  --quiet          print one line with no data (for public CI logs); errors go to Discord only
  --state <file>   send only when a status changed since the last send, or on Monday (UTC)
  --always         send even when no status changed`;

const WINDOW_DAYS = 14;
const MIN_COMPUTERS = 30;
const MIN_SAMPLES = 20;
const MIN_TURNS_FOR_SHARE = 200;
/** Error rates need more turns, because most error codes are rare. */
const MIN_TURNS_FOR_RATE = 1_000;
/** An error code needs this many events in the new release before it can rise. */
const MIN_ERRORS = 5;
/** An error code needs this many computers in the new release, so one computer in a loop cannot raise it. */
const MIN_ERROR_COMPUTERS = 3;
const MAX_ERROR_ROWS = 5;
const EARLY_DAYS = 2;
/** A metric regresses when it is this much worse, relative, and also worse by its floor. */
const RELATIVE_LIMIT = 0.2;
/** A metric needs watching when it is this much worse, relative, and also worse by half its floor. */
const WATCH_LIMIT = 0.1;
/** One-sided z for shares and error rates: p < 0.001 for red and p < 0.05 for yellow. */
const RED_Z = 3.09;
const YELLOW_Z = 1.645;
/**
 * Causes that the user, the provider account or the network decide, not OpenBot. The names are the
 * cause_code values of system_turn_completed.
 */
const OUTSIDE_CAUSES = [
  "rate_limit",
  "usage_limit",
  "billing",
  "authentication",
  "network",
  "timeout",
  "provider_unavailable",
];
const VERSION = /^\d+\.\d+\.\d+$/u;
const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u;
const DISCORD_WEBHOOK = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/u;
/** Discord allows 6000 characters and 10 embeds in one message, and 4096 characters in a description. */
const DISCORD_EMBED_CHARACTERS = 5800;
const DISCORD_EMBEDS = 10;
const DISCORD_DESCRIPTION = 4096;
const DISCORD_TIMEOUT_MS = 30_000;

type Unit = "ms" | "mb" | "share" | "per1k";
/** red: regression. yellow: worse, below the regression limit. waiting: the sample cannot show it yet. */
type Status = "red" | "yellow" | "green" | "waiting";
type Section = "turns" | "startup" | "failures" | "errors" | "updates" | "resources";

const STATUS_EMOJI: Record<Status, string> = { red: "🔴", yellow: "🟡", green: "🟢", waiting: "⚪" };
const STATUS_COLOR: Record<Status, number> = { red: 0xed4245, yellow: 0xfee75c, green: 0x57f287, waiting: 0x99aab5 };
const STATUS_ORDER: readonly Status[] = ["red", "yellow", "green", "waiting"];

interface Row {
  readonly section: Section;
  readonly metric: string;
  readonly group: string;
  readonly unit: Unit;
  readonly previous: number | null;
  readonly next: number | null;
  readonly previousN: number;
  readonly nextN: number;
  /** How sure the rise is, for shares and error rates; null for times and sizes. */
  readonly z: number | null;
  readonly status: Status;
  readonly regression: boolean;
  /** False when the sample cannot show a regression yet. */
  readonly judged: boolean;
}

interface Report {
  readonly generatedAt: string;
  readonly previous: string;
  readonly next: string;
  readonly nextFirstSeen: string;
  readonly early: boolean;
  readonly rows: readonly Row[];
  readonly regressions: readonly Row[];
  /** Error codes that rose, also the ones over MAX_ERROR_ROWS; null when there are too few turns. */
  readonly risenErrorCodes: number | null;
}

interface MetricSpec {
  readonly metric: string;
  readonly column: string;
  readonly unit: Unit;
  /** The smallest absolute change that counts, in the metric's unit. */
  readonly floor: number;
  readonly minN: number;
  /** The column with the sample size of this metric, when it is not `n`. */
  readonly nColumn?: string;
}

interface Limit {
  readonly relative: number;
  readonly floor: number;
  readonly z: number;
}

const environment = "properties['environment'] = 'production'";
const window = `created_at >= now() - INTERVAL ${WINDOW_DAYS} DAY`;
const number = (key: string) => `toFloat64OrNull(properties['${key}'])`;

function versionList(versions: readonly string[]): string {
  return versions.map((version) => `'${version}'`).join(", ");
}

const versionsSql = `SELECT
  properties['app_version'] AS version,
  uniqExact(profile_id) AS computers,
  toString(min(created_at)) AS first_seen
FROM events
WHERE name = 'system_turn_completed' AND ${environment} AND ${window}
  AND match(properties['app_version'], '^[0-9]+[.][0-9]+[.][0-9]+$')
GROUP BY version
HAVING computers >= ${MIN_COMPUTERS}
ORDER BY arrayMap(part -> toUInt32(part), splitByChar('.', version)) DESC
LIMIT 2`;

const completed = "properties['status'] = 'completed'";

const turnSql = (versions: readonly string[]) => `SELECT
  properties['app_version'] AS version,
  properties['platform'] AS platform,
  countIf(${completed}) AS n,
  quantileExactIf(0.5)(${number("duration_ms")}, ${completed}) AS turn_p50,
  quantileExactIf(0.95)(${number("duration_ms")}, ${completed}) AS turn_p95,
  countIf(${completed} AND isNotNull(${number("first_output_ms")})) AS first_output_n,
  quantileExactIf(0.5)(${number("first_output_ms")}, ${completed}) AS first_output_p50
FROM events
WHERE name = 'system_turn_completed' AND ${environment} AND ${window}
  AND properties['app_version'] IN (${versionList(versions)})
GROUP BY version, platform`;

// An update restarts the app, so a start after an update waits for the install too.
const startupSql = (versions: readonly string[]) => `SELECT
  properties['app_version'] AS version,
  properties['platform'] AS platform,
  count(${number("workspace_ready_ms")}) AS n,
  quantileExact(0.5)(${number("workspace_ready_ms")}) AS startup_p50,
  quantileExact(0.95)(${number("workspace_ready_ms")}) AS startup_p95
FROM events
WHERE name = 'system_startup' AND ${environment} AND ${window}
  AND properties['app_version'] IN (${versionList(versions)})
  AND properties['start_kind'] != 'updated'
GROUP BY version, platform`;

const failureSql = (versions: readonly string[]) => `SELECT
  properties['app_version'] AS version,
  properties['provider'] AS provider,
  countIf(properties['status'] IN ('completed', 'failed')) AS n,
  countIf(properties['status'] = 'failed') / n AS failed_share,
  countIf(properties['status'] = 'failed' AND properties['cause_code'] != '') AS with_cause,
  countIf(properties['status'] = 'failed'
    AND properties['cause_code'] NOT IN (${versionList(OUTSIDE_CAUSES)})) / n AS own_failed_share
FROM events
WHERE name = 'system_turn_completed' AND ${environment} AND ${window}
  AND properties['app_version'] IN (${versionList(versions)})
GROUP BY version, provider`;

const errorCodeSql = (versions: readonly string[]) => `SELECT
  properties['app_version'] AS version,
  properties['failure_code'] AS code,
  count() AS errors,
  uniqExact(profile_id) AS computers
FROM events
WHERE name = 'system_operation_failed' AND ${environment} AND ${window}
  AND properties['app_version'] IN (${versionList(versions)})
  AND properties['severity'] = 'error' AND properties['failure_code'] != ''
GROUP BY version, code`;

const causeSql = (versions: readonly string[]) => `SELECT
  properties['app_version'] AS version,
  properties['cause_code'] AS code,
  count() AS errors,
  uniqExact(profile_id) AS computers
FROM events
WHERE name = 'system_turn_completed' AND ${environment} AND ${window}
  AND properties['app_version'] IN (${versionList(versions)})
  AND properties['status'] = 'failed' AND properties['cause_code'] != ''
GROUP BY version, code`;

// update_action has no target version. Before the new release was out, every update went to the
// release before it; after, to the new release. Computers that already run the target do not count.
const updateSql = (
  pair: { previous: string; next: string },
  previousFirstSeen: string,
  nextFirstSeen: string,
) => `SELECT
  if(created_at >= toDateTime('${nextFirstSeen}'), '${pair.next}', '${pair.previous}') AS version,
  properties['platform'] AS platform,
  uniqExact(profile_id) AS n,
  uniqExactIf(profile_id, properties['result'] = 'failed') / n AS update_failed_share
FROM events
WHERE name = 'update_action' AND ${environment} AND ${window}
  AND created_at >= toDateTime('${previousFirstSeen}')
  AND properties['action'] IN ('download', 'install')
  AND properties['app_version'] != version
GROUP BY version, platform`;

const resourceSql = (versions: readonly string[]) => `SELECT
  properties['app_version'] AS version,
  properties['platform'] AS platform,
  count() AS n,
  quantileExact(0.95)(${number("main_loop_delay_ms_p95")}) AS loop_p95,
  avg(toFloat64OrZero(properties['main_loop_delay_ms_max']) > 5000) AS stall_share,
  quantileExact(0.95)(${number("db_request_ms_p95")}) AS db_p95,
  quantileExact(0.95)(${number("total_rss_mb_p95")}) AS memory_p95,
  avg(toFloat64OrZero(properties['renderer_gone_count']) > 0) AS renderer_crash_share,
  avg(toFloat64OrZero(properties['child_gone_count']) > 1000) AS crash_loop_share
FROM events
WHERE name = 'system_resources' AND ${environment} AND ${window}
  AND properties['app_version'] IN (${versionList(versions)})
GROUP BY version, platform`;

const TURN_METRICS: readonly MetricSpec[] = [
  { metric: "turn time p50", column: "turn_p50", unit: "ms", floor: 1_000, minN: MIN_SAMPLES },
  { metric: "turn time p95", column: "turn_p95", unit: "ms", floor: 5_000, minN: MIN_SAMPLES },
  {
    metric: "first output p50",
    column: "first_output_p50",
    unit: "ms",
    floor: 1_000,
    minN: MIN_SAMPLES,
    nColumn: "first_output_n",
  },
];
const STARTUP_METRICS: readonly MetricSpec[] = [
  { metric: "startup p50", column: "startup_p50", unit: "ms", floor: 500, minN: MIN_SAMPLES },
  { metric: "startup p95", column: "startup_p95", unit: "ms", floor: 2_000, minN: MIN_SAMPLES },
];
const UPDATE_METRICS: readonly MetricSpec[] = [
  { metric: "failed updates", column: "update_failed_share", unit: "share", floor: 0.02, minN: MIN_SAMPLES },
];
const RESOURCE_METRICS: readonly MetricSpec[] = [
  { metric: "main loop delay p95", column: "loop_p95", unit: "ms", floor: 50, minN: MIN_SAMPLES },
  { metric: "stall > 5 s (computer-days)", column: "stall_share", unit: "share", floor: 0.02, minN: MIN_SAMPLES },
  { metric: "DB statement p95", column: "db_p95", unit: "ms", floor: 100, minN: MIN_SAMPLES },
  { metric: "memory p95", column: "memory_p95", unit: "mb", floor: 150, minN: MIN_SAMPLES },
  {
    metric: "renderer crash (computer-days)",
    column: "renderer_crash_share",
    unit: "share",
    floor: 0.02,
    minN: MIN_SAMPLES,
  },
  { metric: "crash loop (computer-days)", column: "crash_loop_share", unit: "share", floor: 0.01, minN: MIN_SAMPLES },
];
/** Error rates are per 1,000 turns: red when 1.5 times and 1 more per 1,000 turns. */
const ERROR_LIMITS: readonly [Limit, Limit] = [
  { relative: 0.5, floor: 1, z: RED_Z },
  { relative: 0.2, floor: 0.5, z: YELLOW_Z },
];

type ResultRow = QueryResult["data"][number];

function value(row: ResultRow | undefined, column: string): number | null {
  const raw = row?.[column];
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** One-sided two-proportion z: how sure the share rose. */
function shareZ(previous: number, previousN: number, next: number, nextN: number): number {
  const pooled = (previous * previousN + next * nextN) / (previousN + nextN);
  const error = Math.sqrt(pooled * (1 - pooled) * (1 / previousN + 1 / nextN));
  if (error === 0) return next > previous ? Number.POSITIVE_INFINITY : 0;
  return (next - previous) / error;
}

/** One-sided Poisson z for two event counts per turn: how sure the rate rose. */
function rateZ(previousCount: number, previousTurns: number, nextCount: number, nextTurns: number): number {
  const error = Math.sqrt(previousCount / previousTurns ** 2 + nextCount / nextTurns ** 2);
  if (error === 0) return 0;
  return (nextCount / nextTurns - previousCount / previousTurns) / error;
}

function defaultLimits(floor: number): readonly [Limit, Limit] {
  return [
    { relative: RELATIVE_LIMIT, floor, z: RED_Z },
    { relative: WATCH_LIMIT, floor: floor / 2, z: YELLOW_Z },
  ];
}

/** Every metric is worse when it is higher. A z of null means the metric has no significance test. */
function status(
  limits: readonly [Limit, Limit],
  previous: number | null,
  next: number | null,
  z: number | null,
  judged: boolean,
): Status {
  if (!judged) return "waiting";
  if (previous === null || next === null) return "green";
  const worse = (limit: Limit) =>
    next - previous >= limit.floor && next > previous * (1 + limit.relative) && (z === null || z >= limit.z);
  if (worse(limits[0])) return "red";
  return worse(limits[1]) ? "yellow" : "green";
}

function makeRow(fields: Omit<Row, "status" | "regression">, limits: readonly [Limit, Limit]): Row {
  const rowStatus = status(limits, fields.previous, fields.next, fields.z, fields.judged);
  return { ...fields, status: rowStatus, regression: rowStatus === "red" };
}

function compare(
  section: Section,
  result: QueryResult,
  groupColumn: string,
  versions: { previous: string; next: string },
  specs: readonly MetricSpec[],
  judged = true,
): Row[] {
  const groups = [...new Set(result.data.map((row) => String(row[groupColumn] || "(none)")))].sort();
  const find = (version: string, group: string) =>
    result.data.find((row) => row.version === version && String(row[groupColumn] || "(none)") === group);
  return groups.flatMap((group) => {
    const before = find(versions.previous, group);
    const after = find(versions.next, group);
    return specs.flatMap((spec) => {
      const nColumn = spec.nColumn ?? "n";
      const previousN = value(before, nColumn) ?? 0;
      const nextN = value(after, nColumn) ?? 0;
      if (previousN < spec.minN || nextN < spec.minN) return [];
      const previous = value(before, spec.column);
      const next = value(after, spec.column);
      const z =
        spec.unit === "share" && previous !== null && next !== null ? shareZ(previous, previousN, next, nextN) : null;
      return [
        makeRow(
          { section, metric: spec.metric, group, unit: spec.unit, previous, next, previousN, nextN, z, judged },
          defaultLimits(spec.floor),
        ),
      ];
    });
  });
}

/** True when the release sends a cause on its failed turns. */
function sendsCause(result: QueryResult, version: string): boolean {
  return result.data.some((row) => row.version === version && (value(row, "with_cause") ?? 0) > 0);
}

function failureRows(result: QueryResult, versions: { previous: string; next: string }): Row[] {
  // The cause is on the turn only from the release that added it. Compare the share without outside
  // causes only when both releases send causes, or the older release would look worse.
  const specs: MetricSpec[] = [
    { metric: "failed turns", column: "failed_share", unit: "share", floor: 0.02, minN: MIN_TURNS_FOR_SHARE },
  ];
  if (sendsCause(result, versions.previous) && sendsCause(result, versions.next)) {
    specs.push({
      metric: "failed turns, OpenBot causes",
      column: "own_failed_share",
      unit: "share",
      floor: 0.02,
      minN: MIN_TURNS_FOR_SHARE,
    });
  }
  return compare("failures", result, "provider", versions, specs);
}

/** Turns that ended, completed or failed, of each release. */
function turnTotal(failures: QueryResult, version: string): number {
  return failures.data
    .filter((row) => row.version === version)
    .reduce((total, row) => total + (value(row, "n") ?? 0), 0);
}

/** Error codes whose rate per 1,000 turns rose, most certain first. */
function errorRows(
  results: readonly { readonly metric: string; readonly result: QueryResult }[],
  versions: { previous: string; next: string },
  turns: { previous: number; next: number },
): Row[] {
  return results
    .flatMap(({ metric, result }) => {
      const codes = [...new Set(result.data.map((row) => String(row.code)))];
      const count = (version: string, code: string, column = "errors") =>
        value(
          result.data.find((row) => row.version === version && String(row.code) === code),
          column,
        ) ?? 0;
      return codes
        .filter((code) => count(versions.next, code, "computers") >= MIN_ERROR_COMPUTERS)
        .map((code) => {
          const previousN = count(versions.previous, code);
          const nextN = count(versions.next, code);
          return makeRow(
            {
              section: "errors",
              metric,
              group: code,
              unit: "per1k",
              previous: (previousN / turns.previous) * 1000,
              next: (nextN / turns.next) * 1000,
              previousN,
              nextN,
              z: rateZ(previousN, turns.previous, nextN, turns.next),
              judged: true,
            },
            ERROR_LIMITS,
          );
        });
    })
    .filter((row) => row.nextN >= MIN_ERRORS && (row.status === "red" || row.status === "yellow"))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (b.z ?? 0) - (a.z ?? 0));
}

function format(unit: Unit, amount: number | null): string {
  if (amount === null) return "-";
  if (unit === "share") return `${(amount * 100).toFixed(1)}%`;
  if (unit === "mb") return `${Math.round(amount)} MB`;
  if (unit === "per1k") return amount.toFixed(amount >= 10 ? 0 : 2);
  return amount >= 10_000 ? `${(amount / 1000).toFixed(1)} s` : `${Math.round(amount)} ms`;
}

function change(row: Row): string {
  if (row.previous === null || row.next === null) return "-";
  if (row.unit === "share") {
    const points = (row.next - row.previous) * 100;
    return `${points > 0 ? "+" : ""}${points.toFixed(1)} pp`;
  }
  if (row.previous === 0) return row.next > 0 ? "new" : "-";
  const percent = ((row.next - row.previous) / row.previous) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(0)}%`;
}

function table(report: Report): string[] {
  const header = ["", "metric", "group", report.previous, report.next, "change", "n"];
  const rows = report.rows.map((row) => [
    { red: "!", yellow: "?", green: "", waiting: "~" }[row.status],
    row.metric,
    row.group,
    format(row.unit, row.previous),
    format(row.unit, row.next),
    change(row),
    `${row.previousN}/${row.nextN}`,
  ]);
  const widths = header.map((name, index) => Math.max(name.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, index) => (index >= 3 ? cell.padStart(widths[index] ?? 0) : cell.padEnd(widths[index] ?? 0)))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)];
}

function verdict(report: Report): string {
  if (report.regressions.length === 0) return "No regression";
  const names = report.regressions.map((row) => `${row.metric} (${row.group})`);
  return `Regression: ${names.join(", ")}`;
}

function summary(report: Report): string {
  const early = report.early ? `, early sample: first seen ${report.nextFirstSeen.slice(0, 10)}` : "";
  return `Release regression check: ${report.next} against ${report.previous} (last ${WINDOW_DAYS} days, production${early})
${verdict(report)}. "!" regression, "?" to watch, "~" not judged yet.`;
}

interface Embed {
  readonly title: string;
  readonly description: string;
  readonly color: number;
  readonly footer?: { readonly text: string };
  readonly timestamp?: string;
}

/** Group names come from analytics. Keep them from changing the Discord formatting. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_~`|>#[\]()-]/gu, "\\$&");
}

function worst(rows: readonly Row[]): Status {
  return STATUS_ORDER.find((candidate) => rows.some((row) => row.status === candidate)) ?? "green";
}

/** Only waiting rows give waiting; otherwise waiting rows do not hide a green or yellow result. */
function overall(rows: readonly Row[]): Status {
  const judged = rows.filter((row) => row.status !== "waiting");
  return judged.length > 0 ? worst(judged) : "waiting";
}

function sectionColor(rows: readonly Row[]): number {
  return STATUS_COLOR[overall(rows)];
}

function statusLine(row: Row, label: string): string {
  const values = `${format(row.unit, row.previous)} → ${format(row.unit, row.next)}`;
  return `${STATUS_EMOJI[row.status]} ${label} · ${values} (${change(row)})`;
}

const RESOURCE_LABELS: Record<string, string> = {
  "main loop delay p95": "Main loop delay p95",
  "stall > 5 s (computer-days)": "Stalls over 5 s",
  "DB statement p95": "Database p95",
  "memory p95": "Memory p95",
  "renderer crash (computer-days)": "Renderer crashes",
  "crash loop (computer-days)": "Crash loops",
};

const ERROR_SOURCES: Record<string, string> = {
  "error code": "",
  "turn failure cause": " (failed turns)",
};

function sections(report: Report): Embed[] {
  const embeds: Embed[] = [];
  const add = (title: string, lines: readonly string[], rows: readonly Row[], footer: string, color?: number) => {
    if (lines.length === 0) return;
    embeds.push({
      title,
      description: fitDescription(lines),
      color: color ?? sectionColor(rows),
      footer: { text: footer },
    });
  };
  const of = (section: Section) => report.rows.filter((row) => row.section === section);
  const group = (row: Row) => `**${escapeMarkdown(row.group)}**`;
  const turns = of("turns");
  add(
    "Turn time",
    turns.map((row) => statusLine(row, `${group(row)} ${row.metric.replace("turn time ", "")}`)),
    turns,
    "Completed turns only. First output is the time to the first answer text.",
  );
  const startup = of("startup");
  add(
    "Startup",
    startup.map((row) => statusLine(row, `${group(row)} ${row.metric.replace("startup ", "")}`)),
    startup,
    "Time to a ready workspace. Starts after an update do not count.",
  );
  const failures = of("failures");
  add(
    "Failed turns",
    failures.map((row) =>
      statusLine(row, `${group(row)}${row.metric === "failed turns" ? "" : " OpenBot causes only"}`),
    ),
    failures,
    `Providers with ${MIN_TURNS_FOR_SHARE} turns or more in both releases. OpenBot causes leave out limits, sign-in, network and provider outages.`,
  );
  if (report.risenErrorCodes !== null) {
    const errors = of("errors");
    const more = report.risenErrorCodes - errors.length;
    add(
      "Errors per 1,000 turns",
      errors.length > 0
        ? errors.map((row) => statusLine(row, `${group(row)}${ERROR_SOURCES[row.metric] ?? ""}`))
        : [`${STATUS_EMOJI.green} No error code rose.`],
      errors,
      `${more > 0 ? `${more} more codes rose. ` : ""}Error events of each code per 1,000 turns; a code needs ${MIN_ERRORS} events on ${MIN_ERROR_COMPUTERS} computers in ${report.next}.`,
      errors.length > 0 ? undefined : STATUS_COLOR.green,
    );
  }
  const updates = of("updates");
  add(
    "Updates",
    updates.map((row) => statusLine(row, group(row))),
    updates,
    `Updating computers with a failed download or install: updates to ${report.previous} → updates to ${report.next}.`,
  );
  const resources = of("resources");
  for (const platform of [...new Set(resources.map((row) => row.group))]) {
    const rows = resources.filter((row) => row.group === platform);
    const computerDays = rows[0] ? `${rows[0].previousN} / ${rows[0].nextN} computer-days` : "";
    add(
      `Resources · ${platform}`,
      rows.map((row) => statusLine(row, RESOURCE_LABELS[row.metric] ?? row.metric)),
      rows,
      report.early
        ? `${computerDays}. ⚪ The daily summary comes a day late, so it mostly describes ${report.previous}.`
        : computerDays,
    );
  }
  return embeds;
}

/** Keeps whole lines within the Discord description limit. */
function fitDescription(lines: readonly string[]): string {
  const kept: string[] = [];
  let size = 0;
  for (const [index, line] of lines.entries()) {
    const rest = `… ${lines.length - index} more`;
    if (size + line.length + 1 + (index < lines.length - 1 ? rest.length + 1 : 0) > DISCORD_DESCRIPTION) {
      kept.push(rest);
      break;
    }
    kept.push(line);
    size += line.length + 1;
  }
  return kept.join("\n");
}

function headline(report: Report): Embed {
  const counts = STATUS_ORDER.map(
    (candidate) => [candidate, report.rows.filter((row) => row.status === candidate).length] as const,
  );
  const words: Record<Status, string> = {
    red: "regressed",
    yellow: "to watch",
    green: "fine",
    waiting: "waiting for data",
  };
  const tally = counts
    .filter(([, count]) => count > 0)
    .map(([candidate, count]) => `${STATUS_EMOJI[candidate]} ${count} ${words[candidate]}`)
    .join(" · ");
  const flagged = report.rows
    .filter((row) => row.status === "red" || row.status === "yellow")
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
    .map((row) => statusLine(row, `${row.metric} · **${escapeMarkdown(row.group)}**`));
  const early = report.early ? ` Early sample: first seen ${report.nextFirstSeen.slice(0, 10)}.` : "";
  return {
    title: `${STATUS_EMOJI[overall(report.rows)]} Release ${report.next} against ${report.previous}`,
    description: fitDescription([tally || `${STATUS_EMOJI.waiting} No metric has enough data.`, ...flagged]),
    color: sectionColor(report.rows),
    footer: {
      text: `Production, last ${WINDOW_DAYS} days.${early} 🔴 ${RELATIVE_LIMIT * 100}% worse and over the floor · 🟡 ${WATCH_LIMIT * 100}% worse and over half the floor · shares and error rates also need a significant rise · ⚪ not judged yet`,
    },
    timestamp: report.generatedAt,
  };
}

function embedSize(embed: Embed): number {
  return embed.title.length + embed.description.length + (embed.footer?.text.length ?? 0);
}

/** Packs the embeds into as few Discord messages as the limits allow. */
function discordMessages(report: Report): Embed[][] {
  const messages: Embed[][] = [];
  let current: Embed[] = [];
  let size = 0;
  for (const embed of [headline(report), ...sections(report)]) {
    if (
      current.length === DISCORD_EMBEDS ||
      (current.length > 0 && size + embedSize(embed) > DISCORD_EMBED_CHARACTERS)
    ) {
      messages.push(current);
      current = [];
      size = 0;
    }
    current.push(embed);
    size += embedSize(embed);
  }
  if (current.length > 0) messages.push(current);
  return messages;
}

async function sendDiscord(message: { readonly content?: string; readonly embeds?: readonly Embed[] }): Promise<void> {
  const url = process.env.RELEASE_REGRESSION_WEBHOOK_URL ?? "";
  if (!DISCORD_WEBHOOK.test(url)) throw new Error("RELEASE_REGRESSION_WEBHOOK_URL is not a Discord webhook URL.");
  let response: Response;
  try {
    response = await fetch(`${url}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // No mentions. The messages have no links, so they get no link previews.
      body: JSON.stringify({ ...message, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
  } catch {
    // The error text can contain the URL, which holds the webhook token. After a timeout, Discord can
    // still have posted the message.
    throw new Error("Cannot reach the Discord webhook, or it did not answer in time.");
  }
  if (!response.ok) throw new Error(`The Discord webhook returned HTTP ${response.status}.`);
}

/** A normal state some time after a release: nothing to compare, and nothing failed. */
const NO_PAIR = `Fewer than two releases have ${MIN_COMPUTERS} computers in the last ${WINDOW_DAYS} days; nothing to compare.`;

async function buildReport(connection: Connection): Promise<Report | null> {
  const { user, password } = await credentials();
  const query = (sql: string) => runQuery(connection, { user, password, sql, showIdentifiers: false });
  const versions = await query(versionsSql);
  const [newest, before] = versions.data;
  const next = String(newest?.version ?? "");
  const previous = String(before?.version ?? "");
  if (!VERSION.test(next) || !VERSION.test(previous)) return null;
  const nextFirstSeen = String(newest?.first_seen ?? "");
  const previousFirstSeen = String(before?.first_seen ?? "");
  if (!DATE_TIME.test(nextFirstSeen) || !DATE_TIME.test(previousFirstSeen)) {
    throw new Error("ClickHouse returned an unknown date format for the first event of a release.");
  }
  const pair = { previous, next };
  const both = [previous, next];
  // The read-only user may run 2 queries at a time, and a person can be using one.
  const turns = await query(turnSql(both));
  const startup = await query(startupSql(both));
  const failures = await query(failureSql(both));
  const errorCodes = await query(errorCodeSql(both));
  const causes = sendsCause(failures, previous) && sendsCause(failures, next) ? await query(causeSql(both)) : null;
  // The SQL compares whole seconds.
  const updates = await query(updateSql(pair, previousFirstSeen.slice(0, 19), nextFirstSeen.slice(0, 19)));
  const resources = await query(resourceSql(both));
  const firstSeenTime = Date.parse(`${nextFirstSeen.replace(" ", "T")}Z`);
  const early = Date.now() - firstSeenTime < EARLY_DAYS * 86_400_000;
  const turnTotals = { previous: turnTotal(failures, previous), next: turnTotal(failures, next) };
  const ratesJudged = turnTotals.previous >= MIN_TURNS_FOR_RATE && turnTotals.next >= MIN_TURNS_FOR_RATE;
  const risenErrors = ratesJudged
    ? errorRows(
        [
          { metric: "error code", result: errorCodes },
          ...(causes ? [{ metric: "turn failure cause", result: causes }] : []),
        ],
        pair,
        turnTotals,
      )
    : [];
  const rows = [
    ...compare("turns", turns, "platform", pair, TURN_METRICS),
    ...compare("startup", startup, "platform", pair, STARTUP_METRICS),
    ...failureRows(failures, pair),
    ...risenErrors.slice(0, MAX_ERROR_ROWS),
    ...compare("updates", updates, "platform", pair, UPDATE_METRICS),
    // system_resources summarizes the previous local day but carries the version that sends it, so the
    // first days of a release mostly describe the release before it.
    ...compare("resources", resources, "platform", pair, RESOURCE_METRICS, !early),
  ];
  return {
    generatedAt: new Date(Date.now()).toISOString(),
    previous,
    next,
    nextFirstSeen,
    early,
    rows,
    regressions: rows.filter((row) => row.regression),
    risenErrorCodes: ratesJudged ? risenErrors.length : null,
  };
}

function buildDirectory(): string {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  return join(projectRoot, ".openbot-build", "release-regression");
}

async function writeReport(report: Report): Promise<string> {
  const path = join(buildDirectory(), "report.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

/**
 * The state file is in the GitHub Actions cache, which pull requests of this public repository can read.
 * It holds only an HMAC of the statuses, keyed by the private webhook URL, so it shows nothing.
 */
const FINGERPRINT = /^[0-9a-f]{64}$/u;

function fingerprint(report: Report): string {
  const statuses = report.rows.map((row) => `${row.metric}|${row.group}|${row.status}`).sort();
  return createHmac("sha256", process.env.RELEASE_REGRESSION_WEBHOOK_URL ?? "")
    .update([`${report.previous}>${report.next}`, ...statuses].join("\n"))
    .digest("hex");
}

/** The fingerprint of the last report that was sent; null when there is none or after a failure. */
async function readState(path: string): Promise<string | null> {
  const text = await readFile(path, "utf8").catch(() => "");
  const sent = text.trim();
  return FINGERPRINT.test(sent) ? sent : null;
}

async function writeState(path: string, sent: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${sent}\n`);
}

/** Without state, every run sends. With state, a run sends on a change and once a week. */
function shouldSend(sent: string | null, current: string, always: boolean): boolean {
  const monday = new Date(Date.now()).getUTCDay() === 1;
  return always || monday || sent !== current;
}

async function main(): Promise<void> {
  const parsed = readScriptArguments({
    usage: USAGE,
    maxPositionals: 0,
    options: {
      discord: { type: "boolean" },
      quiet: { type: "boolean" },
      state: { type: "string" },
      always: { type: "boolean" },
    },
  });
  if (!parsed) return;
  const discord = parsed.values.discord === true;
  const quiet = parsed.values.quiet === true;
  const statePath = parsed.values.state;
  try {
    const connection = await connectClickHouse();
    let report: Report | null;
    try {
      report = await buildReport(connection);
    } finally {
      connection.close();
    }
    if (!report) {
      process.stdout.write(`${NO_PAIR}\n`);
      return;
    }
    const path = await writeReport(report);
    const current = fingerprint(report);
    const state = statePath ? await readState(statePath) : null;
    const send = discord && (!statePath || shouldSend(state, current, parsed.values.always === true));
    if (send) {
      for (const embeds of discordMessages(report)) await sendDiscord({ embeds });
    }
    if (statePath && send) await writeState(statePath, current);
    if (quiet) {
      const line = send
        ? "The report was sent to Discord."
        : discord
          ? "No status changed; nothing was sent."
          : "The report was written.";
      process.stdout.write(`${line}\n`);
    } else {
      process.stdout.write(`${summary(report)}\n\n${table(report).join("\n")}\n\n${path}\n`);
    }
  } catch (error) {
    const detail = redactText(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    // A failure clears the state, so the next good run sends the full report again.
    if (statePath) await writeState(statePath, "").catch(() => undefined);
    if (!quiet) {
      process.stderr.write(`${detail}\n`);
      return;
    }
    // Public log: no detail. The detail goes to the private channel when it can.
    process.stderr.write("The release regression report failed.\n");
    if (discord) {
      await sendDiscord({
        embeds: [{ title: "🔴 Release regression check failed", description: detail, color: STATUS_COLOR.red }],
      }).catch(() => {
        process.stderr.write("The failure could not be sent to Discord.\n");
      });
    }
  }
}

if (import.meta.main) await main();
