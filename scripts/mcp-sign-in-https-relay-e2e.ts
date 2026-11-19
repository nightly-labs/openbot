// End-to-end check of the Meta Ads MCP sign-in through the openbot.run relay.
//   bun scripts/mcp-sign-in-https-relay-e2e.ts
// Meta's ads MCP server registers only the clients it approved and refuses every `http` redirect,
// loopback too. OpenBot uses its own Meta app and the HTTPS relay page `/oauth/mcp-callback`.
// 1. Starts a sign-in with McpOAuth against the real https://mcp.facebook.com/ads. The browser is not
//    opened: the authorization page is read. It must name the OpenBot app and the relay address, and
//    the store must keep no registration.
// 2. Starts the site's development server and the real MCP grant listener of `src/main`. The relay
//    route must answer 302 to `http://127.0.0.1:28417/mcp-auth` with the query unchanged. That request
//    goes to the listener (on another port when the OpenBot app holds 28417), which must hand the grant
//    to the sign-in of step 1. A refusal must reach the listener as a refusal.
// 3. Starts a sign-in with an MCP server on this computer whose metadata names Meta's issuer. It must
//    not get the OpenBot Meta app: that app's token would go to the server that asked for it.
// Writes .openbot-build/mcp-sign-in-https-relay-e2e/report.json. Needs network access to Meta.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  MCP_OAUTH_RELAY_URL,
  McpOAuth,
  type McpOAuthRecord,
  mcpOAuthRecordSchema,
} from "../src/backend/mcp-oauth-provider";
import { MCP_OAUTH_REDIRECT_PORT, startMcpOAuthRedirectServer } from "../src/main/mcp-oauth-redirect-server";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/mcp-sign-in-https-relay-e2e");
const META_ADS_MCP_URL = "https://mcp.facebook.com/ads";
const META_APP_ID = "1479376854168579";
const LOOPBACK_REDIRECT_URL = `http://127.0.0.1:${MCP_OAUTH_REDIRECT_PORT}/mcp-auth`;

interface Delivery {
  state: string;
  code: string;
  result: boolean | "relayed";
}

interface Refusal {
  state: string;
  query: string;
}

/** One request to the relay route, and the listener's answer to the address it sent the browser to. */
interface RelayResult {
  status: number;
  location: string;
  cacheControl: string | null;
  referrerPolicy: string | null;
  listenerStatus: number | null;
}

interface Report {
  passed: boolean;
  failures: string[];
  page?: {
    origin: string;
    path: string;
    clientId: string | null;
    redirectUri: string | null;
    responseType: string | null;
    codeChallengeMethod: string | null;
    hasState: boolean;
    scope: string | null;
  };
  store?: { client: McpOAuthRecord["client"] | null; issuer: string | null };
  grant?: RelayResult & { delivered: Delivery[] };
  refusal?: RelayResult & { refused: Refusal[] };
  /** The sign-in of a server that names Meta's issuer and is not Meta's: the pages it opened. */
  impostor?: { pages: { origin: string; clientId: string | null }[]; error: string | null };
  listenerPort?: number;
}

const report: Report = { failures: [], passed: false };
const check = (condition: boolean, text: string) => {
  if (!condition) report.failures.push(text);
};

const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      server.close(() => done(address.port));
    });
  });

/** Resolves once Vite prints the address it listens on, or rejects when the server exits first. */
function waitForSite(child: ChildProcess, address: string): Promise<void> {
  return new Promise((done, fail) => {
    let output = "";
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(address)) done();
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", () => fail(new Error("The site's development server stopped before it listened.")));
  });
}

mkdirSync(OUT, { recursive: true });

// 1. The sign-in page, from Meta's own discovery documents --------------------------------------
const records = new Map<string, McpOAuthRecord>();
const pages: string[] = [];
let openPage: (url: string) => void = () => {};
const pageOpened = new Promise<string>((done) => {
  openPage = done;
});
const oauth = new McpOAuth({
  storage: {
    read: (resource) => records.get(resource) ?? null,
    write: (resource, record) =>
      Effect.sync(() => void records.set(resource, mcpOAuthRecordSchema.parse(JSON.parse(JSON.stringify(record))))),
    clear: (resource) => Effect.sync(() => void records.delete(resource)),
  },
  openExternal: async (url) => {
    pages.push(url);
    openPage(url);
  },
  redirectUrl: LOOPBACK_REDIRECT_URL,
  signInTimeoutMs: 60_000,
});

const port = await freePort();
const site = spawn(
  process.execPath,
  [resolve(ROOT, "scripts/run-development.ts"), "api", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
);
let siteOutput = "";
site.stdout?.on("data", (chunk: Buffer) => {
  siteOutput += chunk.toString();
});
site.stderr?.on("data", (chunk: Buffer) => {
  siteOutput += chunk.toString();
});
const origin = `http://127.0.0.1:${port}`;

const delivered: Delivery[] = [];
const refused: Refusal[] = [];
const listener = await startMcpOAuthRedirectServer({
  language: { locale: "en", translate: translateFor("en") },
  preferredPort: MCP_OAUTH_REDIRECT_PORT,
  deliver: (state, code) => {
    const result = oauth.receiveAuthorizationCode(state, code);
    delivered.push({ state, code, result });
    return result;
  },
  relayRefusal: (state, query) => {
    refused.push({ state, query });
  },
});

try {
  const signIn = oauth.signIn(META_ADS_MCP_URL);
  assert.ok(signIn, "McpOAuth takes the Meta Ads MCP address");
  const opened = await runCauseEffect(signIn.begin());
  check(opened, "the sign-in did not open an authorization page");
  const page = new URL(await pageOpened);
  const state = page.searchParams.get("state") ?? "";
  const record = records.get(META_ADS_MCP_URL);
  report.page = {
    origin: page.origin,
    path: page.pathname,
    clientId: page.searchParams.get("client_id"),
    redirectUri: page.searchParams.get("redirect_uri"),
    responseType: page.searchParams.get("response_type"),
    codeChallengeMethod: page.searchParams.get("code_challenge_method"),
    hasState: state.length > 0,
    scope: page.searchParams.get("scope"),
  };
  report.store = { client: record?.client ?? null, issuer: record?.discovery?.authorizationServerUrl ?? null };
  check(page.origin === "https://www.facebook.com", `the page is on ${page.origin}`);
  check(page.searchParams.get("client_id") === META_APP_ID, "the page does not name the OpenBot Meta app");
  check(page.searchParams.get("redirect_uri") === MCP_OAUTH_RELAY_URL, "the page does not name the relay address");
  check(page.searchParams.get("code_challenge_method") === "S256", "the page has no S256 code challenge");
  check(state.length > 0, "the page has no state");
  check(record?.client === undefined, "the store keeps a registration for Meta");
  check(record?.discovery?.authorizationServerUrl === "https://www.facebook.com/ads", "the issuer is not stored");

  // 2. The relay route, and the listener behind it -----------------------------------------------
  await waitForSite(site, origin);
  const relay = async (query: string): Promise<RelayResult> => {
    const response = await fetch(`${origin}/oauth/mcp-callback?${query}`, { redirect: "manual" });
    const location = response.headers.get("location") ?? "";
    const target = URL.parse(location);
    // The OpenBot app on this computer can hold the preferred port; the test listener then has another.
    if (target) target.port = String(new URL(listener.redirectUrl).port);
    const answer = target ? await fetch(target, { redirect: "manual" }) : null;
    return {
      status: response.status,
      location,
      cacheControl: response.headers.get("cache-control"),
      referrerPolicy: response.headers.get("referrer-policy"),
      listenerStatus: answer?.status ?? null,
    };
  };

  const grantQuery = `code=e2e-grant&state=${encodeURIComponent(state)}`;
  const grant = await relay(grantQuery);
  report.grant = { ...grant, delivered };
  check(grant.status === 302, `the relay answered ${grant.status}`);
  check(grant.location === `${LOOPBACK_REDIRECT_URL}?${grantQuery}`, `the relay sent the browser to ${grant.location}`);
  check(grant.cacheControl === "no-store", `the relay answer has Cache-Control ${grant.cacheControl}`);
  check(grant.referrerPolicy === "no-referrer", `the relay answer has Referrer-Policy ${grant.referrerPolicy}`);
  check(grant.listenerStatus === 200, `the listener answered ${grant.listenerStatus}`);
  check(
    delivered.length === 1 && delivered[0]?.state === state && delivered[0].code === "e2e-grant",
    "the listener did not hand the grant on",
  );
  check(delivered[0]?.result === true, "no sign-in waited for the relayed state");

  const refusalQuery = "error=access_denied&error_reason=user_denied&state=e2e-refused";
  const refusal = await relay(refusalQuery);
  report.refusal = { ...refusal, refused };
  check(
    refusal.location === `${LOOPBACK_REDIRECT_URL}?${refusalQuery}`,
    `the relay sent a refusal to ${refusal.location}`,
  );
  check(refusal.listenerStatus === 400, `the listener answered a refusal with ${refusal.listenerStatus}`);
  check(refused.length === 1 && refused[0]?.state === "e2e-refused", "the listener did not see the refusal");

  // The grant above is not real, so the token exchange is not run.
  oauth.cancelSignIn(META_ADS_MCP_URL);

  // 3. A server that is not Meta's names Meta's issuer ----------------------------------------------
  const impostorPort = await freePort();
  const impostorUrl = `http://127.0.0.1:${impostorPort}/ads`;
  const impostor = createHttpServer((request, response) => {
    if (request.url?.startsWith("/.well-known/oauth-protected-resource")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ resource: impostorUrl, authorization_servers: ["https://www.facebook.com/ads"] }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((done) => impostor.listen(impostorPort, "127.0.0.1", done));
  const before = pages.length;
  let impostorError: string | null = null;
  try {
    const impostorSignIn = oauth.signIn(impostorUrl);
    assert.ok(impostorSignIn, "McpOAuth takes a loopback MCP address");
    await runCauseEffect(impostorSignIn.begin());
  } catch (error) {
    impostorError = error instanceof Error ? error.message : String(error);
  } finally {
    oauth.cancelSignIn(impostorUrl);
    await new Promise<void>((done) => impostor.close(() => done()));
  }
  const impostorPages = pages.slice(before).map((url) => {
    const opened = new URL(url);
    return { origin: opened.origin, clientId: opened.searchParams.get("client_id") };
  });
  report.impostor = { pages: impostorPages, error: impostorError };
  check(
    impostorPages.every((opened) => opened.clientId !== META_APP_ID),
    "a server that is not Meta's got the OpenBot Meta app",
  );
} catch (error) {
  report.failures.push(error instanceof Error ? error.message : String(error));
  writeFileSync(resolve(OUT, "site-output.log"), siteOutput);
} finally {
  await listener.close();
  await runCauseEffect(oauth.close());
  const exited = new Promise<void>((done) => (site.exitCode === null ? site.once("exit", () => done()) : done()));
  site.kill("SIGTERM");
  await exited;
}

report.listenerPort = Number(new URL(listener.redirectUrl).port);
report.passed = report.failures.length === 0;
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
