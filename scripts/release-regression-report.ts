import { mkdir, writeFile } from "node:fs/promises";
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
// to the private Discord channel.
const USAGE = `Usage:
  bun scripts/release-regression-report.ts [options]
Options:
  --discord   send the report to RELEASE_REGRESSION_WEBHOOK_URL
  --quiet     print one line with no data (for public CI logs); errors go to Discord only`;

const WINDOW_DAYS = 14;
const MIN_COMPUTERS = 30;
const MIN_SAMPLES = 20;
const MIN_TURNS_FOR_SHARE = 200;
const EARLY_DAYS = 2;
/** A metric regresses when it is this much worse, relative, and also worse by its floor. */
const RELATIVE_LIMIT = 0.2;
/** A metric needs watching when it is this much worse, relative, and also worse by half its floor. */
const WATCH_LIMIT = 0.1;
/** Causes that the user's provider account decides, not OpenBot. */
const ACCOUNT_CAUSES = ["usage_limit", "rate_limit", "billing"];
const VERSION = /^\d+\.\d+\.\d+$/u;
const DISCORD_WEBHOOK = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/u;
/** Discord allows 6000 characters and 10 embeds in one message. */
const DISCORD_EMBED_CHARACTERS = 5800;
const DISCORD_EMBEDS = 10;

type Unit = "ms" | "mb" | "share";
/** red: regression. yellow: worse, below the regression limit. waiting: the sample cannot show it yet. */
type Status = "red" | "yellow" | "green" | "waiting";

const STATUS_EMOJI: Record<Status, string> = { red: "🔴", yellow: "🟡", green: "🟢", waiting: "⚪" };
const STATUS_COLOR: Record<Status, number> = { red: 0xed4245, yellow: 0xfee75c, green: 0x57f287, waiting: 0x99aab5 };
const STATUS_ORDER: readonly Status[] = ["red", "yellow", "green", "waiting"];

interface Row {
  readonly metric: string;
  readonly group: string;
  readonly unit: Unit;
  readonly previous: number | null;
  readonly next: number | null;
  readonly previousN: number;
  readonly nextN: number;
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
}

interface MetricSpec {
  readonly metric: string;
  readonly column: string;
  readonly unit: Unit;
  /** The smallest absolute change that counts, in the metric's unit. */
  readonly floor: number;
  readonly minN: number;
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

const turnSql = (versions: readonly string[]) => `SELECT
  properties['app_version'] AS version,
  properties['platform'] AS platform,
  countIf(properties['status'] = 'completed') AS n,
  quantileExactIf(0.5)(${number("duration_ms")}, properties['status'] = 'completed') AS turn_p50,
  quantileExactIf(0.95)(${number("duration_ms")}, properties['status'] = 'completed') AS turn_p95
FROM events
WHERE name = 'system_turn_completed' AND ${environment} AND ${window}
  AND properties['app_version'] IN (${versionList(versions)})
GROUP BY version, platform`;

const failureSql = (versions: readonly string[]) => `SELECT
  properties['app_version'] AS version,
  properties['provider'] AS provider,
  countIf(properties['status'] IN ('completed', 'failed')) AS n,
  countIf(properties['status'] = 'failed') / n AS failed_share,
  countIf(properties['status'] = 'failed' AND properties['cause_code'] != '') AS with_cause,
  countIf(properties['status'] = 'failed'
    AND properties['cause_code'] NOT IN (${versionList(ACCOUNT_CAUSES)})) / n AS own_failed_share
FROM events
WHERE name = 'system_turn_completed' AND ${environment} AND ${window}
  AND properties['app_version'] IN (${versionList(versions)})
GROUP BY version, provider`;

const resourceSql = (versions: readonly string[]) => `SELECT
  properties['app_version'] AS version,
  properties['platform'] AS platform,
  count() AS n,
  quantileExact(0.95)(${number("main_loop_delay_ms_p95")}) AS loop_p95,
  avg(toFloat64OrZero(properties['main_loop_delay_ms_max']) > 5000) AS stall_share,
  quantileExact(0.95)(${number("db_request_ms_p95")}) AS db_p95,
  quantileExact(0.95)(${number("total_rss_mb_p95")}) AS memory_p95,
  avg(toFloat64OrZero(properties['child_gone_count']) > 1000) AS crash_loop_share
FROM events
WHERE name = 'system_resources' AND ${environment} AND ${window}
  AND properties['app_version'] IN (${versionList(versions)})
GROUP BY version, platform`;

const TURN_METRICS: readonly MetricSpec[] = [
  { metric: "turn time p50", column: "turn_p50", unit: "ms", floor: 1_000, minN: MIN_SAMPLES },
  { metric: "turn time p95", column: "turn_p95", unit: "ms", floor: 5_000, minN: MIN_SAMPLES },
];
const RESOURCE_METRICS: readonly MetricSpec[] = [
  { metric: "main loop delay p95", column: "loop_p95", unit: "ms", floor: 50, minN: MIN_SAMPLES },
  { metric: "stall > 5 s (computer-days)", column: "stall_share", unit: "share", floor: 0.02, minN: MIN_SAMPLES },
  { metric: "DB statement p95", column: "db_p95", unit: "ms", floor: 100, minN: MIN_SAMPLES },
  { metric: "memory p95", column: "memory_p95", unit: "mb", floor: 150, minN: MIN_SAMPLES },
  { metric: "crash loop (computer-days)", column: "crash_loop_share", unit: "share", floor: 0.01, minN: MIN_SAMPLES },
];

type ResultRow = QueryResult["data"][number];

function value(row: ResultRow | undefined, column: string): number | null {
  const raw = row?.[column];
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Every metric is worse when it is higher. */
function status(spec: MetricSpec, previous: Row["previous"], next: Row["next"], judged: boolean): Status {
  if (!judged) return "waiting";
  if (previous === null || next === null) return "green";
  const worse = (relative: number, floor: number) => next - previous >= floor && next > previous * (1 + relative);
  if (worse(RELATIVE_LIMIT, spec.floor)) return "red";
  return worse(WATCH_LIMIT, spec.floor / 2) ? "yellow" : "green";
}

function compare(
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
    const counts: [number, number] = [value(before, "n") ?? 0, value(after, "n") ?? 0];
    return specs
      .filter((spec) => counts[0] >= spec.minN && counts[1] >= spec.minN)
      .map((spec) => {
        const previous = value(before, spec.column);
        const next = value(after, spec.column);
        const rowStatus = status(spec, previous, next, judged);
        return {
          metric: spec.metric,
          group,
          unit: spec.unit,
          previous,
          next,
          previousN: counts[0],
          nextN: counts[1],
          status: rowStatus,
          regression: rowStatus === "red",
          judged,
        };
      });
  });
}

function failureRows(result: QueryResult, versions: { previous: string; next: string }): Row[] {
  // The cause is on the turn only from the release that added it. Compare the share without account
  // causes only when both releases send causes, or the older release would look worse.
  const withCause = (version: string) =>
    result.data.some((row) => row.version === version && (value(row, "with_cause") ?? 0) > 0);
  const specs: MetricSpec[] = [
    { metric: "failed turns", column: "failed_share", unit: "share", floor: 0.02, minN: MIN_TURNS_FOR_SHARE },
  ];
  if (withCause(versions.previous) && withCause(versions.next)) {
    specs.push({
      metric: "failed turns, not account",
      column: "own_failed_share",
      unit: "share",
      floor: 0.02,
      minN: MIN_TURNS_FOR_SHARE,
    });
  }
  return compare(result, "provider", versions, specs);
}

function format(unit: Unit, amount: number | null): string {
  if (amount === null) return "-";
  if (unit === "share") return `${(amount * 100).toFixed(1)}%`;
  if (unit === "mb") return `${Math.round(amount)} MB`;
  return amount >= 10_000 ? `${(amount / 1000).toFixed(1)} s` : `${Math.round(amount)} ms`;
}

function change(row: Row): string {
  if (row.previous === null || row.next === null) return "-";
  if (row.unit === "share") return `${((row.next - row.previous) * 100).toFixed(1)} pp`;
  if (row.previous === 0) return "-";
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

function sectionColor(rows: readonly Row[]): number {
  // A section with only waiting rows is grey; waiting rows do not hide a green or yellow result.
  const judged = rows.filter((row) => row.status !== "waiting");
  return STATUS_COLOR[judged.length > 0 ? worst(judged) : "waiting"];
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
  "crash loop (computer-days)": "Crash loops",
};

function sections(report: Report): Embed[] {
  const embeds: Embed[] = [];
  const add = (title: string, rows: readonly Row[], line: (row: Row) => string, footer?: string) => {
    if (rows.length === 0) return;
    embeds.push({
      title,
      description: rows.map(line).join("\n"),
      color: sectionColor(rows),
      ...(footer ? { footer: { text: footer } } : {}),
    });
  };
  const turns = report.rows.filter((row) => row.metric.startsWith("turn time"));
  add(
    "Turn time",
    turns,
    (row) => statusLine(row, `**${escapeMarkdown(row.group)}** ${row.metric.replace("turn time ", "")}`),
    "Completed turns only.",
  );
  const failures = report.rows.filter((row) => row.metric.startsWith("failed turns"));
  add(
    "Failed turns",
    failures,
    (row) =>
      statusLine(
        row,
        `**${escapeMarkdown(row.group)}**${row.metric === "failed turns" ? "" : " without account limits"}`,
      ),
    `Providers with ${MIN_TURNS_FOR_SHARE} turns or more in both releases.`,
  );
  const resources = report.rows.filter((row) => !turns.includes(row) && !failures.includes(row));
  for (const platform of [...new Set(resources.map((row) => row.group))]) {
    const rows = resources.filter((row) => row.group === platform);
    const computerDays = rows[0] ? `${rows[0].previousN} / ${rows[0].nextN} computer-days` : "";
    add(
      `Resources · ${platform}`,
      rows,
      (row) => statusLine(row, RESOURCE_LABELS[row.metric] ?? row.metric),
      report.early
        ? `${computerDays}. ⚪ The daily summary comes a day late, so it mostly describes ${report.previous}.`
        : computerDays,
    );
  }
  return embeds;
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
    title: `${STATUS_EMOJI[worst(report.rows.filter((row) => row.status !== "waiting"))]} Release ${report.next} against ${report.previous}`,
    description: [tally, ...flagged].join("\n"),
    color: sectionColor(report.rows),
    footer: {
      text: `Production, last ${WINDOW_DAYS} days.${early} 🔴 ${RELATIVE_LIMIT * 100}% worse and over the floor · 🟡 ${WATCH_LIMIT * 100}% worse and over half the floor · ⚪ not judged yet`,
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
    if (current.length === DISCORD_EMBEDS || size + embedSize(embed) > DISCORD_EMBED_CHARACTERS) {
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
    });
  } catch {
    // The error text can contain the URL, which holds the webhook token.
    throw new Error("Cannot reach the Discord webhook.");
  }
  if (!response.ok) throw new Error(`The Discord webhook returned HTTP ${response.status}.`);
}

async function query(connection: Connection, sql: string): Promise<QueryResult> {
  const { user, password } = await credentials();
  return runQuery(connection, { user, password, sql, showIdentifiers: false });
}

async function buildReport(connection: Connection): Promise<Report> {
  const versions = await query(connection, versionsSql);
  const [newest, before] = versions.data;
  const next = String(newest?.version ?? "");
  const previous = String(before?.version ?? "");
  if (!VERSION.test(next) || !VERSION.test(previous)) {
    throw new Error(`Fewer than two releases have ${MIN_COMPUTERS} computers in the last ${WINDOW_DAYS} days.`);
  }
  const pair = { previous, next };
  // The read-only user may run 2 queries at a time, and a person can be using one.
  const turns = await query(connection, turnSql([previous, next]));
  const failures = await query(connection, failureSql([previous, next]));
  const resources = await query(connection, resourceSql([previous, next]));
  const nextFirstSeen = String(newest?.first_seen ?? "");
  const firstSeenTime = Date.parse(`${nextFirstSeen.replace(" ", "T")}Z`);
  const early = Number.isFinite(firstSeenTime) && Date.now() - firstSeenTime < EARLY_DAYS * 86_400_000;
  const rows = [
    ...compare(turns, "platform", pair, TURN_METRICS),
    ...failureRows(failures, pair),
    // system_resources summarizes the previous local day but carries the version that sends it, so the
    // first days of a release mostly describe the release before it.
    ...compare(resources, "platform", pair, RESOURCE_METRICS, !early),
  ];
  return {
    generatedAt: new Date().toISOString(),
    previous,
    next,
    nextFirstSeen,
    early,
    rows,
    regressions: rows.filter((row) => row.regression),
  };
}

async function writeReport(report: Report): Promise<string> {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const path = join(projectRoot, ".openbot-build", "release-regression", "report.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

async function main(): Promise<void> {
  const parsed = readScriptArguments({
    usage: USAGE,
    maxPositionals: 0,
    options: { discord: { type: "boolean" }, quiet: { type: "boolean" } },
  });
  if (!parsed) return;
  const discord = parsed.values.discord === true;
  const quiet = parsed.values.quiet === true;
  try {
    const connection = await connectClickHouse();
    let report: Report;
    try {
      report = await buildReport(connection);
    } finally {
      connection.close();
    }
    const path = await writeReport(report);
    if (discord) {
      for (const embeds of discordMessages(report)) await sendDiscord({ embeds });
    }
    if (quiet) {
      process.stdout.write(discord ? "The report was sent to Discord.\n" : "The report was written.\n");
    } else {
      process.stdout.write(`${summary(report)}\n\n${table(report).join("\n")}\n\n${path}\n`);
    }
  } catch (error) {
    const detail = redactText(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
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
