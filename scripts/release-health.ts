import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactText } from "@openbot/logging";
import { Schema } from "effect";
import { connectClickHouse, credentials, type QueryResult, runQuery } from "./openpanel-sql";
import { readScriptArguments } from "./script-arguments";

// Do the computers that get a new desktop release start it and keep it running as well as the
// release before it? This is the check before a staged rollout goes to 100% (docs/RELEASING.md).
//
// It compares the two releases over the same hours after each GitHub Release was published: the new
// release from its publish time to now, and the previous release over the same number of hours from
// its own publish time. It reads production analytics in the OpenPanel ClickHouse with the read-only
// user (scripts/openpanel-sql.ts) and writes .openbot-build/release-health/report.json.
//
// Events (ANALYTICS.md):
// - system_startup: one start of the main process that loaded its window. `workspace_ready_ms` is a
//   finished start; `start_kind = updated` is the first start after an update install.
// - system_unclean_exit: sent at the next start; `previous_app_version` is the release that stopped.
// - update_action install succeeded: the renderer of the old release handed over to the installer.
//   It has no target version: after a release is published, an install goes to that release.
//
// Groups: darwin, win32 and linux desktops, `server` (host_kind server on any platform), and `all`.
//
// Metrics and thresholds. "Worse" stops the rollout; "watch" only shows in the table.
// - finished starts: desktop starts with a ready workspace, per start. A start that waits at sign-in
//   or setup also counts as not finished, in both releases. Worse when the share is 3 percentage
//   points lower and the drop is significant (one-sided z >= 3.09, p < 0.001). Watch at 1.5 points
//   and z >= 1.645 (p < 0.05). Servers have no workspace in a window, so this metric is desktop only.
// - crashes: unclean exits of the release in phase `running` (a crash, a force quit or a kill),
//   without an OS restart and not while asleep, per 100 starts. Worse when 1 more per 100 starts,
//   1.5 times as many, and z >= 3.09 (Poisson). Watch at 0.5, 1.2 times and z >= 1.645.
// - startup crashes: the crashes in the first minute of a run. Worse at 0.5 more per 100 starts,
//   1.5 times and z >= 3.09. Watch at 0.25, 1.2 times and z >= 1.645.
// - quit hangs: unclean exits in phase `quitting` or `quit_timeout`, per 100 starts. Worse at 3 more,
//   1.25 times and z >= 3.09. Watch at 1.5, 1.1 times and z >= 1.645.
// - update arrivals: of the desktop computers that started an update install in the window, the
//   share that then started the release. A brick shows here first. Worse when 5 points lower and
//   z >= 3.09, or below 50% with 20 installs or more whatever the previous release did. Watch at
//   2.5 points and z >= 1.645. Installs in the last 15 minutes of the window do not count yet.
// - starts, computers, update installs (computers with an `updated` start) and the start time p50
//   are not judged: they depend on the rollout share and on the hour of the day.
// A rate needs 200 starts and an arrival share 50 installs in both releases in that group, else the
// row is "waiting".
//
// Exit code: 0 when no row is worse and every metric of group `all` has enough data; 1 when a row is
// worse; 2 for an error or a wrong argument; 3 when no row is worse but `all` is still waiting.
const USAGE = `Usage:
  bun scripts/release-health.ts <version | latest> [options]
Options:
  --previous <version>  compare with this release (default: the release before <version>)
  --hours <n>           compare the first n hours after each release (default: all hours, at most 72)
  --quiet               print one line with no data (for public CI logs)
  --discord             when a row is worse or the check fails, post to RELEASE_REGRESSION_WEBHOOK_URL
  --state <file>        with --discord: post the same worse rows of a release only once
  --max-age <hours>     stop with code 0 when <version> is older than this (for the scheduled run)`;

const REPOSITORY = "nightly-labs/openbot";
const MAX_WINDOW_HOURS = 72;
const MIN_STARTS = 200;
const MIN_INSTALLS = 50;
/** Installs this close to the end of the window can still be on their way to the new release. */
const ARRIVAL_MARGIN_MINUTES = 15;
const BRICK_SHARE = 0.5;
const BRICK_MIN_INSTALLS = 20;
const WORSE_Z = 3.09;
const WATCH_Z = 1.645;
const GROUPS = ["all", "darwin", "win32", "linux", "server"] as const;
const DESKTOP_GROUPS = new Set(["all", "darwin", "win32", "linux"]);
const VERSION = /^v?(\d+\.\d+\.\d+)$/u;
const DISCORD_WEBHOOK = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/u;
const NETWORK_TIMEOUT_MS = 30_000;

type Status = "worse" | "watch" | "ok" | "waiting" | "info";
type Unit = "count" | "share" | "per100" | "ms";

/** A judged metric: how much worse counts, in its unit, and how sure the change must be. */
interface Limit {
  readonly floor: number;
  /** The ratio new/previous that also counts; 1 for shares, which use the floor only. */
  readonly ratio: number;
  readonly z: number;
}

interface MetricSpec {
  readonly metric: string;
  readonly unit: Unit;
  /** True when a lower value is worse. */
  readonly lowerIsWorse: boolean;
  readonly worse: Limit;
  readonly watch: Limit;
  readonly minN: number;
}

const METRICS = {
  finished: {
    metric: "finished starts",
    unit: "share",
    lowerIsWorse: true,
    worse: { floor: 0.03, ratio: 1, z: WORSE_Z },
    watch: { floor: 0.015, ratio: 1, z: WATCH_Z },
    minN: MIN_STARTS,
  },
  crashes: {
    metric: "crashes",
    unit: "per100",
    lowerIsWorse: false,
    worse: { floor: 1, ratio: 1.5, z: WORSE_Z },
    watch: { floor: 0.5, ratio: 1.2, z: WATCH_Z },
    minN: MIN_STARTS,
  },
  startupCrashes: {
    metric: "startup crashes (< 1 min)",
    unit: "per100",
    lowerIsWorse: false,
    worse: { floor: 0.5, ratio: 1.5, z: WORSE_Z },
    watch: { floor: 0.25, ratio: 1.2, z: WATCH_Z },
    minN: MIN_STARTS,
  },
  quitHangs: {
    metric: "quit hangs",
    unit: "per100",
    lowerIsWorse: false,
    worse: { floor: 3, ratio: 1.25, z: WORSE_Z },
    watch: { floor: 1.5, ratio: 1.1, z: WATCH_Z },
    minN: MIN_STARTS,
  },
  arrivals: {
    metric: "update arrivals",
    unit: "share",
    lowerIsWorse: true,
    worse: { floor: 0.05, ratio: 1, z: WORSE_Z },
    watch: { floor: 0.025, ratio: 1, z: WATCH_Z },
    minN: MIN_INSTALLS,
  },
} as const satisfies Record<string, MetricSpec>;

interface Release {
  readonly version: string;
  readonly publishedAt: string;
}

interface Window {
  readonly version: string;
  readonly from: string;
  readonly to: string;
  /** The end of the install window for arrivals: earlier when a newer release came out before `to`. */
  readonly installsTo: string;
}

interface Row {
  readonly group: string;
  readonly metric: string;
  readonly unit: Unit;
  readonly previous: number | null;
  readonly next: number | null;
  /** The sample of the metric: starts, or installs for arrivals. */
  readonly previousN: number;
  readonly nextN: number;
  readonly z: number | null;
  readonly status: Status;
}

interface Report {
  readonly generatedAt: string;
  readonly next: Release;
  readonly previous: Release;
  readonly hours: number;
  readonly windows: { readonly previous: Window; readonly next: Window };
  readonly thresholds: typeof METRICS;
  readonly rows: readonly Row[];
  readonly worse: readonly Row[];
  readonly result: "pass" | "worse" | "waiting";
  readonly exitCode: 0 | 1 | 3;
}

// --- GitHub releases --------------------------------------------------------------------------------

const decodeReleases = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        tag_name: Schema.String,
        published_at: Schema.NullOr(Schema.String),
        draft: Schema.Boolean,
        prerelease: Schema.Boolean,
      }),
    ),
  ),
);

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function publishedReleases(): Promise<Release[]> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=50`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "openbot-release-health",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Cannot reach the GitHub API to read the release times.");
  }
  if (!response.ok) throw new Error(`The GitHub API returned HTTP ${response.status} for the releases.`);
  let releases: ReturnType<typeof decodeReleases>;
  try {
    releases = decodeReleases(await response.text());
  } catch {
    throw new Error("The GitHub API returned no release list.");
  }
  return releases.flatMap((item) => {
    if (item.draft || item.prerelease) return [];
    const version = /^v(\d+\.\d+\.\d+)$/u.exec(item.tag_name)?.[1];
    const publishedAt = item.published_at ?? "";
    if (!version || Number.isNaN(Date.parse(publishedAt))) return [];
    return [{ version, publishedAt: new Date(publishedAt).toISOString() }];
  });
}

interface Pair {
  readonly next: Release;
  readonly previous: Release;
  /** When the first release newer than `next` was published, if one is. */
  readonly nextFollowedAt: string | undefined;
  readonly previousFollowedAt: string | undefined;
}

function pickReleases(releases: readonly Release[], wanted: string, wantedPrevious: string | undefined): Pair {
  const sorted = [...releases].sort((a, b) => compareVersions(b.version, a.version));
  const next = wanted === "latest" ? sorted[0] : sorted.find((release) => release.version === wanted);
  if (!next) throw new Error(`No published GitHub Release has the version ${wanted}.`);
  const previous = wantedPrevious
    ? sorted.find((release) => release.version === wantedPrevious)
    : sorted.find((release) => compareVersions(release.version, next.version) < 0);
  if (!previous) throw new Error(`No published GitHub Release comes before ${next.version}.`);
  if (compareVersions(previous.version, next.version) >= 0) {
    throw new Error(`--previous must be older than ${next.version}.`);
  }
  // After a newer release is out, an install goes to that release, so it ends the install window.
  const followedAt = (release: Release) =>
    sorted.findLast((other) => compareVersions(other.version, release.version) > 0)?.publishedAt;
  return { next, previous, nextFollowedAt: followedAt(next), previousFollowedAt: followedAt(previous) };
}

// --- SQL --------------------------------------------------------------------------------------------

const environment = "properties['environment'] = 'production'";
const group = "if(properties['host_kind'] = 'server', 'server', properties['platform'])";
const number = (key: string) => `toFloat64OrNull(properties['${key}'])`;

/** ClickHouse DateTime literal from an ISO time, in whole seconds (the column is UTC). */
function at(iso: string): string {
  return `toDateTime('${iso.slice(0, 19).replace("T", " ")}', 'UTC')`;
}

function inWindow(window: Window, versionColumn: string, end = window.to): string {
  return `(${versionColumn} = '${window.version}' AND created_at >= ${at(window.from)} AND created_at < ${at(end)})`;
}

const startsSql = (windows: readonly Window[]) => `SELECT
  properties['app_version'] AS version,
  ${group} AS grp,
  count() AS starts,
  uniqExact(profile_id) AS computers,
  countIf(properties['host_kind'] != 'server') AS desktop_starts,
  countIf(properties['host_kind'] != 'server' AND isNotNull(${number("workspace_ready_ms")})) AS finished,
  uniqExactIf(profile_id, properties['start_kind'] = 'updated') AS updated_computers,
  quantileExactIf(0.5)(${number("workspace_ready_ms")}, properties['host_kind'] != 'server') AS ready_p50
FROM events
WHERE name = 'system_startup' AND ${environment}
  AND (${windows.map((window) => inWindow(window, "properties['app_version']")).join(" OR ")})
GROUP BY version, grp WITH ROLLUP`;

const crash =
  "properties['phase'] = 'running' AND properties['os_restarted'] != 'true' AND properties['ended_asleep'] != 'true'";

const exitsSql = (windows: readonly Window[]) => `SELECT
  properties['previous_app_version'] AS version,
  ${group} AS grp,
  countIf(${crash}) AS crashes,
  countIf(${crash} AND properties['uptime_class'] = 'lt1m') AS startup_crashes,
  countIf(properties['phase'] IN ('quitting', 'quit_timeout')) AS quit_hangs
FROM events
WHERE name = 'system_unclean_exit' AND ${environment}
  AND (${windows.map((window) => inWindow(window, "properties['previous_app_version']")).join(" OR ")})
GROUP BY version, grp WITH ROLLUP`;

// One row per computer and target release: the first install it started in the window. It arrived
// when it sent a start of that release at or after the install. The profile is an account for a user
// who shares analytics, so "at or after" also keeps another computer of the account from counting.
const arrivalsSql = (windows: readonly Window[]) => {
  const target = `multiIf(${windows
    .map((window) => `created_at >= ${at(window.from)} AND created_at < ${at(window.installsTo)}, '${window.version}'`)
    .join(", ")}, '')`;
  return `SELECT
  installs.version AS version,
  installs.grp AS grp,
  count() AS installs,
  countIf(starts.last_start >= installs.installed_at) AS arrived
FROM (
  SELECT profile_id, ${target} AS version, any(properties['platform']) AS grp, min(created_at) AS installed_at
  FROM events
  WHERE name = 'update_action' AND ${environment}
    AND properties['action'] = 'install' AND properties['result'] = 'succeeded'
    AND created_at >= ${at(windows.map((window) => window.from).sort()[0] ?? "")}
    AND created_at < ${at(
      windows
        .map((window) => window.installsTo)
        .sort()
        .at(-1) ?? "",
    )}
    AND version != '' AND properties['app_version'] != version
  GROUP BY profile_id, version
) AS installs
LEFT JOIN (
  SELECT profile_id, properties['app_version'] AS version, max(created_at) AS last_start
  FROM events
  WHERE name = 'system_startup' AND ${environment}
    AND (${windows.map((window) => inWindow(window, "properties['app_version']")).join(" OR ")})
  GROUP BY profile_id, version
) AS starts ON installs.profile_id = starts.profile_id AND installs.version = starts.version
GROUP BY version, grp WITH ROLLUP`;
};

// --- Comparison -------------------------------------------------------------------------------------

type ResultRow = QueryResult["data"][number];

function value(row: ResultRow | undefined, column: string): number {
  const raw = row?.[column];
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The row of a version and group. WITH ROLLUP gives the version total an empty group: `all`. */
function find(result: QueryResult, version: string, groupName: string): ResultRow | undefined {
  return result.data.find(
    (row) => row.version === version && (groupName === "all" ? row.grp === "" : row.grp === groupName),
  );
}

/** One-sided two-proportion z: how sure the share fell. */
function shareDropZ(previous: number, previousN: number, next: number, nextN: number): number {
  const pooled = (previous * previousN + next * nextN) / (previousN + nextN);
  const error = Math.sqrt(pooled * (1 - pooled) * (1 / previousN + 1 / nextN));
  if (error === 0) return previous > next ? Number.POSITIVE_INFINITY : 0;
  return (previous - next) / error;
}

/** One-sided Poisson z for two event counts per start: how sure the rate rose. */
function rateRiseZ(previousCount: number, previousStarts: number, nextCount: number, nextStarts: number): number {
  const error = Math.sqrt(previousCount / previousStarts ** 2 + nextCount / nextStarts ** 2);
  if (error === 0) return 0;
  return (nextCount / nextStarts - previousCount / previousStarts) / error;
}

function judge(spec: MetricSpec, previous: number, next: number, z: number): Status {
  const meets = (limit: Limit) => {
    if (z < limit.z) return false;
    if (spec.lowerIsWorse) return previous - next >= limit.floor;
    return next - previous >= limit.floor && next >= previous * limit.ratio;
  };
  if (meets(spec.worse)) return "worse";
  return meets(spec.watch) ? "watch" : "ok";
}

function shareRow(
  groupName: string,
  spec: MetricSpec,
  counts: { previous: number; previousN: number; next: number; nextN: number },
  brick = false,
): Row {
  const previous = counts.previousN > 0 ? counts.previous / counts.previousN : null;
  const next = counts.nextN > 0 ? counts.next / counts.nextN : null;
  const base = { group: groupName, metric: spec.metric, unit: spec.unit, previous, next };
  const sizes = { previousN: counts.previousN, nextN: counts.nextN };
  // A release that most updating computers do not reach is a brick, whatever the previous release did.
  if (brick && next !== null && counts.nextN >= BRICK_MIN_INSTALLS && next < BRICK_SHARE) {
    return { ...base, ...sizes, z: null, status: "worse" };
  }
  if (previous === null || next === null || counts.previousN < spec.minN || counts.nextN < spec.minN) {
    return { ...base, ...sizes, z: null, status: "waiting" };
  }
  const z = shareDropZ(previous, counts.previousN, next, counts.nextN);
  return { ...base, ...sizes, z, status: judge(spec, previous, next, z) };
}

function rateRow(
  groupName: string,
  spec: MetricSpec,
  counts: { previous: number; previousN: number; next: number; nextN: number },
): Row {
  const previous = counts.previousN > 0 ? (counts.previous / counts.previousN) * 100 : null;
  const next = counts.nextN > 0 ? (counts.next / counts.nextN) * 100 : null;
  const base = { group: groupName, metric: spec.metric, unit: spec.unit, previous, next };
  const sizes = { previousN: counts.previousN, nextN: counts.nextN };
  if (previous === null || next === null || counts.previousN < spec.minN || counts.nextN < spec.minN) {
    return { ...base, ...sizes, z: null, status: "waiting" };
  }
  const z = rateRiseZ(counts.previous, counts.previousN, counts.next, counts.nextN);
  return { ...base, ...sizes, z, status: judge(spec, previous, next, z) };
}

function infoRow(groupName: string, metric: string, unit: Unit, previous: number, next: number): Row {
  return { group: groupName, metric, unit, previous, next, previousN: 0, nextN: 0, z: null, status: "info" };
}

function compare(
  versions: { previous: string; next: string },
  starts: QueryResult,
  exits: QueryResult,
  arrivals: QueryResult,
): Row[] {
  return GROUPS.flatMap((groupName) => {
    const pick = (result: QueryResult, column: string) => ({
      previous: value(find(result, versions.previous, groupName), column),
      next: value(find(result, versions.next, groupName), column),
    });
    const startCount = pick(starts, "starts");
    const desktopStarts = pick(starts, "desktop_starts");
    const per = (column: string, total: { previous: number; next: number }) => {
      const events = pick(exits, column);
      return { previous: events.previous, previousN: total.previous, next: events.next, nextN: total.next };
    };
    const rows: Row[] = [
      infoRow(groupName, "starts", "count", startCount.previous, startCount.next),
      infoRow(groupName, "computers", "count", pick(starts, "computers").previous, pick(starts, "computers").next),
      infoRow(
        groupName,
        "update installs",
        "count",
        pick(starts, "updated_computers").previous,
        pick(starts, "updated_computers").next,
      ),
    ];
    if (DESKTOP_GROUPS.has(groupName)) {
      const finished = pick(starts, "finished");
      const ready = pick(starts, "ready_p50");
      rows.push(infoRow(groupName, "start time p50", "ms", ready.previous, ready.next));
      rows.push(
        shareRow(groupName, METRICS.finished, {
          previous: finished.previous,
          previousN: desktopStarts.previous,
          next: finished.next,
          nextN: desktopStarts.next,
        }),
      );
    }
    rows.push(
      rateRow(groupName, METRICS.crashes, per("crashes", startCount)),
      rateRow(groupName, METRICS.startupCrashes, per("startup_crashes", startCount)),
      rateRow(groupName, METRICS.quitHangs, per("quit_hangs", startCount)),
    );
    if (DESKTOP_GROUPS.has(groupName)) {
      const installs = pick(arrivals, "installs");
      const arrived = pick(arrivals, "arrived");
      rows.push(
        shareRow(
          groupName,
          METRICS.arrivals,
          { previous: arrived.previous, previousN: installs.previous, next: arrived.next, nextN: installs.next },
          true,
        ),
      );
    }
    return rows;
  });
}

function windows(pair: Pair, hours: number): { previous: Window; next: Window } {
  const span = hours * 3_600_000;
  const margin = ARRIVAL_MARGIN_MINUTES * 60_000;
  const window = (release: Release, followedAt: string | undefined): Window => {
    const from = Date.parse(release.publishedAt);
    const to = from + span;
    const installsTo = Math.min(to, followedAt === undefined ? to : Date.parse(followedAt)) - margin;
    return {
      version: release.version,
      from: release.publishedAt,
      to: new Date(to).toISOString(),
      installsTo: new Date(Math.max(from, installsTo)).toISOString(),
    };
  };
  return { next: window(pair.next, pair.nextFollowedAt), previous: window(pair.previous, pair.previousFollowedAt) };
}

async function buildReport(releases: Pair, requestedHours: number | undefined, now: number): Promise<Report> {
  const { next, previous } = releases;
  const sinceRelease = (now - Date.parse(next.publishedAt)) / 3_600_000;
  const hours = Math.max(0, Math.min(sinceRelease, requestedHours ?? MAX_WINDOW_HOURS, MAX_WINDOW_HOURS));
  const pair = windows(releases, hours);
  const both = [pair.previous, pair.next];
  const { user, password } = await credentials();
  const connection = await connectClickHouse();
  let results: { starts: QueryResult; exits: QueryResult; arrivals: QueryResult };
  try {
    const query = (sql: string) => runQuery(connection, { user, password, sql, showIdentifiers: false });
    // The read-only user may run 2 queries at a time, and a person can be using one.
    const starts = await query(startsSql(both));
    const exits = await query(exitsSql(both));
    const arrivals = await query(arrivalsSql(both));
    results = { starts, exits, arrivals };
  } finally {
    connection.close();
  }
  const rows = compare(
    { previous: previous.version, next: next.version },
    results.starts,
    results.exits,
    results.arrivals,
  );
  const worse = rows.filter((row) => row.status === "worse");
  const allWaiting = rows.some((row) => row.group === "all" && row.status === "waiting");
  const result = worse.length > 0 ? "worse" : allWaiting ? "waiting" : "pass";
  return {
    generatedAt: new Date(now).toISOString(),
    next,
    previous,
    hours,
    windows: pair,
    thresholds: METRICS,
    rows,
    worse,
    result,
    exitCode: result === "worse" ? 1 : result === "waiting" ? 3 : 0,
  };
}

// --- Output -----------------------------------------------------------------------------------------

function format(unit: Unit, amount: number | null): string {
  if (amount === null) return "-";
  if (unit === "share") return `${(amount * 100).toFixed(1)}%`;
  if (unit === "per100") return amount.toFixed(2);
  if (unit === "ms") return amount === 0 ? "-" : `${(amount / 1000).toFixed(1)} s`;
  return String(Math.round(amount));
}

function change(row: Row): string {
  if (row.previous === null || row.next === null) return "-";
  if (row.unit === "share") {
    const points = (row.next - row.previous) * 100;
    return `${points > 0 ? "+" : ""}${points.toFixed(1)} pp`;
  }
  if (row.unit === "per100") {
    const difference = row.next - row.previous;
    return `${difference > 0 ? "+" : ""}${difference.toFixed(2)}`;
  }
  return "";
}

const MARKS: Record<Status, string> = { worse: "!", watch: "?", ok: "", waiting: "~", info: "" };

function table(report: Report): string[] {
  const header = ["", "group", "metric", report.previous.version, report.next.version, "change", "n"];
  const rows = report.rows.map((row) => [
    MARKS[row.status],
    row.group,
    row.metric,
    format(row.unit, row.previous),
    format(row.unit, row.next),
    change(row),
    row.status === "info" ? "" : `${row.previousN}/${row.nextN}`,
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
  if (report.result === "worse") {
    return `WORSE: ${report.worse.map((row) => `${row.metric} (${row.group})`).join(", ")}. Do not raise the rollout.`;
  }
  if (report.result === "waiting") return "WAITING: group `all` does not have enough data yet. Run again later.";
  return "PASS: no metric is clearly worse.";
}

function summary(report: Report): string {
  return `Release health: ${report.next.version} against ${report.previous.version}, the first ${report.hours.toFixed(1)} h after each release (production)
${verdict(report)}
"!" worse, "?" to watch, "~" not enough data. Rates are per 100 starts; n is starts, or installs for arrivals.`;
}

function buildDirectory(): string {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  return join(projectRoot, ".openbot-build", "release-health");
}

async function writeReport(report: Report): Promise<string> {
  const path = join(buildDirectory(), "report.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

async function sendDiscord(title: string, description: string): Promise<void> {
  const url = process.env.RELEASE_REGRESSION_WEBHOOK_URL ?? "";
  if (!DISCORD_WEBHOOK.test(url)) throw new Error("RELEASE_REGRESSION_WEBHOOK_URL is not a Discord webhook URL.");
  let response: Response;
  try {
    response = await fetch(`${url}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{ title, description: description.slice(0, 4000), color: 0xed4245 }],
      }),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
  } catch {
    // The error text can contain the URL, which holds the webhook token.
    throw new Error("Cannot reach the Discord webhook, or it did not answer in time.");
  }
  if (!response.ok) throw new Error(`The Discord webhook returned HTTP ${response.status}.`);
}

function discordText(report: Report): string {
  const lines = report.worse.map(
    (row) =>
      `🔴 **${row.group}** ${row.metric} · ${format(row.unit, row.previous)} → ${format(row.unit, row.next)} (${change(row)}, n ${row.previousN}/${row.nextN})`,
  );
  return [
    ...lines,
    "",
    `The first ${report.hours.toFixed(1)} h after each release. Keep the staged rollout where it is. Run \`bun scripts/release-health.ts ${report.next.version}\` for the full table.`,
  ].join("\n");
}

/**
 * The state is in the GitHub Actions cache, which pull requests of this public repository can read.
 * It is an HMAC of the worse rows, keyed by the private webhook URL, so it shows nothing.
 */
function fingerprint(report: Report): string {
  const rows = report.worse.map((row) => `${row.group}|${row.metric}`).sort();
  return createHmac("sha256", process.env.RELEASE_REGRESSION_WEBHOOK_URL ?? "")
    .update([`${report.previous.version}>${report.next.version}`, ...rows].join("\n"))
    .digest("hex");
}

async function main(): Promise<void> {
  const parsed = readScriptArguments({
    usage: USAGE,
    maxPositionals: 1,
    options: {
      previous: { type: "string" },
      hours: { type: "string" },
      quiet: { type: "boolean" },
      discord: { type: "boolean" },
      state: { type: "string" },
      "max-age": { type: "string" },
    },
  });
  if (!parsed) return;
  const quiet = parsed.values.quiet === true;
  const discord = parsed.values.discord === true;
  const fail = (message: string) => {
    process.stderr.write(`${message}\n\n${USAGE}\n`);
    process.exit(2);
  };
  const positional = parsed.positionals[0];
  const wanted = positional === "latest" ? "latest" : VERSION.exec(positional ?? "")?.[1];
  if (!wanted) return fail("Give a version such as 0.67.0, or latest.");
  const wantedPrevious = parsed.values.previous === undefined ? undefined : VERSION.exec(parsed.values.previous)?.[1];
  if (parsed.values.previous !== undefined && !wantedPrevious) return fail("--previous must be a version.");
  const positiveNumber = (text: string | undefined, name: string) => {
    if (text === undefined) return undefined;
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount <= 0) fail(`${name} must be a positive number of hours.`);
    return amount;
  };
  const hours = positiveNumber(parsed.values.hours, "--hours");
  const maxAge = positiveNumber(parsed.values["max-age"], "--max-age");
  try {
    const now = Date.now();
    const releases = pickReleases(await publishedReleases(), wanted, wantedPrevious);
    const { next, previous } = releases;
    if (maxAge !== undefined && now - Date.parse(next.publishedAt) > maxAge * 3_600_000) {
      process.stdout.write(`The release is older than ${maxAge} h; nothing to check.\n`);
      return;
    }
    const report = await buildReport(releases, hours, now);
    const path = await writeReport(report);
    let sent = false;
    if (discord && report.result !== "worse" && parsed.values.state) {
      // The release is good again: a later worse result posts again, also with the same rows.
      await mkdir(dirname(parsed.values.state), { recursive: true });
      await writeFile(parsed.values.state, "\n");
    }
    if (discord && report.result === "worse") {
      const statePath = parsed.values.state;
      const current = fingerprint(report);
      const last = statePath ? (await readFile(statePath, "utf8").catch(() => "")).trim() : "";
      if (last !== current) {
        await sendDiscord(`🔴 Release ${next.version} is worse than ${previous.version}`, discordText(report));
        sent = true;
        if (statePath) {
          await mkdir(dirname(statePath), { recursive: true });
          await writeFile(statePath, `${current}\n`);
        }
      }
    }
    if (quiet) {
      // Public log: the result word only, no numbers.
      process.stdout.write(`Release health: ${report.result}${sent ? "; sent to Discord" : ""}.\n`);
    } else {
      process.stdout.write(`${summary(report)}\n\n${table(report).join("\n")}\n\n${path}\n`);
    }
    process.exitCode = report.exitCode;
  } catch (error) {
    const detail = redactText(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    process.stderr.write(quiet ? "The release health check failed.\n" : `${detail}\n`);
    if (discord) {
      await sendDiscord("🔴 Release health check failed", detail).catch(() => {
        process.stderr.write("The failure could not be sent to Discord.\n");
      });
    }
  }
}

if (import.meta.main) await main();
