// Reads the OpenCode Go quota end to end with the key the OpenCode CLI uses, from a real OpenCode 2
// database and `auth.json` in a temporary `XDG_DATA_HOME`, and with a fake `opencode.ai` in place of
// `fetch`. Checks that a saved key is the only key sent, that with no saved key the Console
// connection comes first, then the `opencode-go` key in `auth.json`, then `OPENCODE_API_KEY` (#3548),
// that a rejected key moves the read to the next one, that an inactive, OAuth or self-hosted Console
// row is not read, that `OPENCODE_AUTH_CONTENT` replaces the local sign-in, and that no key sends
// nothing. `bun scripts/opencode-go-usage-e2e.ts`. Writes .openbot-build/opencode-go-usage-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { readOpenCodeGoUsage } from "../src/backend/opencode-usage";
import type { AccountRateLimitsReadResult } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-go-usage-e2e");
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const RESETS_AT = "2026-11-01T10:00:00.000Z";

interface UsageCase {
  readonly sent: readonly string[];
  readonly reading: AccountRateLimitsReadResult;
}

interface Report {
  passed: boolean;
  noKey?: UsageCase;
  environmentKey?: UsageCase;
  savedKey?: UsageCase;
  savedKeyRejected?: UsageCase;
  authFileKey?: UsageCase;
  consoleKey?: UsageCase;
  consoleKeyRejected?: UsageCase;
  selfHostedConsole?: UsageCase;
  oauthConsole?: UsageCase;
  inlineAuth?: UsageCase;
  allRejected?: UsageCase;
}

const report: Report = { passed: false };
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-go-usage-e2e-"));
const dataDirectory = join(root, "data", "opencode");
const authFile = join(dataDirectory, "auth.json");
const databaseFile = join(dataDirectory, "opencode.db");

/** The keys the fake console accepts. Any other key gets 401. */
let accepted = new Set<string>();
let sent: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== USAGE_URL) throw new Error(`Unexpected request to ${url}.`);
    const key = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /u, "") ?? "";
    sent.push(key);
    if (!accepted.has(key)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const window = (percent: number) => ({ percent, resetsAt: RESETS_AT });
    return Response.json({ usage: { rolling: window(12), weekly: window(30), monthly: window(55) } });
  },
  { preconnect: realFetch.preconnect },
);

process.env.XDG_DATA_HOME = join(root, "data");
for (const name of ["OPENCODE_API_KEY", "OPENCODE_AUTH_CONTENT", "OPENCODE_DB"]) delete process.env[name];

/** The `credential` table as OpenCode 2.1.1 leaves it after its migrations, in WAL mode as OpenCode runs it. */
function writeDatabase(rows: readonly { id: string; value: unknown; active: number | null; created: number }[]) {
  const database = new DatabaseSync(databaseFile);
  try {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec(`CREATE TABLE IF NOT EXISTS credential (
      id text PRIMARY KEY, integration_id text, label text NOT NULL, value text NOT NULL,
      connector_id text, method_id text, active integer, time_created integer NOT NULL, time_updated integer NOT NULL)`);
    database.exec("DELETE FROM credential");
    const insert = database.prepare(
      "INSERT INTO credential (id, integration_id, label, value, active, time_created, time_updated) VALUES (?, 'opencode', 'OpenCode', ?, ?, ?, ?)",
    );
    for (const row of rows) insert.run(row.id, JSON.stringify(row.value), row.active, row.created, row.created);
  } finally {
    database.close();
  }
}

async function readUsage(savedKey: string | null, accept: readonly string[]): Promise<UsageCase> {
  accepted = new Set(accept);
  sent = [];
  const reading = await runCauseEffect(readOpenCodeGoUsage(savedKey));
  return { sent, reading };
}

const goReading = {
  limitId: "opencode",
  primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: Date.parse(RESETS_AT) / 1_000 },
  secondary: { usedPercent: 55, windowDurationMins: 43_200, resetsAt: Date.parse(RESETS_AT) / 1_000 },
};

try {
  await mkdir(dataDirectory, { recursive: true });

  // 1. No key anywhere: nothing is sent.
  const none = await readUsage(null, []);
  report.noKey = none;
  assert.deepEqual(none.sent, [], "no request without a key");
  assert.equal(none.reading.rateLimits, null);

  // 2. The case of #3548: the key is only in the environment that started OpenBot.
  process.env.OPENCODE_API_KEY = "fake-env";
  const env = await readUsage(null, ["fake-env"]);
  report.environmentKey = env;
  assert.deepEqual(env.sent, ["fake-env"]);
  assert.deepEqual(env.reading.rateLimits, goReading, "the environment key reads the Go quota");

  // 3. A saved key is the only key the CLI uses, so it is the only key sent, also when rejected.
  const saved = await readUsage("fake-saved", ["fake-saved"]);
  report.savedKey = saved;
  assert.deepEqual(saved.sent, ["fake-saved"]);
  assert.deepEqual(saved.reading.rateLimits, goReading);
  const savedRejected = await readUsage("fake-saved", ["fake-env"]);
  report.savedKeyRejected = savedRejected;
  assert.deepEqual(savedRejected.sent, ["fake-saved"], "a rejected saved key does not fall back");
  assert.equal(savedRejected.reading.rateLimits, null);

  // 4. OpenCode applies the `opencode-go` key in `auth.json` after the environment key.
  await writeFile(
    authFile,
    JSON.stringify({ "opencode-go": { type: "api", key: "fake-auth-file" }, anthropic: { type: "api", key: "x" } }),
  );
  const authFileKey = await readUsage(null, ["fake-auth-file"]);
  report.authFileKey = authFileKey;
  assert.deepEqual(authFileKey.sent, ["fake-auth-file"]);

  // 5. The active Console connection in the database comes first.
  writeDatabase([
    { id: "old", value: { type: "key", key: "fake-console-old" }, active: null, created: 1 },
    {
      id: "console",
      value: { type: "key", key: "fake-console", metadata: { server: "https://opencode.ai/console/" } },
      active: 1,
      created: 2,
    },
    { id: "off", value: { type: "key", key: "fake-console-off" }, active: 0, created: 3 },
  ]);
  const consoleKey = await readUsage(null, ["fake-console"]);
  report.consoleKey = consoleKey;
  assert.deepEqual(consoleKey.sent, ["fake-console"], "the active Console row, not the inactive newer one");
  assert.deepEqual(consoleKey.reading.rateLimits, goReading);

  // 6. A rejected Console key moves the read to the `auth.json` key.
  const consoleRejected = await readUsage(null, ["fake-auth-file"]);
  report.consoleKeyRejected = consoleRejected;
  assert.deepEqual(consoleRejected.sent, ["fake-console", "fake-auth-file"]);
  assert.deepEqual(consoleRejected.reading.rateLimits, goReading);

  // 7. A self-hosted Console or an OAuth connection is not read, and does not fall through to an older row.
  writeDatabase([
    { id: "old", value: { type: "key", key: "fake-console-old" }, active: null, created: 1 },
    {
      id: "hosted",
      value: { type: "key", key: "fake-hosted", metadata: { server: "https://console.example.com" } },
      active: 1,
      created: 2,
    },
  ]);
  const hosted = await readUsage(null, ["fake-auth-file", "fake-hosted", "fake-console-old"]);
  report.selfHostedConsole = hosted;
  assert.deepEqual(hosted.sent, ["fake-auth-file"]);
  writeDatabase([
    { id: "oauth", value: { type: "oauth", access: "a", refresh: "r", expires: 1 }, active: 1, created: 2 },
  ]);
  const oauth = await readUsage(null, ["fake-auth-file"]);
  report.oauthConsole = oauth;
  assert.deepEqual(oauth.sent, ["fake-auth-file"]);

  // 8. `OPENCODE_AUTH_CONTENT` replaces `auth.json` and the Console connection.
  writeDatabase([{ id: "console", value: { type: "key", key: "fake-console" }, active: 1, created: 2 }]);
  process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ "opencode-go": { type: "api", key: "fake-inline" } });
  const inline = await readUsage(null, ["fake-inline"]);
  report.inlineAuth = inline;
  assert.deepEqual(inline.sent, ["fake-inline"]);
  delete process.env.OPENCODE_AUTH_CONTENT;

  // 9. Every key rejected gives no reading.
  const rejected = await readUsage(null, []);
  report.allRejected = rejected;
  assert.deepEqual(rejected.sent, ["fake-console", "fake-auth-file"]);
  assert.equal(rejected.reading.rateLimits, null, "rejected keys give no reading");

  report.passed = true;
} finally {
  globalThis.fetch = realFetch;
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
