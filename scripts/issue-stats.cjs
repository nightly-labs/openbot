// issue-stats.cjs — GitHub issue numbers for the "All workflows" page. Zero dependencies: it polls
// `gh` every REFRESH_MIN minutes and serves the last good answer as JSON on loopback only (Host
// header checked, CORS limited to localhost origins) so the dev renderer can fetch it (its CSP
// allows http://localhost:*). Nothing is written to GitHub or to the OpenBot database.
//   node scripts/issue-stats.cjs                       serve on 127.0.0.1 + ::1, port 4178
//   ISSUE_STATS_REPO=owner/name node scripts/issue-stats.cjs
//   node scripts/issue-stats.cjs --once                one refresh, print the JSON, exit
// The repo: the ISSUE_STATS_REPO variable, else the origin remote of the directory the script
// starts in. A reader repoints it with GET /issue-stats?repo=owner/name; the next refresh follows,
// and the last good answer stays until it lands. GET /issue-stats →
// { generatedAt, refreshMs, repo, error?, open, closed }.
const http = require("http");
const { execFile } = require("child_process");

const PORT = Number(process.env.ISSUE_STATS_PORT || 4178);
const REFRESH_MIN = Number(process.env.ISSUE_STATS_REFRESH_MIN || 5);
const CLOSED_WINDOW_H = Number(process.env.ISSUE_STATS_CLOSED_WINDOW_H || 170);
const GH_TIMEOUT_MS = 90000;
const DAY = 86400000;
const REPO_SHAPE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Reading order of the label list: pipeline state first, the rest by count. Labels that wait on a
// person count into "for you"; both lists are settings of the pipeline a team runs.
const STATUS_ORDER = [
  "needs-plan",
  "plan-running",
  "plan-ready",
  "agent-ready",
  "build-running",
  "batch-running",
  "in-review",
  "needs-judge",
  "judge:pass",
  "judge:reject",
  "agent-failed",
  "needs-owner",
  "conflict",
  "test-red",
  "gold-path",
];
const OWNER_LABELS = (process.env.ISSUE_STATS_OWNER_LABELS || "needs-owner,needs-plan,plan-ready,owner-actions")
  .split(",")
  .map((label) => label.trim())
  .filter(Boolean);
const PRIORITIES = ["P0", "P1", "P2", "P3"];

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: "utf8", timeout: GH_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error)
          return reject(
            new Error(
              `${command} ${args.slice(0, 2).join(" ")} failed: ${(stderr || error.message).trim().slice(0, 200)}`,
            ),
          );
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`${command} returned an answer this helper cannot read`));
        }
      },
    );
  });
}

const gh = (args) => run("gh", args);

/** "owner/name" from the origin remote of this directory, or null when there is none. */
async function detectRepo() {
  try {
    const url = String(await gh(["remote", "get-url", "origin"])).trim();
    const match = /github\.com[/:]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/i.exec(url);
    return match && REPO_SHAPE.test(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

const names = (issue) => (issue.labels || []).map((label) => label.name);

function build(openIssues, closedIssues, now) {
  const since24 = now - DAY;
  const labels = new Map();
  const row = (name) => labels.get(name) || labels.set(name, { name, count: 0, opened24h: 0, closed24h: 0 }).get(name);
  const untagged = [];
  let forOwner = 0;
  for (const issue of openIssues) {
    const labelNames = names(issue);
    const created = Date.parse(issue.createdAt);
    if (!labelNames.length) untagged.push({ number: issue.number, title: issue.title });
    if (labelNames.some((label) => OWNER_LABELS.includes(label))) forOwner++;
    for (const label of labelNames) {
      const entry = row(label);
      entry.count++;
      if (created >= since24) entry.opened24h++;
    }
  }
  const closedWindow = closedIssues.filter((issue) => Date.parse(issue.closedAt) >= now - CLOSED_WINDOW_H * 3600000);
  for (const issue of closedWindow) {
    const closed = Date.parse(issue.closedAt);
    for (const label of names(issue)) {
      if (closed >= since24) row(label).closed24h++;
      if (Date.parse(issue.createdAt) >= since24) row(label).opened24h++;
    }
  }
  const rank = (name) => {
    const at = STATUS_ORDER.indexOf(name);
    return at < 0 ? STATUS_ORDER.length : at;
  };
  const labelRows = [...labels.values()]
    .filter((entry) => entry.count > 0 || entry.closed24h > 0)
    .sort((a, b) => rank(a.name) - rank(b.name) || b.count - a.count || a.name.localeCompare(b.name));

  // Closed per priority, in seven day buckets (index 6 is the last 24 hours).
  const buckets = {};
  for (const key of [...PRIORITIES, "none"]) buckets[key] = { key, done: 0, dropped: 0, days: [0, 0, 0, 0, 0, 0, 0] };
  for (const issue of closedWindow) {
    const priority = names(issue).find((label) => PRIORITIES.includes(label)) || "none";
    const bucket = buckets[priority];
    if (issue.stateReason === "COMPLETED") bucket.done++;
    else bucket.dropped++;
    const age = Math.floor((now - Date.parse(issue.closedAt)) / DAY);
    bucket.days[Math.max(0, Math.min(6, 6 - age))]++;
  }
  return {
    open: { total: openIssues.length, forOwner, untagged, labels: labelRows },
    closed: { windowHours: CLOSED_WINDOW_H, total: closedWindow.length, priorities: Object.values(buckets) },
  };
}

let repo = null;
let snapshot = null;
let lastError = null;
let refreshing = null;

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const now = Date.now();
      const sinceDay = new Date(now - (CLOSED_WINDOW_H / 24 + 1) * DAY).toISOString().slice(0, 10);
      const [open, closed] = await Promise.all([
        gh([
          "issue",
          "list",
          "--repo",
          repo,
          "--state",
          "open",
          "--limit",
          "1000",
          "--json",
          "number,title,labels,createdAt",
        ]),
        gh([
          "issue",
          "list",
          "--repo",
          repo,
          "--state",
          "closed",
          "--search",
          `closed:>=${sinceDay}`,
          "--limit",
          "1000",
          "--json",
          "number,title,labels,createdAt,closedAt,stateReason",
        ]),
      ]);
      snapshot = {
        generatedAt: new Date(now).toISOString(),
        refreshMs: REFRESH_MIN * 60000,
        repo,
        ...build(open, closed, now),
      };
      lastError = null;
    } catch (error) {
      lastError = String(error.message || error).slice(0, 200);
      console.error(new Date().toISOString(), "[issue-stats] refresh failed:", lastError);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

async function handle(request, response) {
  if (!LOCAL_HOST.test(request.headers.host || "")) {
    response.writeHead(403);
    return response.end();
  }
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  const origin = request.headers.origin;
  if (origin && LOCAL_ORIGIN.test(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    return response.end();
  }
  const url = new URL(request.url, "http://localhost");
  const asked = url.searchParams.get("repo");
  if (asked && REPO_SHAPE.test(asked) && asked !== repo) {
    repo = asked;
    void refresh();
  }
  if (request.method !== "GET" || url.pathname !== "/issue-stats") {
    response.writeHead(404, headers);
    return response.end("{}");
  }
  if (!snapshot) await refresh();
  if (!snapshot) {
    response.writeHead(503, headers);
    return response.end(JSON.stringify({ error: lastError || "no data yet" }));
  }
  response.writeHead(200, headers);
  response.end(JSON.stringify(lastError ? { ...snapshot, error: lastError } : snapshot));
}

async function main() {
  const fromEnv = process.env.ISSUE_STATS_REPO;
  repo = fromEnv && REPO_SHAPE.test(fromEnv) ? fromEnv : await detectRepo();
  if (process.argv.includes("--once")) {
    if (!repo) {
      console.error("No repo found. Set ISSUE_STATS_REPO=owner/name or start the helper inside a git checkout.");
      process.exitCode = 1;
      return;
    }
    await refresh();
    if (!snapshot) {
      console.error(lastError);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  if (!repo) {
    console.error(
      "[issue-stats] No repo found yet. Set ISSUE_STATS_REPO=owner/name, start the helper inside a git checkout, or pick a project in the page settings.",
    );
  } else {
    await refresh();
  }
  setInterval(() => void refresh(), REFRESH_MIN * 60000);
  const server = http.createServer((request, response) => {
    void handle(request, response);
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(
      `[issue-stats] http://127.0.0.1:${PORT}/issue-stats — repo ${repo || "(none yet)"} — every ${REFRESH_MIN} min`,
    );
  });
}

main().catch((error) => {
  console.error("[issue-stats] ", error.message);
  process.exitCode = 1;
});
