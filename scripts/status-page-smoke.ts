// Smoke test of the public status page (`apps/status`).
//   bun scripts/status-page-smoke.ts [--browser-executable=<path>] [--skip-live]
// 1. Runs `update.ts --dry-run` against a local fake of the 5 probes: a bootstrap run, two failed
//    Marketplace runs, then healthy runs. It checks the planned issue writes, the state and the
//    daily minutes, and that only maintainer issues and comments reach the page.
// 2. Runs `notify.ts` against a local receiver: bootstrap, signed deliveries in the 3 formats, event
//    filters, a paused and a removed subscription, retries to their end, the test event, and no URL
//    token or secret in the output.
// 3. Runs one `--dry-run` against the live services and GitHub. It writes nothing remote.
// 4. Builds the page, serves it with the files of step 1, and checks it in Chrome: the banner, the
//    5 rows, the 30 and 90 day views, an incident that opens, plain-text updates, no console errors,
//    and no axe-core violations, at 1440 and 390 px.
// Writes .openbot-build/status-page/report.json and the screenshots beside it.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import { createOpenBotLogger } from "@openbot/logging";
import { chromium } from "playwright-core";

const logger = createOpenBotLogger("status-page-smoke");
const run = promisify(execFile);

const ROOT = resolve(import.meta.dirname, "..");
const APP = resolve(ROOT, "apps/status");
const OUT = resolve(ROOT, ".openbot-build/status-page");
const WORK = resolve(OUT, "work");
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const browserExecutable = option("browser-executable");
const skipLive = process.argv.includes("--skip-live");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const listen = (server: Server) =>
  new Promise<number>((done) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      done(address.port);
    }),
  );

// 1. Update runs against a fake service -------------------------------------------

/** Services whose probe answers 503. */
const failing = new Set<string>();
const probeServer = createServer((request, response) => {
  const path = request.url ?? "/";
  const reply = (service: string, body: string) => {
    if (failing.has(service)) {
      response.writeHead(503).end("{}");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain" }).end(body);
  };
  if (path === "/api/health/ready") return reply("accounts", '{"status":"ready"}');
  if (path === "/signal/health/ready") return reply("connections", '{"status":"ready"}');
  if (path === "/signal/health/turn") return reply("connections", '{"status":"ready"}');
  if (path === "/api/health/hosting") return reply("hosted", '{"status":"ok"}');
  if (path === "/api/v1/skills?limit=1") return reply("marketplace", '{"skills":[]}');
  if (/^\/github\/nightly-labs\/openbot\/releases\/latest\/download\/latest(-mac|-linux)?\.yml$/.test(path)) {
    return reply("updates", "version: 0.42.0\n");
  }
  response.writeHead(404).end();
});
const probePort = await listen(probeServer);

const MEMBER = { login: "maintainer" };
const STRANGER = { login: "someone" };
const form = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([label, value]) => `### ${label}\n\n${value}`)
    .join("\n\n");
interface FixtureComment {
  user: { login: string };
  author_association: string;
  body: string;
  created_at: string;
}

/** The fields of a GitHub issue that `update.ts` reads; `comment_list` replaces the comment API. */
interface FixtureIssue {
  number: number;
  title: string;
  body: string;
  created_at: string;
  state?: "open" | "closed";
  state_reason?: string | null;
  user?: { login: string };
  author_association?: string;
  closed_at?: string | null;
  comments?: number;
  comment_list?: FixtureComment[];
}

const issue = (fields: FixtureIssue) => ({
  html_url: `https://github.com/nightly-labs/openbot/issues/${fields.number}`,
  state: "open",
  state_reason: null,
  user: MEMBER,
  author_association: "MEMBER",
  closed_at: null,
  comments: 0,
  comment_list: [],
  ...fields,
});

const ISSUES = [
  issue({
    number: 101,
    title: "Marketplace pages load slowly",
    created_at: "2026-10-16T09:12:00Z",
    body: form({
      Kind: "Incident",
      Services: "Marketplace",
      Impact: "Degraded",
      Update: "Investigating: Search takes 20 s. <b>Installed</b> skills work.",
    }),
    comments: 2,
    comment_list: [
      {
        user: { login: "owner" },
        author_association: "OWNER",
        body: "**Identified:** A slow query on the search index.",
        created_at: "2026-10-16T09:41:00Z",
      },
      { user: STRANGER, author_association: "NONE", body: "Resolved: fake news", created_at: "2026-10-16T09:50:00Z" },
    ],
  }),
  issue({
    number: 102,
    title: "Everything is down (not from a maintainer)",
    created_at: "2026-10-16T09:30:00Z",
    user: STRANGER,
    author_association: "NONE",
    body: form({ Kind: "Incident", Services: "Accounts and sign-in", Impact: "Major outage", Update: "Down" }),
  }),
  issue({
    number: 103,
    title: "Connections server upgrade",
    created_at: "2026-10-15T14:00:00Z",
    body: form({
      Kind: "Maintenance",
      Services: "Connections",
      Impact: "_No response_",
      "Maintenance start (UTC)": "2026-10-20 06:00",
      "Maintenance end (UTC)": "2026-10-20 06:30",
      Update: "Phones can disconnect for up to one minute.",
    }),
  }),
  issue({
    number: 104,
    title: "False alarm",
    created_at: "2026-10-14T10:00:00Z",
    state: "closed",
    state_reason: "not_planned",
    closed_at: "2026-10-14T10:10:00Z",
    body: form({ Kind: "Incident", Services: "Hosted servers", Impact: "Major outage", Update: "Down" }),
  }),
  issue({
    number: 105,
    title: "No known service",
    created_at: "2026-10-14T10:00:00Z",
    body: form({ Kind: "Incident", Services: "Something else", Impact: "Major outage", Update: "Down" }),
  }),
  issue({
    number: 106,
    title: "Phones and teammates could not connect",
    created_at: "2026-10-11T07:10:00Z",
    state: "closed",
    state_reason: "completed",
    closed_at: "2026-10-11T08:05:00Z",
    body: form({
      Kind: "Incident",
      Services: "Connections, Hosted servers",
      Impact: "Partial outage",
      Update: "Some connections fail.",
    }),
  }),
];
const issuesFile = resolve(WORK, "issues.json");
writeFileSync(issuesFile, JSON.stringify(ISSUES));

const STATE = resolve(WORK, "state.json");
const SITE = resolve(WORK, "site");

interface RunReport {
  actions: { type: string; service: string; issue: number }[];
  outcomes: Record<string, { result: string; attempts: number; reason: string | null }>;
  incidents: number[];
}

interface ServiceStateJson {
  result: string;
  failedRuns: number;
  healthyRuns: number;
  openIssue: number | null;
  days: { date: string; checks: number; minutes: number; failedMinutes: number; degradedMinutes: number }[];
}

const readJson = <T>(path: string): T => {
  const value: T = JSON.parse(readFileSync(path, "utf8"));
  return value;
};

/** The child gets no GitHub token, so even a mistake in `--dry-run` cannot write an issue. */
const childEnv = () => {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  return env;
};

async function update(name: string, now: string, extra: string[] = []): Promise<RunReport> {
  const report = resolve(WORK, `${name}.json`);
  await run(
    "bun",
    [
      resolve(APP, "scripts/update.ts"),
      "--state",
      STATE,
      "--out",
      SITE,
      "--report",
      report,
      "--dry-run",
      "--probe-base",
      `http://127.0.0.1:${probePort}`,
      "--issues-file",
      issuesFile,
      "--now",
      now,
      "--retry-delay",
      "10",
      ...extra,
    ],
    { cwd: ROOT, env: childEnv() },
  );
  return readJson<RunReport>(report);
}

const marketplace = () => readJson<{ services: Record<string, ServiceStateJson> }>(STATE).services.marketplace;
const steps: { name: string; actions: RunReport["actions"]; marketplace: ServiceStateJson }[] = [];
const record = (name: string, report: RunReport) => {
  const service = marketplace();
  assert.ok(service);
  steps.push({ name, actions: report.actions, marketplace: service });
  return service;
};

// A run with no history and no --bootstrap must stop and write nothing.
await assert.rejects(update("no-history", "2026-10-16T09:55:00Z"), "A run without history must fail.");
assert.equal(existsSync(STATE), false, "A failed run wrote a state file.");

let report = await update("bootstrap", "2026-10-16T10:00:00Z", ["--bootstrap"]);
let service = record("bootstrap", report);
assert.deepEqual(report.actions, []);
assert.equal(service.result, "ok");
assert.deepEqual(report.incidents, [103, 101, 106], "Only maintainer issues with a known service reach the page.");

failing.add("marketplace");
report = await update("fail-1", "2026-10-16T10:05:00Z");
service = record("fail-1", report);
assert.equal(report.outcomes.marketplace?.result, "down");
assert.equal(report.outcomes.marketplace?.attempts, 2, "A failed probe is tried again once.");
assert.deepEqual(report.actions, [], "One failed run opens no issue.");
assert.equal(service.failedRuns, 1);

report = await update("fail-2", "2026-10-16T10:10:00Z");
service = record("fail-2", report);
assert.deepEqual(
  report.actions.map((action) => [action.type, action.service]),
  [["open-issue", "marketplace"]],
);
assert.equal(service.openIssue, 0, "The dry run keeps the planned issue.");

failing.clear();
report = await update("recover-1", "2026-10-16T10:15:00Z");
service = record("recover-1", report);
assert.deepEqual(report.actions, [], "One healthy run closes no issue.");

report = await update("recover-2", "2026-10-16T10:20:00Z");
service = record("recover-2", report);
assert.deepEqual(
  report.actions.map((action) => [action.type, action.service]),
  [["close-issue", "marketplace"]],
);
assert.equal(service.openIssue, null);

// 30 minutes without a run: the check covers at most 15 of them.
report = await update("late", "2026-10-16T10:50:00Z");
service = record("late", report);
const today = service.days.at(-1);
assert.deepEqual(today, {
  date: "2026-10-16",
  checks: 6,
  minutes: 5 + 5 + 5 + 5 + 5 + 15,
  failedMinutes: 10,
  degradedMinutes: 0,
});
const accounts = readJson<{ services: Record<string, ServiceStateJson> }>(STATE).services.accounts;
assert.equal(accounts?.days.at(-1)?.failedMinutes, 0);

// An issue event only reads the issues again: anyone can start one, so it must not count a run.
failing.add("marketplace");
const stateBefore = readFileSync(STATE, "utf8");
report = await update("incidents-only", "2026-10-16T10:52:00Z", ["--incidents-only"]);
assert.deepEqual(report.outcomes, {}, "An issue event probed the services.");
assert.deepEqual(report.actions, []);
assert.equal(readFileSync(STATE, "utf8"), stateBefore, "An issue event changed the check history.");
assert.deepEqual(report.incidents, [103, 101, 106]);
assert.equal(
  readJson<{ checkedAt: string }>(resolve(SITE, "status.json")).checkedAt,
  "2026-10-16T10:50:00Z",
  "An issue event moved the time of the last check.",
);
await assert.rejects(
  update("incidents-only-bootstrap", "2026-10-16T10:53:00Z", ["--incidents-only", "--bootstrap"]),
  "--incidents-only with --bootstrap must fail.",
);
failing.clear();
probeServer.close();

const status = readJson<{ incidents: { id: number; updates: { stage: string; body: string }[] }[] }>(
  resolve(SITE, "status.json"),
);
const slow = status.incidents.find((incident) => incident.id === 101);
assert.deepEqual(
  slow?.updates.map((item) => item.stage),
  ["identified", "investigating"],
  "The comment of a person without write access is not an update.",
);
const feed = readFileSync(resolve(SITE, "feed.xml"), "utf8");
assert.match(feed, /&lt;b&gt;Installed&lt;\/b&gt;/, "The feed escapes update text.");
assert.equal(feed.match(/<entry>/g)?.length, 5);
logger.info("Update runs: passed.");

// 2. Status webhooks against a local receiver ------------------------------------------

/** What each subscription answers. `flaky` fails its first 2 tries. */
const RECEIVER_TOKEN = randomBytes(16).toString("hex");
const flakyFailures = { left: 2 };
interface Received {
  subscription: string;
  headers: Record<string, string | undefined>;
  body: string;
}
let received: Received[] = [];
const receiver = createServer((request, response) => {
  const match = /^\/hook\/([0-9a-f]+)\/([a-z-]+)$/.exec(request.url ?? "");
  if (request.method !== "POST" || match?.[1] !== RECEIVER_TOKEN || !match[2]) {
    response.writeHead(404).end();
    return;
  }
  const subscription = match[2];
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const headers = Object.fromEntries(
      ["content-type", "x-openbot-event", "x-openbot-delivery-id", "x-openbot-timestamp", "x-openbot-signature"].map(
        (name) => [name, request.headers[name]?.toString()],
      ),
    );
    received.push({ subscription, headers, body: Buffer.concat(chunks).toString("utf8") });
    if (subscription === "dead" || (subscription === "flaky" && flakyFailures.left-- > 0)) {
      response.writeHead(500).end();
    } else if (subscription === "redirect") {
      response.writeHead(301, { Location: `/hook/${RECEIVER_TOKEN}/team` }).end();
    } else {
      response.writeHead(subscription === "discord" ? 204 : 200).end();
    }
  });
});
const receiverPort = await listen(receiver);
const hookUrl = (subscription: string) => `http://127.0.0.1:${receiverPort}/hook/${RECEIVER_TOKEN}/${subscription}`;
const SECRETS = {
  team: randomBytes(32).toString("hex"),
  ops: randomBytes(32).toString("hex"),
  flaky: randomBytes(32).toString("hex"),
  dead: randomBytes(32).toString("hex"),
  redirect: randomBytes(32).toString("hex"),
};
const HOOKS = [
  { id: "team", url: hookUrl("team"), secret: SECRETS.team },
  { id: "ops", url: hookUrl("ops"), secret: SECRETS.ops, events: ["service.changed", "incident.resolved"] },
  { id: "slack", url: hookUrl("slack"), format: "slack", events: ["incident.created"] },
  { id: "discord", url: hookUrl("discord"), format: "discord" },
  { id: "paused", url: hookUrl("paused"), secret: SECRETS.team, paused: true },
  { id: "flaky", url: hookUrl("flaky"), secret: SECRETS.flaky, events: ["incident.created"] },
  { id: "dead", url: hookUrl("dead"), secret: SECRETS.dead, events: ["incident.created"] },
  { id: "redirect", url: hookUrl("redirect"), secret: SECRETS.redirect, events: ["incident.created"] },
];
const leakValues = [RECEIVER_TOKEN, ...Object.values(SECRETS)];

interface NotifyReport {
  found: string[];
  queued: { delivery: string; subscription: string; type: string }[];
  sent: { delivery: string; subscription: string; type: string; attempt: number; ok: boolean; reason: string | null }[];
  dropped: { subscription: string; type: string; reason: string }[];
  waiting: number;
}
interface NotifyStateJson {
  checkedAt: string | null;
  seen: Record<string, string>;
  open: Record<string, { missing: number }>;
  outbox: { id: string; subscription: string; attempts: number; nextAt: string; event: { type: string } }[];
}

const NOTIFY_STATE = resolve(WORK, "notify.json");
const NOTIFY_SUMMARY = resolve(WORK, "notify-summary.md");
/** The stdout and stderr of each run, scanned for secrets at the end. */
const notifyOutput: string[] = [];

const SERVICE_LIST = ["accounts", "connections", "hosted", "updates", "marketplace"];
const statusFile = (checkedAt: string, down: string[], incidents: readonly ReturnType<typeof incident>[]) => ({
  version: 1,
  checkedAt,
  services: SERVICE_LIST.map((id) => ({ id, result: down.includes(id) ? "down" : "ok", days: [] })),
  incidents,
});
interface UpdateFixture {
  at: string;
  stage: string;
  body: string;
}
interface IncidentFixture {
  id: number;
  title: string;
  components: string[];
  startedAt: string;
  updates: UpdateFixture[];
  kind?: string;
  impact?: string;
  resolvedAt?: string | null;
}
const incident = (fields: IncidentFixture) => ({
  url: `https://github.com/nightly-labs/openbot/issues/${fields.id}`,
  kind: "incident",
  impact: "partial",
  resolvedAt: null,
  ...fields,
});
const investigating = { at: "2026-10-16T10:30:00Z", stage: "investigating", body: "Some links fail." };
const identified = { at: "2026-10-16T11:00:00Z", stage: "identified", body: "A bad cache rule." };
const scheduled = { at: "2026-10-15T08:00:00Z", stage: "scheduled", body: "Phones can disconnect for a minute." };
const links = (updates: UpdateFixture[], resolvedAt: string | null = null) =>
  incident({
    id: 201,
    title: "Invitation links fail",
    components: ["accounts"],
    startedAt: investigating.at,
    resolvedAt,
    updates,
  });
const maintenance = (updates: UpdateFixture[] = [scheduled]) =>
  incident({
    id: 202,
    title: "Connections server upgrade",
    kind: "maintenance",
    impact: "maintenance",
    components: ["connections"],
    startedAt: "2026-10-16T12:00:00Z",
    resolvedAt: "2026-10-16T12:30:00Z",
    updates,
  });
const signIn = incident({
  id: 203,
  title: "Sign-in fails",
  impact: "major",
  components: ["accounts", "hosted"],
  startedAt: "2026-10-16T12:01:00Z",
  updates: [
    { at: "2026-10-16T12:01:00Z", stage: "investigating", body: "Sign-in fails for <some> users & @everyone." },
  ],
});

/** The stdout and stderr of a child that failed. */
const childOutput = (error: unknown) =>
  error instanceof Error
    ? ["stdout" in error ? error.stdout : "", "stderr" in error ? error.stderr : ""]
        .map((value) => (typeof value === "string" ? value : ""))
        .join("")
    : "";

async function notify(
  name: string,
  status: unknown,
  now: string,
  options: { extra?: string[]; hooks?: unknown; actions?: boolean } = {},
): Promise<NotifyReport> {
  const statusPath = resolve(WORK, `notify-${name}-status.json`);
  const reportPath = resolve(WORK, `notify-${name}.json`);
  writeFileSync(statusPath, JSON.stringify(status));
  const env = childEnv();
  delete env.GITHUB_ACTIONS;
  env.STATUS_WEBHOOKS = JSON.stringify(options.hooks ?? HOOKS);
  if (options.actions) env.GITHUB_ACTIONS = "true";
  try {
    const result = await run(
      "bun",
      [
        resolve(APP, "scripts/notify.ts"),
        "--status",
        statusPath,
        "--state",
        NOTIFY_STATE,
        "--report",
        reportPath,
        "--summary",
        NOTIFY_SUMMARY,
        "--now",
        now,
        ...(options.extra ?? []),
      ],
      { cwd: ROOT, env },
    );
    notifyOutput.push(`${result.stdout}${result.stderr}`);
  } catch (error) {
    notifyOutput.push(childOutput(error));
    throw error;
  }
  return readJson<NotifyReport>(reportPath);
}
const notifyState = () => readJson<NotifyStateJson>(NOTIFY_STATE);
const take = () => {
  const list = received;
  received = [];
  return list;
};
const bySubscription = (list: Received[]) => {
  const groups: Record<string, string[]> = {};
  for (const item of list) {
    groups[item.subscription] = [...(groups[item.subscription] ?? []), item.headers["x-openbot-event"] ?? ""];
  }
  return groups;
};

/** Checks the signature as a receiver must: HMAC-SHA256 of `<timestamp>.<delivery>.<body>`, in constant time. */
function verify(item: Received, secret: string) {
  const timestamp = item.headers["x-openbot-timestamp"] ?? "";
  assert.ok(Math.abs(Date.now() / 1000 - Number(timestamp)) < 300, "The timestamp is not the send time.");
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret)
      .update(`${timestamp}.${item.headers["x-openbot-delivery-id"] ?? ""}.${item.body}`)
      .digest("hex")}`,
  );
  const actual = Buffer.from(item.headers["x-openbot-signature"] ?? "");
  assert.ok(
    actual.length === expected.length && timingSafeEqual(actual, expected),
    `Bad signature for ${item.subscription}.`,
  );
}

const STATUS_A = statusFile("2026-10-16T10:40:00Z", [], [maintenance(), links([investigating])]);
const STATUS_B = statusFile(
  "2026-10-16T12:05:00Z",
  ["marketplace"],
  [signIn, maintenance(), links([identified, investigating])],
);

// No state and no --bootstrap must stop: it would send every current event again.
await assert.rejects(notify("no-state", STATUS_A, "2026-10-16T10:41:00Z"), "A run without state must fail.");
assert.equal(existsSync(NOTIFY_STATE), false, "A failed run wrote a state file.");

// A bad secret stops the run and names the field, not the value.
const badUrl = `http://example.com/hook/${RECEIVER_TOKEN}`;
for (const [label, hooks] of [
  ["http", [{ id: "team", url: badUrl, secret: SECRETS.team }]],
  ["short secret", [{ id: "team", url: hookUrl("team"), secret: RECEIVER_TOKEN.slice(0, 20) }]],
  ["unknown field", [{ id: "team", url: hookUrl("team"), secret: SECRETS.team, pause: true }]],
  ["duplicate", [HOOKS[0], HOOKS[0]]],
] as const) {
  await assert.rejects(
    notify(`bad-${label.replace(" ", "-")}`, STATUS_A, "2026-10-16T10:41:00Z", { hooks, extra: ["--bootstrap"] }),
    `STATUS_WEBHOOKS with ${label} must fail.`,
  );
}
assert.equal(existsSync(NOTIFY_STATE), false);

let notified = await notify("bootstrap", STATUS_A, "2026-10-16T10:41:00Z", { extra: ["--bootstrap"] });
assert.deepEqual(take(), [], "The bootstrap run sent an event.");
assert.deepEqual(notified.queued, []);
assert.deepEqual(Object.keys(notifyState().seen).sort(), [
  "incident.created:201",
  "incident.updated:201:2026-10-16T10:30:00Z:investigating",
  "maintenance.scheduled:202",
  "maintenance.updated:202:2026-10-15T08:00:00Z:scheduled",
]);
await assert.rejects(
  notify("bootstrap-again", STATUS_A, "2026-10-16T10:42:00Z", { extra: ["--bootstrap"] }),
  "--bootstrap with a state file must fail.",
);

// New update on 201, new incident 203, maintenance 202 starts, Marketplace goes down.
notified = await notify("events", STATUS_B, "2026-10-16T12:05:30Z");
assert.deepEqual(
  notified.found.filter((id) => !id.startsWith("incident.created:201") && !id.startsWith("maintenance.scheduled")),
  [
    `incident.updated:201:${investigating.at}:investigating`,
    `incident.updated:201:${identified.at}:identified`,
    `maintenance.updated:202:${scheduled.at}:scheduled`,
    "maintenance.started:202",
    "incident.created:203",
    // Its first update is in incident.created, so it is not sent alone.
    "incident.updated:203:2026-10-16T12:01:00Z:investigating",
    "service.changed:marketplace:2026-10-16T12:05:00Z",
  ],
);
let got = take();
assert.deepEqual(bySubscription(got), {
  team: ["incident.updated", "maintenance.started", "incident.created"],
  ops: ["service.changed"],
  slack: ["incident.created"],
  discord: ["incident.updated", "maintenance.started", "incident.created"],
  flaky: ["incident.created"],
  dead: ["incident.created"],
  redirect: ["incident.created"],
});
for (const item of got.filter((entry) => entry.subscription === "team" || entry.subscription === "ops")) {
  verify(item, item.subscription === "team" ? SECRETS.team : SECRETS.ops);
  const body = JSON.parse(item.body);
  assert.equal(body.version, 1);
  assert.equal(body.type, item.headers["x-openbot-event"]);
  assert.equal(body.page, "https://status.openbot.run");
  assert.match(item.headers["x-openbot-delivery-id"] ?? "", /^[0-9a-f]{32}$/);
}
const created = JSON.parse(
  got.find((item) => item.subscription === "team" && item.headers["x-openbot-event"] === "incident.created")?.body ??
    "{}",
);
assert.deepEqual(
  { id: created.incident.id, services: created.incident.services, update: created.incident.update.stage },
  {
    id: 203,
    services: [
      { id: "accounts", name: "Accounts and sign-in" },
      { id: "hosted", name: "Hosted servers" },
    ],
    update: "investigating",
  },
);
const changed = JSON.parse(got.find((item) => item.subscription === "ops")?.body ?? "{}");
assert.deepEqual(changed.service, {
  id: "marketplace",
  name: "Marketplace",
  previous: "ok",
  current: "down",
  checkedAt: "2026-10-16T12:05:00Z",
});
const slack = got.find((item) => item.subscription === "slack");
assert.equal(slack?.headers["x-openbot-signature"], undefined, "A chat subscription without a secret got a signature.");
const slackText = JSON.parse(slack?.body ?? "{}").text;
assert.match(slackText, /^\*New incident: Sign-in fails\*/);
assert.match(slackText, /&lt;some&gt; users &amp; @everyone/, "Slack text is not escaped.");
assert.match(slackText, /<https:\/\/github\.com\/nightly-labs\/openbot\/issues\/203\|Open>$/);
const discord = JSON.parse(got.filter((item) => item.subscription === "discord").at(-1)?.body ?? "{}");
assert.deepEqual(discord.allowed_mentions, { parse: [] }, "A Discord message can notify @everyone.");
assert.match(
  discord.content,
  /^\*\*New incident: Sign-in fails\*\*\nMajor outage: Accounts and sign-in, Hosted servers\n/,
);
const deliveryIds = got.map((item) => item.headers["x-openbot-delivery-id"]);
assert.equal(new Set(deliveryIds).size, deliveryIds.length, "Two deliveries have the same ID.");
assert.deepEqual(
  notifyState().outbox.map((item) => [item.subscription, item.attempts, item.nextAt]),
  [
    ["flaky", 1, "2026-10-16T12:10:30.000Z"],
    ["dead", 1, "2026-10-16T12:10:30.000Z"],
    ["redirect", 1, "2026-10-16T12:10:30.000Z"],
  ],
  "A failed delivery waits 5 minutes. A redirect is a failure.",
);

// The same status again, and an older one from an issue event: no new event, no early retry.
notified = await notify("repeat", STATUS_B, "2026-10-16T12:06:00Z");
assert.deepEqual(take(), []);
assert.deepEqual(notified.queued, []);
notified = await notify("older", statusFile("2026-10-16T11:00:00Z", [], STATUS_B.incidents), "2026-10-16T12:07:00Z");
assert.deepEqual(take(), [], "An older status.json sent a service change.");
assert.equal(notifyState().checkedAt, "2026-10-16T12:05:00Z");

// A removed subscription loses its waiting deliveries. Then the retries run to their end.
const hooksLeft = HOOKS.filter((hook) => hook.id !== "redirect");
notified = await notify("removed", STATUS_B, "2026-10-16T12:08:00Z", { hooks: hooksLeft });
assert.deepEqual(
  notified.dropped.map((item) => [item.subscription, item.reason]),
  [["redirect", "The subscription is paused or removed."]],
);
const tries: { now: string; sent: string[] }[] = [];
for (let round = 0; notifyState().outbox.length > 0; round++) {
  assert.ok(round < 10, "The retries do not end.");
  const now = notifyState()
    .outbox.map((item) => item.nextAt)
    .sort()[0];
  assert.ok(now);
  notified = await notify(`retry-${round}`, STATUS_B, now, { hooks: hooksLeft });
  tries.push({
    now,
    sent: notified.sent.map((item) => `${item.subscription} ${item.attempt} ${item.ok ? "ok" : item.reason}`),
  });
}
const retried = bySubscription(take());
assert.equal(retried.flaky?.length, 2, "flaky is delivered on its third try.");
assert.equal(retried.dead?.length, 7, "dead is tried 8 times in total.");
// The retry clock passes the end of the maintenance window (12:30), so it completes here. A redirect
// to team would add incident.created.
assert.deepEqual(retried.team, ["maintenance.completed"], "A redirect reached another subscription.");
assert.deepEqual(retried.discord, ["maintenance.completed"]);
assert.deepEqual(
  tries.map((item) => item.now),
  [
    "2026-10-16T12:10:30.000Z",
    "2026-10-16T12:20:30.000Z",
    "2026-10-16T12:40:30.000Z",
    "2026-10-16T13:20:30.000Z",
    "2026-10-16T14:40:30.000Z",
    "2026-10-16T17:20:30.000Z",
    "2026-10-16T22:40:30.000Z",
  ],
  "The waits are 5, 10, 20, 40, 80, 160 and 320 minutes.",
);
assert.deepEqual(
  notified.dropped.map((item) => [item.subscription, item.reason]),
  [["dead", "Failed after 8 tries: HTTP 500"]],
);
assert.match(readFileSync(NOTIFY_SUMMARY, "utf8"), /\| dead \| incident\.created \| 8 \| HTTP 500\. No more tries \|/);

// 201 is resolved, 202 is complete and Marketplace is back.
const STATUS_C = statusFile(
  "2026-10-17T00:00:00Z",
  [],
  [
    signIn,
    maintenance(),
    links(
      [
        { at: "2026-10-16T13:00:00Z", stage: "resolved", body: "This incident is resolved." },
        identified,
        investigating,
      ],
      "2026-10-16T13:00:00Z",
    ),
  ],
);
notified = await notify("end", STATUS_C, "2026-10-17T00:00:30Z", { hooks: hooksLeft });
got = take();
assert.deepEqual(bySubscription(got), {
  team: ["incident.resolved"],
  ops: ["incident.resolved", "service.changed"],
  discord: ["incident.resolved"],
});
const resolved = JSON.parse(
  got.find((item) => item.subscription === "team" && item.headers["x-openbot-event"] === "incident.resolved")?.body ??
    "{}",
);
assert.equal(resolved.incident.update.stage, "resolved", "The resolved event does not carry the final update.");

// The test event goes to each active subscription, with or without a filter.
notified = await notify("test", STATUS_C, "2026-10-17T00:01:00Z", { hooks: hooksLeft, extra: ["--test"] });
got = take();
assert.deepEqual(Object.keys(bySubscription(got)).sort(), ["dead", "discord", "flaky", "ops", "slack", "team"]);
assert.ok(got.every((item) => item.headers["x-openbot-event"] === "test"));
const teamTest = got.find((item) => item.subscription === "team");
assert.ok(teamTest);
verify(teamTest, SECRETS.team);
assert.ok(!Object.keys(notifyState().seen).some((id) => id.startsWith("test:")), "A test event is in the seen list.");

// In GitHub Actions the script masks each URL and secret before anything else.
await notify("actions", STATUS_C, "2026-10-17T00:02:00Z", { hooks: hooksLeft, actions: true });
const actionsOutput = notifyOutput.pop() ?? "";
const masks = actionsOutput.split("\n").filter((line) => line.startsWith("::add-mask::"));
for (const value of [...Object.values(SECRETS).filter((value) => value !== SECRETS.redirect), RECEIVER_TOKEN]) {
  assert.ok(
    masks.some((line) => line.includes(value)),
    "A secret is not masked in GitHub Actions.",
  );
}
assert.ok(
  actionsOutput
    .split("\n")
    .every((line) => line.startsWith("::add-mask::") || !leakValues.some((value) => line.includes(value))),
  "A secret is in the GitHub Actions log outside an add-mask command.",
);
// An incident that opens again sends no old "Resolved" update. An open incident that leaves the page
// (closed as not planned) and a maintenance that is closed before its start send one event, after 2
// runs without them. The first update of an incident that opened with none is sent when it comes.
const resolvedUpdate = { at: "2026-10-16T13:00:00Z", stage: "resolved", body: "This incident is resolved." };
const reopened = links([resolvedUpdate, identified, investigating]);
const later = incident({
  id: 204,
  title: "Accounts database upgrade",
  kind: "maintenance",
  impact: "maintenance",
  components: ["accounts"],
  startedAt: "2026-10-20T12:00:00Z",
  resolvedAt: "2026-10-20T13:00:00Z",
  updates: [],
});
const empty = (updates: UpdateFixture[]) =>
  incident({ id: 205, title: "Slow downloads", components: ["updates"], startedAt: "2026-10-17T00:02:30Z", updates });
const slowNote = { at: "2026-10-17T00:03:30Z", stage: "identified", body: "A slow mirror." };
const sortedEvents = (list: Received[]) => {
  const groups = bySubscription(list);
  return { team: [...(groups.team ?? [])].sort(), discord: [...(groups.discord ?? [])].sort(), ops: groups.ops };
};

notified = await notify(
  "reopen",
  statusFile("2026-10-17T00:03:00Z", [], [empty([]), later, reopened, maintenance()]),
  "2026-10-17T00:03:00Z",
  {
    hooks: hooksLeft,
  },
);
assert.deepEqual(sortedEvents(take()), {
  team: ["incident.created", "maintenance.scheduled"],
  discord: ["incident.created", "maintenance.scheduled"],
  ops: undefined,
});
const withNote = [empty([slowNote]), later, reopened, maintenance()];
notified = await notify("removed-incident", statusFile("2026-10-17T00:04:00Z", [], withNote), "2026-10-17T00:04:00Z", {
  hooks: hooksLeft,
});
got = take();
assert.deepEqual(sortedEvents(got), {
  team: ["incident.removed", "incident.updated"],
  discord: ["incident.removed", "incident.updated"],
  ops: undefined,
});
const removed = JSON.parse(
  got.find((item) => item.subscription === "team" && item.headers["x-openbot-event"] === "incident.removed")?.body ??
    "{}",
);
assert.equal(removed.incident.id, 203);
assert.equal(removed.incident.title, "Sign-in fails");
const withoutLater = [empty([slowNote]), reopened, maintenance()];
await notify("cancel-1", statusFile("2026-10-17T00:05:00Z", [], withoutLater), "2026-10-17T00:05:00Z", {
  hooks: hooksLeft,
});
assert.deepEqual(take(), [], "A maintenance that is missing for one run is cancelled.");
await notify("cancel-2", statusFile("2026-10-17T00:05:30Z", [], withoutLater), "2026-10-17T00:05:30Z", {
  hooks: hooksLeft,
});
assert.deepEqual(sortedEvents(take()), {
  team: ["maintenance.cancelled"],
  discord: ["maintenance.cancelled"],
  ops: undefined,
});
assert.deepEqual(Object.keys(notifyState().open).sort(), ["201", "205"]);
receiver.close();

const scanned = [
  ...notifyOutput,
  readFileSync(NOTIFY_STATE, "utf8"),
  readFileSync(NOTIFY_SUMMARY, "utf8"),
  ...tries.map((item) => JSON.stringify(item)),
];
for (const text of scanned) {
  for (const value of leakValues) assert.equal(text.includes(value), false, "A URL token or secret is in the output.");
}
const webhooks = { tries, summary: readFileSync(NOTIFY_SUMMARY, "utf8") };
writeFileSync(resolve(OUT, "webhook-summary.md"), webhooks.summary);
logger.info("Status webhooks: passed.");

// 3. One read-only run against the live services ----------------------------------------

let live: RunReport["outcomes"] | null = null;
if (!skipLive) {
  const liveDir = resolve(WORK, "live");
  const liveReport = resolve(liveDir, "report.json");
  await run(
    "bun",
    [
      resolve(APP, "scripts/update.ts"),
      "--state",
      resolve(liveDir, "state.json"),
      "--out",
      resolve(liveDir, "site"),
      "--report",
      liveReport,
      "--dry-run",
      "--bootstrap",
    ],
    { cwd: ROOT, env: childEnv() },
  );
  live = readJson<RunReport>(liveReport).outcomes;
  for (const [id, outcome] of Object.entries(live)) {
    assert.match(outcome.result, /^(ok|degraded|down)$/);
    logger.info(`Live ${id}: ${outcome.result}${outcome.reason ? ` (${outcome.reason})` : ""}`);
  }
}

// 4. The built page in Chrome ---------------------------------------------------------

await run("bun", ["run", "build"], { cwd: APP });
const PAGES = resolve(WORK, "pages");
cpSync(resolve(APP, "dist"), PAGES, { recursive: true });
cpSync(resolve(SITE, "status.json"), resolve(PAGES, "status.json"));
cpSync(resolve(SITE, "feed.xml"), resolve(PAGES, "feed.xml"));

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".xml": "application/atom+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const pageServer = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = resolve(PAGES, `.${path === "/" ? "/index.html" : path}`);
  if (!file.startsWith(PAGES) || !existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
});
const pagePort = await listen(pageServer);

// axe-core comes with the Storybook accessibility add-on.
const AXE = new URL(import.meta.resolve("axe-core/axe.min.js")).pathname;

interface AxeViolation {
  id: string;
  nodes: { target: string[] }[];
}

declare global {
  interface Window {
    axe?: { run: () => Promise<{ violations: AxeViolation[] }> };
  }
}

/** The page reads the clock: 40 minutes after the last run, so the checks are late. */
const PAGE_NOW = new Date("2026-10-16T11:30:00Z");

const browser = await chromium.launch(
  browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
);
const views: { name: string; width: number; height: number; screenshot: string }[] = [];
try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport, timezoneId: "Europe/Warsaw" });
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(PAGE_NOW);

    await page.goto(`http://127.0.0.1:${pagePort}/`);
    const banner = page.getByRole("region", { name: "Current status" });
    await banner.getByRole("heading").waitFor();
    // Incident 101 is open, and the run at 10:50 is 40 minutes old.
    assert.equal(await banner.getByRole("heading").textContent(), "1 of 5 services affected");
    assert.match((await banner.textContent()) ?? "", /Checks are late/);

    const services = page.getByRole("region", { name: "Services" });
    const bars = services.getByRole("img");
    assert.equal(await services.getByRole("heading", { level: 3 }).count(), 5);
    assert.equal(await bars.count(), 5);
    assert.match((await bars.first().getAttribute("aria-label")) ?? "", /in the last 90 days/);
    await page.getByRole("button", { name: "30 days" }).click();
    assert.match((await bars.first().getAttribute("aria-label")) ?? "", /in the last 30 days/);
    assert.equal(await page.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed"), "true");

    // The active incident shows its update as text, not as markup.
    const notice = page.getByRole("article").filter({ hasText: "Marketplace pages load slowly" });
    assert.equal(await notice.locator("b").count(), 0);
    assert.match((await notice.textContent()) ?? "", /<b>Installed<\/b>/);
    assert.equal(await page.getByRole("article").filter({ hasText: "Connections server upgrade" }).count(), 1);
    assert.equal(await page.getByText("Everything is down").count(), 0, "An issue from a stranger is on the page.");

    const history = page.getByRole("button", { name: "Phones and teammates could not connect" });
    assert.equal(await history.getAttribute("aria-expanded"), "false");
    await history.click();
    assert.equal(await history.getAttribute("aria-expanded"), "true");
    await page.getByRole("link", { name: "Open the issue" }).waitFor();

    await page.addScriptTag({ path: AXE });
    const violations = await page.evaluate(async () => {
      if (!window.axe) throw new Error("axe-core did not load.");
      const result = await window.axe.run();
      return result.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.target.join(" ")),
      }));
    });
    assert.deepEqual(violations, [], `axe-core violations at ${viewport.width} px`);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `The page scrolls sideways at ${viewport.width} px.`);

    const screenshot = resolve(OUT, `${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    assert.deepEqual(errors, [], "Console errors");
    views.push({ ...viewport, screenshot });
    await page.close();
  }
} finally {
  await browser.close();
  pageServer.close();
}

writeFileSync(
  resolve(OUT, "report.json"),
  `${JSON.stringify({ passed: true, steps, webhooks, live, views }, null, 2)}\n`,
);
logger.info(`Passed. Report: ${resolve(OUT, "report.json")}`);
