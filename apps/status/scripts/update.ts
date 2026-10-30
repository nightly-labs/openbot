// One run of the status checks. The `status-page` workflow runs it about every 5 minutes:
//   bun apps/status/scripts/update.ts --state <state.json> --out <dir> [--bootstrap | --incidents-only]
// It probes each service, updates `state.json`, opens or closes the automatic incident issues,
// reads the `status` issues, and writes `status.json` and `feed.xml` into `--out`.
//
// `--incidents-only` (issue events) reads the issues again and keeps the stored checks. It does not
// probe, count runs, write issues or change `state.json`, because anyone can start an issue event.
//
// Smoke and local options:
//   --dry-run              no issue writes; the planned writes are in the report
//   --report <path>        write a JSON report of the run
//   --probe-base <url>     send every probe to <url>/<origin>/... (a local fake server)
//   --issues-file <path>   read the issues from a JSON file, not from GitHub
//   --now <iso>            the time of the run
//   --retry-delay <ms>     the wait before the second attempt (default 10000)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { Schema } from "effect";
import {
  type CheckDay,
  type CheckResult,
  decodeStateFile,
  HISTORY_DAYS,
  type Impact,
  type Incident,
  type IncidentUpdate,
  SERVICE_IDS,
  SERVICES,
  type ServiceId,
  type ServiceState,
  type Stage,
  type StateFile,
  type StatusFile,
  serviceName,
  statusDates,
} from "../src/model";

const logger = createOpenBotLogger("status-update");

const { values: args } = parseArgs({
  options: {
    state: { type: "string" },
    out: { type: "string" },
    report: { type: "string" },
    bootstrap: { type: "boolean", default: false },
    "incidents-only": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "probe-base": { type: "string" },
    "issues-file": { type: "string" },
    now: { type: "string" },
    "retry-delay": { type: "string" },
  },
});

if (!args.state || !args.out) throw new Error("Pass --state <state.json> and --out <dir>.");
const STATE_PATH = resolve(args.state);
const OUT_DIR = resolve(args.out);
const DRY_RUN = args["dry-run"];
const INCIDENTS_ONLY = args["incidents-only"];
if (INCIDENTS_ONLY && args.bootstrap) throw new Error("Do not pass --incidents-only with --bootstrap.");
const NOW = args.now ?? new Date().toISOString();
if (Number.isNaN(Date.parse(NOW))) throw new Error(`--now: "${NOW}" is not a time.`);
const RETRY_DELAY_MS = Number(args["retry-delay"] ?? 10_000);

const REPOSITORY = process.env.GITHUB_REPOSITORY ?? "nightly-labs/openbot";
const TOKEN = process.env.GITHUB_TOKEN?.trim() || null;
if (TOKEN) registerSecretValue(TOKEN);
if (!DRY_RUN && !TOKEN && !args["issues-file"]) throw new Error("GITHUB_TOKEN is necessary to write issues.");

const SITE_URL = "https://status.openbot.run";
const BOT_LOGIN = "github-actions[bot]";
const TIMEOUT_MS = 10_000;
const SLOW_MS = 5_000;
/** Runs in a row that open an automatic issue, and that close it again. */
const RUNS_TO_OPEN = 2;
const RUNS_TO_RECOVER = 2;
/** A check covers the time since the check before it, but no more than this. */
const MAX_CHECK_MINUTES = 15;
const FIRST_CHECK_MINUTES = 5;
const MAX_TEXT = 2_000;

// Probes ---------------------------------------------------------------------

const ORIGINS = {
  api: "https://api.openbot.run",
  signal: "https://signal.openbot.run",
  github: "https://github.com",
} as const;

interface Probe {
  origin: keyof typeof ORIGINS;
  paths: readonly string[];
  healthy: (body: string) => boolean;
}

const isReady = Schema.is(Schema.Struct({ status: Schema.Literal("ready") }));
const isHostingOk = Schema.is(Schema.Struct({ status: Schema.Literal("ok") }));
const isSkillList = Schema.is(Schema.Struct({ skills: Schema.Array(Schema.Unknown) }));

/** Whether the body is JSON that passes `test`. */
const jsonBody = (body: string, test: (value: unknown) => boolean) => {
  try {
    return test(JSON.parse(body));
  } catch {
    return false;
  }
};

const RELEASE_PATH = "/nightly-labs/openbot/releases/latest/download";
const PROBES: Record<ServiceId, Probe> = {
  accounts: { origin: "api", paths: ["/health/ready"], healthy: (b) => jsonBody(b, isReady) },
  connections: {
    origin: "signal",
    // `/health/turn` allocates a relay: Signal stays ready while coturn refuses every allocation.
    paths: ["/health/ready", "/health/turn"],
    healthy: (b) => jsonBody(b, isReady),
  },
  hosted: { origin: "api", paths: ["/health/hosting"], healthy: (b) => jsonBody(b, isHostingOk) },
  updates: {
    origin: "github",
    paths: [`${RELEASE_PATH}/latest-mac.yml`, `${RELEASE_PATH}/latest.yml`, `${RELEASE_PATH}/latest-linux.yml`],
    healthy: (b) => /^version:\s*\S+/m.test(b),
  },
  marketplace: {
    origin: "api",
    paths: ["/v1/skills?limit=1"],
    healthy: (b) => jsonBody(b, isSkillList),
  },
};

const probeUrl = (probe: Probe, path: string) =>
  args["probe-base"]
    ? `${args["probe-base"].replace(/\/$/, "")}/${probe.origin}${path}`
    : `${ORIGINS[probe.origin]}${path}`;

interface Attempt {
  ok: boolean;
  durationMs: number;
  reason: string | null;
}

async function attempt(probe: Probe): Promise<Attempt> {
  const started = performance.now();
  const results = await Promise.all(
    probe.paths.map(async (path): Promise<string | null> => {
      try {
        const response = await fetch(probeUrl(probe, path), {
          headers: { "User-Agent": "openbot-status-check" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await response.text();
        if (response.status !== 200) return `HTTP ${response.status}`;
        return probe.healthy(body) ? null : "unexpected response";
      } catch (error) {
        return error instanceof Error && error.name === "TimeoutError" ? "no response in 10 s" : "request failed";
      }
    }),
  );
  const reason = results.find((result) => result !== null) ?? null;
  return { ok: reason === null, durationMs: Math.round(performance.now() - started), reason };
}

interface CheckOutcome {
  result: Exclude<CheckResult, "unknown">;
  durationMs: number;
  reason: string | null;
  attempts: number;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A failed attempt is tried again once, so one network error on the runner is not an outage. */
async function check(probe: Probe): Promise<CheckOutcome> {
  let last = await attempt(probe);
  let attempts = 1;
  if (!last.ok) {
    await sleep(RETRY_DELAY_MS);
    last = await attempt(probe);
    attempts = 2;
  }
  const result = !last.ok ? "down" : last.durationMs > SLOW_MS ? "degraded" : "ok";
  return { result, durationMs: last.durationMs, reason: last.reason, attempts };
}

// State ----------------------------------------------------------------------

const emptyService = (): ServiceState => ({
  result: "unknown",
  changedAt: null,
  failedRuns: 0,
  healthyRuns: 0,
  openIssue: null,
  days: [],
});

function readState(): StateFile {
  if (!existsSync(STATE_PATH)) {
    // A missing file after a failed fetch must not start the history again.
    if (!args.bootstrap) throw new Error(`${STATE_PATH} does not exist. Run with --bootstrap only for the first run.`);
    logger.warn("Bootstrap: the history starts empty.");
    return {
      version: 1,
      checkedAt: null,
      services: {
        accounts: emptyService(),
        connections: emptyService(),
        hosted: emptyService(),
        updates: emptyService(),
        marketplace: emptyService(),
      },
    };
  }
  return decodeStateFile(JSON.parse(readFileSync(STATE_PATH, "utf8")));
}

type Action =
  | { type: "open-issue"; service: ServiceId; reason: string; issue: number }
  | { type: "close-issue"; service: ServiceId; issue: number };

function addMinutes(days: readonly CheckDay[], result: CheckOutcome["result"], minutes: number): CheckDay[] {
  const date = NOW.slice(0, 10);
  const kept = new Set(statusDates(HISTORY_DAYS, NOW));
  const next = days.filter((day) => kept.has(day.date) && day.date !== date);
  const today = days.find((day) => day.date === date) ?? {
    date,
    checks: 0,
    minutes: 0,
    failedMinutes: 0,
    degradedMinutes: 0,
  };
  next.push({
    date,
    checks: today.checks + 1,
    minutes: today.minutes + minutes,
    failedMinutes: today.failedMinutes + (result === "down" ? minutes : 0),
    degradedMinutes: today.degradedMinutes + (result === "degraded" ? minutes : 0),
  });
  return next.sort((a, b) => a.date.localeCompare(b.date));
}

function nextServiceState(previous: ServiceState, outcome: CheckOutcome, minutes: number): ServiceState {
  const down = outcome.result === "down";
  return {
    result: outcome.result,
    changedAt: previous.result === outcome.result ? previous.changedAt : NOW,
    failedRuns: down ? previous.failedRuns + 1 : 0,
    healthyRuns: down ? 0 : previous.healthyRuns + 1,
    openIssue: previous.openIssue,
    days: addMinutes(previous.days, outcome.result, minutes),
  };
}

// GitHub ---------------------------------------------------------------------

// Only the fields that the run reads. Decoding ignores the other fields.
const GitHubUser = Schema.Struct({ login: Schema.String });
type GitHubUser = typeof GitHubUser.Type;

const GitHubComment = Schema.Struct({
  user: Schema.NullOr(GitHubUser),
  author_association: Schema.String,
  body: Schema.NullOr(Schema.String),
  created_at: Schema.String,
});
type GitHubComment = typeof GitHubComment.Type;

const GitHubIssue = Schema.Struct({
  number: Schema.Int,
  html_url: Schema.String,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  state: Schema.Literals(["open", "closed"]),
  state_reason: Schema.optional(Schema.NullOr(Schema.String)),
  user: Schema.NullOr(GitHubUser),
  author_association: Schema.String,
  created_at: Schema.String,
  closed_at: Schema.NullOr(Schema.String),
  comments: Schema.Int,
  pull_request: Schema.optional(Schema.Unknown),
  /** Only in `--issues-file`: the comments, so the smoke reads no network. */
  comment_list: Schema.optional(Schema.Array(GitHubComment)),
});
type GitHubIssue = typeof GitHubIssue.Type;

const decodeIssues = Schema.decodeUnknownSync(Schema.Array(GitHubIssue));
const decodeIssue = Schema.decodeUnknownSync(GitHubIssue);
const decodeComments = Schema.decodeUnknownSync(Schema.Array(GitHubComment));
const decodeNumber = Schema.decodeUnknownSync(Schema.Struct({ number: Schema.Int }));
/** `push` is also true for maintain and admin. */
const decodeCollaborators = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ login: Schema.String, permissions: Schema.Struct({ push: Schema.Boolean }) })),
);
const decodeId = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.Int }));

/** One GitHub API call. `decode` parses the response at this boundary. */
async function github<A>(method: string, path: string, decode: (value: unknown) => A, body?: unknown): Promise<A> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "openbot-status-check",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path.split("?")[0]}: HTTP ${response.status}`);
  return decode(await response.json());
}

const fileIssues = (): readonly GitHubIssue[] | null => {
  const path = args["issues-file"];
  return path ? decodeIssues(JSON.parse(readFileSync(resolve(path), "utf8"))) : null;
};

async function listIssues(): Promise<readonly GitHubIssue[]> {
  const fromFile = fileIssues();
  if (fromFile) return fromFile;
  const since = new Date(Date.parse(NOW) - HISTORY_DAYS * 86_400_000).toISOString();
  const issues = new Map<number, GitHubIssue>();
  // Open issues always count. Closed ones count when they changed in the history window.
  for (const query of ["state=open", `state=closed&since=${since}`]) {
    for (const issue of await allPages(`/repos/${REPOSITORY}/issues?labels=status&${query}`, decodeIssues)) {
      if (!issue.pull_request) issues.set(issue.number, issue);
    }
  }
  return [...issues.values()];
}

/** Every page of a list, oldest first. A full page means that another page can follow. */
async function allPages<A>(path: string, decode: (value: unknown) => readonly A[]): Promise<A[]> {
  const items: A[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github("GET", `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`, decode);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

async function issueComments(issue: GitHubIssue): Promise<readonly GitHubComment[]> {
  if (issue.comment_list) return issue.comment_list;
  if (issue.comments === 0) return [];
  return allPages(`/repos/${REPOSITORY}/issues/${issue.number}/comments`, decodeComments);
}

/** A COLLABORATOR can have read access only, so that association gets the permission check too. */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER"]);
let writers: Promise<ReadonlySet<string>> | null = null;

/** The people with write access, read once for each run, so many commenters cost no extra calls. */
function writeAccess(): Promise<ReadonlySet<string>> {
  writers ??= allPages(`/repos/${REPOSITORY}/collaborators?affiliation=all`, decodeCollaborators).then(
    (people) => new Set(people.filter((person) => person.permissions.push).map((person) => person.login)),
    (error: unknown) => {
      // Nobody else is trusted in this run. The next run reads the list again.
      logger.warn(`The collaborator list failed: ${error instanceof Error ? error.message : String(error)}`);
      return new Set<string>();
    },
  );
  return writers;
}

/**
 * The repository is public, and the issue form adds the `status` label for anyone. Only the bot and
 * people with write access can publish on the page. A private organization member can show as
 * CONTRIBUTOR, so a person with another association is checked against the collaborator list.
 */
async function trusted(user: GitHubUser | null, association: string): Promise<boolean> {
  if (!user) return false;
  if (user.login === BOT_LOGIN || TRUSTED_ASSOCIATIONS.has(association)) return true;
  if (args["issues-file"]) return false;
  return (await writeAccess()).has(user.login);
}

// Issue form parsing -----------------------------------------------------------

const FORM_LABELS = {
  kind: "Kind",
  services: "Services",
  impact: "Impact",
  start: "Maintenance start (UTC)",
  end: "Maintenance end (UTC)",
  update: "Update",
} as const;

const IMPACT_LABELS: Record<string, Exclude<Impact, "maintenance">> = {
  degraded: "degraded",
  "partial outage": "partial",
  "major outage": "major",
};

/** The `### Label` sections that GitHub writes for an issue form. */
function formFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  const parts = body.replace(/\r\n/g, "\n").split(/^### /m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    const label = (newline === -1 ? part : part.slice(0, newline)).trim();
    const value = newline === -1 ? "" : part.slice(newline + 1).trim();
    fields.set(label, value === "_No response_" ? "" : value);
  }
  return fields;
}

/** Plain text for the page: no HTML comments, and a length limit. */
const plainText = (text: string) => {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
};

const STAGES: readonly Stage[] = [
  "investigating",
  "identified",
  "monitoring",
  "update",
  "resolved",
  "scheduled",
  "completed",
];

/** "Identified: text" or "**Identified:** text" sets the stage of an update. */
function stagedUpdate(at: string, text: string, fallback: Stage): IncidentUpdate | null {
  const body = plainText(text);
  // The stage word needs a mark after it, so "Update the app to fix it" keeps its first word.
  const match = /^\**\s*([a-z]+)\s*\**\s*[:.\-–—]\s*\**\s*/i.exec(body);
  const word = match?.[1]?.toLowerCase();
  const stage = STAGES.find((item) => item === word);
  const rest = stage && match ? body.slice(match[0].length).trim() : body;
  if (!rest && !stage) return null;
  return { at, stage: stage ?? fallback, body: rest };
}

/** "2026-10-20 06:00" in UTC, or an ISO time. */
function formTime(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(value.trim());
  const parsed = Date.parse(match ? `${match[1]}T${match[2]}:00Z` : value.trim());
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

async function toIncident(issue: GitHubIssue): Promise<Incident | null> {
  if (!(await trusted(issue.user, issue.author_association))) {
    logger.info(`Issue #${issue.number} is not from a maintainer. The page does not show it.`);
    return null;
  }
  // A false alarm that a maintainer closes as "not planned" is not an incident.
  if (issue.state === "closed" && issue.state_reason === "not_planned") return null;
  const fields = formFields(issue.body ?? "");
  const kind = /maintenance/i.test(fields.get(FORM_LABELS.kind) ?? "") ? "maintenance" : "incident";
  const components = SERVICES.filter((service) =>
    (fields.get(FORM_LABELS.services) ?? "")
      .split(/[,\n]/)
      .some((item) => item.trim().toLowerCase() === service.name.toLowerCase()),
  ).map((service) => service.id);
  if (components.length === 0) {
    logger.warn(`Issue #${issue.number} names no known service. The page does not show it.`);
    return null;
  }

  let startedAt = issue.created_at;
  let resolvedAt = issue.state === "closed" ? issue.closed_at : null;
  if (kind === "maintenance") {
    const start = formTime(fields.get(FORM_LABELS.start));
    const end = formTime(fields.get(FORM_LABELS.end));
    if (start) startedAt = start;
    if (end && (resolvedAt === null || Date.parse(end) < Date.parse(resolvedAt))) resolvedAt = end;
    // Closed before it started: cancelled.
    if (issue.state === "closed" && issue.closed_at && Date.parse(issue.closed_at) < Date.parse(startedAt)) return null;
  }
  const impact: Impact =
    kind === "maintenance"
      ? "maintenance"
      : (IMPACT_LABELS[(fields.get(FORM_LABELS.impact) ?? "").trim().toLowerCase()] ?? "partial");

  const updates: IncidentUpdate[] = [];
  const first = stagedUpdate(
    issue.created_at,
    fields.get(FORM_LABELS.update) ?? "",
    kind === "maintenance" ? "scheduled" : "investigating",
  );
  if (first) updates.push(first);
  for (const comment of await issueComments(issue)) {
    if (!(await trusted(comment.user, comment.author_association))) continue;
    const update = stagedUpdate(comment.created_at, comment.body ?? "", "update");
    if (update) updates.push(update);
  }
  updates.sort((a, b) => b.at.localeCompare(a.at));
  const finalStage = kind === "maintenance" ? "completed" : "resolved";
  if (issue.state === "closed" && issue.closed_at && updates[0]?.stage !== finalStage) {
    updates.unshift({
      at: issue.closed_at,
      stage: finalStage,
      body: kind === "maintenance" ? "The maintenance is complete." : "This incident is resolved.",
    });
  }

  return {
    id: issue.number,
    url: issue.html_url,
    title: plainText(issue.title).slice(0, 200),
    kind,
    impact,
    components,
    startedAt,
    resolvedAt,
    updates,
  };
}

const inHistory = (incident: Incident) =>
  incident.resolvedAt === null || Date.parse(incident.resolvedAt) >= Date.parse(NOW) - HISTORY_DAYS * 86_400_000;

// Automatic issues ---------------------------------------------------------------

function autoIssueBody(service: ServiceId, reason: string) {
  return [
    `### ${FORM_LABELS.kind}`,
    "",
    "Incident",
    "",
    `### ${FORM_LABELS.services}`,
    "",
    serviceName(service),
    "",
    `### ${FORM_LABELS.impact}`,
    "",
    "Major outage",
    "",
    `### ${FORM_LABELS.start}`,
    "",
    "_No response_",
    "",
    `### ${FORM_LABELS.end}`,
    "",
    "_No response_",
    "",
    `### ${FORM_LABELS.update}`,
    "",
    `Investigating: The automatic check failed ${RUNS_TO_OPEN} times in a row (${reason}). We are looking into it.`,
    "",
    "<!-- The status workflow opened this issue. It closes it when the checks pass again. -->",
  ].join("\n");
}

async function openIssue(service: ServiceId, reason: string): Promise<number> {
  if (DRY_RUN) return 0;
  const title = `${serviceName(service)} is not available`;
  // A run whose POST timed out, or whose history push failed, can have opened the issue already.
  const open = await github(
    "GET",
    `/repos/${REPOSITORY}/issues?labels=status-auto&state=open&per_page=100`,
    decodeIssues,
  );
  const existing = open.find((issue) => issue.title === title && issue.user?.login === BOT_LOGIN);
  if (existing) return existing.number;
  const issue = await github("POST", `/repos/${REPOSITORY}/issues`, decodeNumber, {
    title,
    body: autoIssueBody(service, reason),
    labels: ["status", "status-auto"],
  });
  return issue.number;
}

/** Closes the automatic issue, or leaves it open for the person who commented on it. */
async function recoverIssue(service: ServiceId, number: number): Promise<"close-issue"> {
  // 0 is the issue that a dry run planned to open.
  if (number === 0 || DRY_RUN) return "close-issue";
  const issue = await github("GET", `/repos/${REPOSITORY}/issues/${number}`, decodeIssue);
  if (issue.state === "closed") return "close-issue";
  // Close first: after a failed close, a comment first would repeat on each run.
  await github("PATCH", `/repos/${REPOSITORY}/issues/${number}`, decodeNumber, {
    state: "closed",
    state_reason: "completed",
  });
  await github("POST", `/repos/${REPOSITORY}/issues/${number}/comments`, decodeId, {
    body: `Resolved: ${serviceName(service)} passed the last ${RUNS_TO_RECOVER} checks.`,
  });
  return "close-issue";
}

// Output -----------------------------------------------------------------------

const xml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An Atom feed with one entry for each incident update, newest first. */
function atomFeed(incidents: readonly Incident[]): string {
  const entries = incidents
    .flatMap((incident) => incident.updates.map((update) => ({ incident, update })))
    .sort((a, b) => b.update.at.localeCompare(a.update.at))
    .slice(0, 50);
  const updated = entries[0]?.update.at ?? NOW;
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <title>OpenBot status</title>",
    `  <id>${SITE_URL}/</id>`,
    `  <link href="${SITE_URL}/"/>`,
    `  <link rel="self" href="${SITE_URL}/feed.xml"/>`,
    `  <updated>${updated}</updated>`,
    "  <author><name>OpenBot</name></author>",
  ];
  for (const { incident, update } of entries) {
    const stage = update.stage.charAt(0).toUpperCase() + update.stage.slice(1);
    lines.push(
      "  <entry>",
      `    <title>${xml(`${incident.title}: ${stage}`)}</title>`,
      `    <id>${xml(`${incident.url}#${update.at}`)}</id>`,
      `    <link href="${xml(incident.url)}"/>`,
      `    <updated>${update.at}</updated>`,
      `    <content type="text">${xml(update.body)}</content>`,
      "  </entry>",
    );
  }
  lines.push("</feed>", "");
  return lines.join("\n");
}

const writeFile = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

// Run --------------------------------------------------------------------------

const previous = readState();

/** Probes the services, counts the runs, opens or closes the automatic issues, and saves the state. */
async function runChecks() {
  const checked = await Promise.all(SERVICE_IDS.map(async (id) => ({ id, outcome: await check(PROBES[id]) })));

  const minutes = previous.checkedAt
    ? Math.max(0, Math.min(MAX_CHECK_MINUTES, (Date.parse(NOW) - Date.parse(previous.checkedAt)) / 60_000))
    : FIRST_CHECK_MINUTES;

  const services = { ...previous.services };
  const actions: Action[] = [];
  for (const { id, outcome } of checked) {
    const next = nextServiceState(previous.services[id], outcome, minutes);
    let issue = next.openIssue;
    logger.info(`${id}: ${outcome.result} in ${outcome.durationMs} ms${outcome.reason ? ` (${outcome.reason})` : ""}`);
    try {
      if (next.failedRuns >= RUNS_TO_OPEN && issue === null) {
        const reason = outcome.reason ?? "no response";
        issue = await openIssue(id, reason);
        actions.push({ type: "open-issue", service: id, reason, issue });
      } else if (next.healthyRuns >= RUNS_TO_RECOVER && issue !== null) {
        actions.push({ type: await recoverIssue(id, issue), service: id, issue });
        issue = null;
      }
    } catch (error) {
      // The next run tries the issue write again. The checks of this run are still saved.
      logger.error(`${id}: the issue write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    services[id] = { ...next, openIssue: issue };
  }

  const state: StateFile = { version: 1, checkedAt: NOW, services };
  // Before the issue list: when that read fails, the workflow still saves the checks and the number
  // of an issue that this run opened, so the next run does not open the issue again.
  writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  return { state, checked, actions };
}

const checks = INCIDENTS_ONLY ? null : await runChecks();
const current = checks?.state ?? previous;

const incidents = (await Promise.all((await listIssues()).map(toIncident)))
  .filter((incident): incident is Incident => incident !== null && inHistory(incident))
  .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

const status: StatusFile = {
  version: 1,
  checkedAt: current.checkedAt,
  services: SERVICE_IDS.map((id) => ({ id, result: current.services[id].result, days: current.services[id].days })),
  incidents,
};

writeFile(resolve(OUT_DIR, "status.json"), JSON.stringify(status));
writeFile(resolve(OUT_DIR, "feed.xml"), atomFeed(incidents));
const actions = checks?.actions ?? [];
if (args.report) {
  const outcomes = Object.fromEntries((checks?.checked ?? []).map((item) => [item.id, item.outcome]));
  writeFile(
    resolve(args.report),
    `${JSON.stringify({ checkedAt: NOW, dryRun: DRY_RUN, outcomes, actions, incidents: incidents.map((item) => item.id) }, null, 2)}\n`,
  );
}
for (const action of actions) logger.info(`${DRY_RUN ? "Planned" : "Done"}: ${action.type} for ${action.service}`);
logger.info(`Wrote ${incidents.length} incidents to ${OUT_DIR}.`);
