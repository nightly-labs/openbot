// Drives a Sign in through the MCP probe against Google's Calendar MCP server, with a saved sign-in
// app, up to the Google authorization page, and checks that the page asks for a refresh token.
// Needs the network and no Google account: the client ID is a placeholder, so the page is never
// shown and no grant is made. Writes a JSON report.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpOAuth, type McpOAuthRecord } from "../src/backend/mcp-oauth-provider";
import { testMcpServer } from "../src/backend/mcp-probe";

const out = resolve(import.meta.dirname, "../.openbot-build/mcp-google-offline-access-e2e");
const SERVER_URL = "https://calendarmcp.googleapis.com/mcp/v1";
const CLIENT_ID = "000000000000-e2e.apps.googleusercontent.com";

interface Case {
  name: string;
  page: Record<string, string> | null;
  failures: string[];
}

const report: { passed: boolean; cases: Case[] } = { passed: false, cases: [] };

function httpConfig(url: string): McpServerConfig {
  return {
    id: "google-calendar",
    name: "google_calendar",
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url,
    headers: [],
  };
}

async function runCase(name: string, scope: string): Promise<Case> {
  const records = new Map<string, McpOAuthRecord>();
  records.set(SERVER_URL, { app: { clientId: CLIENT_ID, clientSecret: "e2e-secret", ...(scope ? { scope } : {}) } });
  const opened: string[] = [];
  const oauth = new McpOAuth({
    storage: {
      read: (resource) => records.get(resource) ?? null,
      write: (resource, record) => Effect.sync(() => void records.set(resource, record)),
      clear: (resource) => Effect.sync(() => void records.delete(resource)),
    },
    // The browser never opens: the page is only read, and the sign-in then times out.
    openExternal: async (page) => void opened.push(page),
    redirectUrl: "http://127.0.0.1:28417/mcp-auth",
    signInTimeoutMs: 2_000,
  });
  const failures: string[] = [];
  try {
    const authority = {
      accessToken: (url: string) => oauth.accessToken(url),
      signIn: (url: string) => oauth.signIn(url),
    };
    await runCauseEffect(testMcpServer(httpConfig(SERVER_URL), 20_000, undefined, authority, "here"));
  } finally {
    await runCauseEffect(oauth.close());
  }
  const first = opened[0];
  if (opened.length !== 1 || !first) {
    failures.push(`expected one authorization page, got ${opened.length}`);
    return { name, page: null, failures };
  }
  const url = new URL(first);
  const page = Object.fromEntries(url.searchParams);
  for (const key of ["state", "code_challenge"]) if (page[key]) page[key] = "(set)";
  const check = (condition: boolean, text: string) => condition || failures.push(text);
  check(url.origin === "https://accounts.google.com", `the page is on ${url.origin}`);
  check(page.client_id === CLIENT_ID, "the page does not name the sign-in app");
  check(page.access_type === "offline", "the page does not ask for a refresh token (access_type=offline)");
  check(page.prompt === "consent", "the page does not ask for consent, so a second sign-in gets no refresh token");
  check(page.code_challenge_method === "S256", "the page does not use S256 PKCE");
  if (scope) check(page.scope === scope, `the page asks for ${page.scope}, not the app's scope`);
  return { name, page, failures };
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  report.cases.push(
    await runCase("sign-in app with read-only scope", "https://www.googleapis.com/auth/calendar.readonly"),
  );
  report.cases.push(await runCase("sign-in app with no scope", ""));
  report.passed = report.cases.every((entry) => entry.failures.length === 0);
  await writeFile(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

await main();
