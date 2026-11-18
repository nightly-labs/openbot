// Checks that the Claude account check reads the sign-in that the CLI stored, and starts
// `claude auth status` only when no usable refresh token is stored. A short `auth status` can start
// an OAuth refresh and exit before it saves the rotated tokens, and the next Claude process then
// clears the sign-in (anthropics/claude-code#105645). The real Claude driver and client run against
// a fake CLI that logs each start, with `CLAUDE_CONFIG_DIR` in a temp folder. On macOS that folder
// names a Keychain item that does not exist, so the client reads `.credentials.json`.
// Cases: an expired access token with a live refresh token starts no process and keeps the email,
// plan and organization; blank tokens, no credential file, an expired refresh token and
// `CLAUDE_CODE_OAUTH_TOKEN` each ask the CLI once.
// `bun scripts/claude-stored-sign-in-e2e.ts`. Writes .openbot-build/claude-stored-sign-in-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-stored-sign-in-e2e");
const REPORT = join(OUT, "report.json");
const root = await mkdtemp(join(tmpdir(), "openbot-claude-stored-sign-in-"));
const executable = join(root, "claude.cjs");
const logPath = join(root, "claude.jsonl");
// A sign-in from the shell would decide each case.
for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete process.env[name];
process.env.FAKE_CLAUDE_LOG = logPath;

/** Logs each start. `auth status` says signed out, as the CLI does after it cleared the tokens. */
const FAKE_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2).slice(0, 3) }) + String.fromCharCode(10));
if (process.argv.slice(2).join(" ") === "auth status --json") {
  process.stdout.write(JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" }));
  process.exit(1);
}
process.exit(2);
`;

const driver = BUILT_IN_PROVIDER_DRIVERS.find((item) => item.id === "claude");
assert.ok(driver, "no Claude driver");
const claudeDriver = driver;

interface CaseResult {
  readonly name: string;
  readonly account: unknown;
  readonly authStatusStarts: number;
}

function authStatusStarts(): number {
  let text = "";
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return 0;
  }
  return text
    .split("\n")
    .filter(Boolean)
    .filter((line) => JSON.parse(line).args[0] === "auth").length;
}

/** Writes the case folder and runs the account check of a client for it. */
async function runCase(
  name: string,
  files: { credentials?: unknown; settings?: unknown },
  environment: Readonly<Record<string, string>> = {},
): Promise<CaseResult> {
  const folder = join(root, name);
  await mkdir(folder, { recursive: true });
  if (files.credentials !== undefined)
    await writeFile(join(folder, ".credentials.json"), JSON.stringify(files.credentials));
  if (files.settings !== undefined) await writeFile(join(folder, ".claude.json"), JSON.stringify(files.settings));
  const before = authStatusStarts();
  const client = claudeDriver.createClient({ executable, version: "2.1.318" }, 5_000, {
    ...NO_PROVIDER_CREDENTIALS,
    accountEnvironment: { CLAUDE_CONFIG_DIR: folder, ...environment },
  });
  client.start();
  try {
    const account = await runCauseEffect(client.request("account/read", {}, (value) => value));
    return { name, account, authStatusStarts: authStatusStarts() - before };
  } finally {
    await runCauseEffect(client.stop());
  }
}

const now = Date.now();
const credential = (refreshToken: string, refreshTokenExpiresAt = now + 86_400_000) => ({
  claudeAiOauth: {
    accessToken: refreshToken ? "access-e2e" : "",
    refreshToken,
    // The access token expired: `auth status` would start a refresh now.
    expiresAt: refreshToken ? now - 60_000 : 0,
    refreshTokenExpiresAt,
    scopes: ["user:inference"],
    subscriptionType: "max",
  },
});
const settings = {
  oauthAccount: { emailAddress: "owner@example.invalid", organizationUuid: "org-owner", organizationName: "Owner" },
};
const SIGNED_OUT = { account: null, requiresOpenaiAuth: false };

const report: { cases: CaseResult[]; result?: "pass" | "fail"; error?: string } = { cases: [] };
try {
  await writeFile(executable, FAKE_CLAUDE);
  await chmod(executable, 0o755);

  const stored = await runCase("stored", { credentials: credential("refresh-e2e"), settings });
  report.cases.push(stored);
  assert.deepEqual(stored.account, {
    account: { type: "claude", email: "owner@example.invalid", planType: "max", organization: "org-owner" },
    requiresOpenaiAuth: false,
  });
  assert.equal(stored.authStatusStarts, 0, "a stored sign-in started `auth status`");

  const cleared = await runCase("cleared", { credentials: credential(""), settings });
  report.cases.push(cleared);
  assert.deepEqual(cleared.account, SIGNED_OUT, "blank tokens did not read as signed out");
  assert.equal(cleared.authStatusStarts, 1, "blank tokens did not ask the CLI once");

  const missing = await runCase("missing", {});
  report.cases.push(missing);
  assert.deepEqual(missing.account, SIGNED_OUT, "no credential did not read as signed out");
  assert.equal(missing.authStatusStarts, 1, "no credential did not ask the CLI once");

  const expired = await runCase("refresh-expired", { credentials: credential("refresh-e2e", now - 1_000), settings });
  report.cases.push(expired);
  assert.equal(expired.authStatusStarts, 1, "an expired refresh token did not ask the CLI once");

  const token = await runCase(
    "oauth-token-variable",
    { credentials: credential("refresh-e2e"), settings },
    { CLAUDE_CODE_OAUTH_TOKEN: "token-e2e" },
  );
  report.cases.push(token);
  assert.equal(token.authStatusStarts, 1, "CLAUDE_CODE_OAUTH_TOKEN did not ask the CLI once");

  report.result = "pass";
} catch (error) {
  report.result = "fail";
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`PASS claude-stored-sign-in-e2e: ${REPORT}\n`);
