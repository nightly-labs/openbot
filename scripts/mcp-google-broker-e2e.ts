// Drives a Google sign-in with the OpenBot Google sign-in app, end to end except Google's token
// endpoint and the user's consent. It starts the real Signal service (`remote/api`) with a throwaway
// client secret and a fake Google token endpoint, then signs `McpOAuth` in to Google's real Calendar
// MCP server: discovery and the authorization page are Google's own, the code is delivered by hand,
// and the token exchange and the refresh go through the host broker (`src/main/google-token-broker.ts`)
// and Signal. It also checks that a sign-in app the user saved wins, and that a host with no ticket
// gets the account sentence. Needs the network and no Google account. Writes
// .openbot-build/mcp-google-broker-e2e/report.json and exits non-zero when a check fails.
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { REMOTE_TICKET_AUDIENCE, REMOTE_TICKET_PROTOCOL_VERSION } from "@openbot/contracts/signal-protocol/ticket";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { exportJWK, SignJWT } from "jose";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { GOOGLE_MCP_SCOPES } from "../src/backend/google-mcp-sign-in";
import { McpOAuth, type McpOAuthRecord } from "../src/backend/mcp-oauth-provider";
import { type GoogleHost, googleSignIn } from "../src/main/google-token-broker";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/mcp-google-broker-e2e");
const SERVER_URL = "https://calendarmcp.googleapis.com/mcp/v1";
const REDIRECT_URL = "http://127.0.0.1:28417/mcp-auth";
const CLIENT_ID = "123456789012-e2ebroker.apps.googleusercontent.com";
const CLIENT_SECRET = `GOCSPX-${randomBytes(18).toString("base64url")}`;
const CODE = `4/0e2e-${randomBytes(12).toString("base64url")}`;
const REFRESH_TOKEN = `1//e2e-${randomBytes(12).toString("base64url")}`;

interface Check {
  name: string;
  passed: boolean;
  evidence: string;
}
const checks: Check[] = [];

async function check(name: string, run: () => Promise<string>) {
  try {
    checks.push({ name, passed: true, evidence: await run() });
  } catch (error) {
    checks.push({ name, passed: false, evidence: error instanceof Error ? error.message : String(error) });
  }
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("No port.")),
      );
    });
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString()));
    request.on("error", reject);
  });
}

// Google's token endpoint, as far as Signal needs it. Each access token is new, so a refresh shows.
const googleCalls: Array<Record<string, string>> = [];
function startGoogle(port: number): Promise<Server> {
  const server = createServer(async (request, response) => {
    const form = Object.fromEntries(new URLSearchParams(await readBody(request)));
    googleCalls.push(form);
    const answer = (status: number, value: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (form.client_id !== CLIENT_ID || form.client_secret !== CLIENT_SECRET)
      return answer(401, { error: "invalid_client" });
    const tokens = {
      access_token: `ya29.e2e-${randomBytes(12).toString("base64url")}`,
      expires_in: 3599,
      token_type: "Bearer",
      scope: GOOGLE_MCP_SCOPES[SERVER_URL],
    };
    if (form.grant_type === "authorization_code" && form.code === CODE)
      return answer(200, { ...tokens, refresh_token: REFRESH_TOKEN });
    if (form.grant_type === "refresh_token" && form.refresh_token === REFRESH_TOKEN) return answer(200, tokens);
    return answer(400, { error: "invalid_grant" });
  });
  return new Promise((resolveServer) => server.listen(port, "127.0.0.1", () => resolveServer(server)));
}

async function waitForReady(url: string, child: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Signal exited with code ${child.exitCode}.`);
    if (
      await fetch(url).then(
        (response) => response.ok,
        () => false,
      )
    )
      return;
    await new Promise((wake) => setTimeout(wake, 200));
  }
  throw new Error("Signal did not become ready.");
}

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = { ...(await exportJWK(publicKey)), kid: "e2e-1", alg: "ES256", use: "sig" };
async function hostTicket(): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    jti: randomUUID(),
    sessionId: `session-${randomUUID()}`,
    hostId: "host-google-e2e",
    userId: "owner-e2e",
    membershipId: "host-google-e2e:host",
    role: "host",
    authEpoch: 1,
    protocolMinimum: REMOTE_TICKET_PROTOCOL_VERSION,
    protocolMaximum: REMOTE_TICKET_PROTOCOL_VERSION,
    sessionExpiresAt: now + 86_400,
  })
    .setProtectedHeader({ alg: "ES256", kid: "e2e-1" })
    .setAudience(REMOTE_TICKET_AUDIENCE)
    .setIssuedAt(now - 5)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

function oauthWith(
  records: Map<string, McpOAuthRecord>,
  host: GoogleHost,
  opened: string[],
  clientId = CLIENT_ID,
): McpOAuth {
  const google = googleSignIn(host, { OPENBOT_GOOGLE_CLIENT_ID: clientId });
  if (!google) throw new Error("The test client ID was refused.");
  return new McpOAuth({
    storage: {
      read: (resource) => records.get(resource) ?? null,
      write: (resource, record) => Effect.sync(() => void records.set(resource, record)),
      clear: (resource) => Effect.sync(() => void records.delete(resource)),
    },
    openExternal: async (page) => void opened.push(page),
    redirectUrl: REDIRECT_URL,
    signInTimeoutMs: 5_000,
    refreshTimeoutMs: 20_000,
    googleSignIn: google,
  });
}

/** Opens Google's page for a sign-in, and answers the page's query. */
async function openPage(oauth: McpOAuth, opened: string[]) {
  const attempt = oauth.signIn(SERVER_URL);
  if (!attempt) throw new Error("No sign-in for the Calendar URL.");
  const pageOpened = await runCauseEffect(attempt.begin());
  const page = opened.at(-1);
  expect(pageOpened && page !== undefined, "No authorization page opened.");
  return { attempt, page: new URL(page) };
}

const [signalPort, healthPort, googlePort] = await Promise.all([freePort(), freePort(), freePort()]);
const google = await startGoogle(googlePort);
const serviceOutput: string[] = [];
const child = spawn("bun", [resolve(ROOT, "remote/api/src/index.ts")], {
  cwd: resolve(ROOT, "remote/api"),
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    REMOTE_SIGNAL_HOST: "127.0.0.1",
    REMOTE_SIGNAL_PORT: String(signalPort),
    REMOTE_HEALTH_PORT: String(healthPort),
    REMOTE_TLS_DISABLED: "true",
    REMOTE_TICKET_PUBLIC_KEYS: JSON.stringify({ keys: [publicJwk] }),
    // Signal does not call the account service for a token request.
    REMOTE_CONTROL_PLANE_URL: "http://127.0.0.1:9",
    REMOTE_SESSION_SECRET: randomBytes(32).toString("base64url"),
    REMOTE_AUTH_WEBHOOK_SECRET: randomBytes(32).toString("base64url"),
    TURN_SHARED_SECRET: randomBytes(32).toString("base64url"),
    TURN_HOST: "127.0.0.1",
    GOOGLE_OAUTH_CLIENTS: `${CLIENT_ID}:${CLIENT_SECRET}`,
    GOOGLE_OAUTH_TOKEN_URL: `http://127.0.0.1:${googlePort}/token`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout?.on("data", (chunk: Buffer) => serviceOutput.push(chunk.toString()));
child.stderr?.on("data", (chunk: Buffer) => serviceOutput.push(chunk.toString()));
const signalUrl = `ws://127.0.0.1:${signalPort}/v1/signal`;
const withTicket: GoogleHost = {
  available: () => true,
  ticket: async () => ({ ticket: await hostTicket(), signalUrl }),
};

try {
  await waitForReady(`http://127.0.0.1:${signalPort}/health/ready`, child);
  const records = new Map<string, McpOAuthRecord>();
  const opened: string[] = [];
  const oauth = oauthWith(records, withTicket, opened);
  let challenge = "";
  try {
    await check("A Google server with no sign-in app opens Google's page for the OpenBot app", async () => {
      const { attempt, page } = await openPage(oauth, opened);
      const query = Object.fromEntries(page.searchParams);
      challenge = query.code_challenge ?? "";
      expect(page.origin === "https://accounts.google.com", `page origin: ${page.origin}`);
      expect(query.client_id === CLIENT_ID, `client_id: ${query.client_id}`);
      expect(query.scope === GOOGLE_MCP_SCOPES[SERVER_URL], `scope: ${query.scope}`);
      expect(query.access_type === "offline" && query.prompt === "consent", "no refresh token asked");
      expect(query.redirect_uri === REDIRECT_URL, `redirect_uri: ${query.redirect_uri}`);
      expect(oauth.signInApp(SERVER_URL) === null, "The built-in app shows as a sign-in app of the user.");
      expect(records.get(SERVER_URL)?.tokens === undefined, "Tokens were written before the sign-in completed.");
      // The user approved: the code comes back to the loopback address.
      expect(oauth.receiveAuthorizationCode(query.state ?? "", CODE), "No sign-in waited for the state.");
      await runCauseEffect(attempt.complete());
      return `client_id, scope, offline and S256 on ${page.origin}`;
    });

    await check("The code exchange goes through Signal with the secret, and the tokens stay here", async () => {
      const call = googleCalls.find((entry) => entry.grant_type === "authorization_code");
      expect(call !== undefined, "Google got no code exchange.");
      expect(call.client_secret === CLIENT_SECRET, "Google did not get the secret.");
      expect(call.redirect_uri === REDIRECT_URL, `redirect_uri: ${call.redirect_uri}`);
      const verifier = call.code_verifier ?? "";
      expect(createHash("sha256").update(verifier).digest("base64url") === challenge, "The verifier does not match.");
      expect(oauth.signedIn(SERVER_URL), "The host is not signed in.");
      const stored = records.get(SERVER_URL);
      expect(stored?.tokens?.refresh_token === REFRESH_TOKEN, "No refresh token was stored.");
      expect(stored.app?.clientId === CLIENT_ID && stored.app.clientSecret === undefined, "The stored app is wrong.");
      return "Google got the secret from Signal; the host stored the tokens and the app with no secret";
    });

    await check("A refresh goes through Signal", async () => {
      const stored = records.get(SERVER_URL);
      expect(stored?.tokens !== undefined, "No tokens.");
      const before = stored.tokens.access_token;
      records.set(SERVER_URL, { ...stored, obtainedAt: Date.now() - 3_600_000 });
      const token = await runCauseEffect(oauth.accessToken(SERVER_URL));
      expect(token !== null && token !== before, "The token was not refreshed.");
      expect(
        googleCalls.some((entry) => entry.grant_type === "refresh_token"),
        "Google got no refresh.",
      );
      return "a new access token after a refresh_token request";
    });

    await check("Removing the sign-in app keeps a sign-in that uses the OpenBot app", async () => {
      const removed = await runCauseEffect(oauth.removeSignInApp(SERVER_URL));
      expect(!removed, "removeSignInApp removed the OpenBot app.");
      expect(oauth.signedIn(SERVER_URL), "The sign-in was dropped.");
      return "removeSignInApp answered false and the tokens stayed";
    });

    await check("No Signal log line holds the secret, the code or a token", async () => {
      const tokens = records.get(SERVER_URL)?.tokens;
      const values = [CLIENT_SECRET, CODE, REFRESH_TOKEN, tokens?.access_token ?? CODE];
      const leaked = serviceOutput.filter((line) => values.some((value) => line.includes(value)));
      expect(leaked.length === 0, `${leaked.length} log chunks hold a value.`);
      return `${serviceOutput.length} log chunks checked`;
    });
  } finally {
    await runCauseEffect(oauth.close());
  }

  await check("An older scope on file for the OpenBot app is replaced with the current scope", async () => {
    const older = new Map<string, McpOAuthRecord>([
      [SERVER_URL, { app: { clientId: CLIENT_ID, scope: "https://www.googleapis.com/auth/calendar.events.readonly" } }],
    ]);
    const pages: string[] = [];
    const oauth = oauthWith(older, withTicket, pages);
    try {
      const { attempt, page } = await openPage(oauth, pages);
      attempt.abandon();
      const scope = page.searchParams.get("scope");
      expect(scope === GOOGLE_MCP_SCOPES[SERVER_URL], `scope: ${scope}`);
      expect(scope.split(" ").includes("https://www.googleapis.com/auth/calendar.events"), "No write scope.");
      return `the page asks for ${scope}`;
    } finally {
      await runCauseEffect(oauth.close());
    }
  });

  await check("An OpenBot app of an earlier client on file gets the current client", async () => {
    const stale = new Map<string, McpOAuthRecord>([
      [SERVER_URL, { app: { clientId: "111111111111-earlier.apps.googleusercontent.com", scope: "x" } }],
    ]);
    const pages: string[] = [];
    const oauth = oauthWith(stale, withTicket, pages);
    try {
      const { attempt, page } = await openPage(oauth, pages);
      attempt.abandon();
      expect(page.searchParams.get("client_id") === CLIENT_ID, `client_id: ${page.searchParams.get("client_id")}`);
      expect(oauth.signInApp(SERVER_URL) === null, "The earlier OpenBot app shows as a sign-in app of the user.");
      return "the page names the current client";
    } finally {
      await runCauseEffect(oauth.close());
    }
  });

  await check("A host with no OpenBot account does not get the OpenBot app", async () => {
    const pages: string[] = [];
    const oauth = oauthWith(new Map(), { available: () => false, ticket: async () => null }, pages);
    try {
      const attempt = oauth.signIn(SERVER_URL);
      expect(attempt !== null, "No sign-in.");
      await runCauseEffect(attempt.begin()).catch(() => false);
      attempt.abandon();
      const named = pages.some((page) => new URL(page).searchParams.get("client_id") === CLIENT_ID);
      expect(!named, "A page opened for the OpenBot app.");
      return `${pages.length} pages opened, none for the OpenBot app`;
    } finally {
      await runCauseEffect(oauth.close());
    }
  });

  await check("A Signal refusal gets the unavailable sentence", async () => {
    const pages: string[] = [];
    const calls = googleCalls.length;
    // Signal does not know this client, and refuses it with its own error.
    const unknown = oauthWith(new Map(), withTicket, pages, "222222222222-unknown.apps.googleusercontent.com");
    try {
      const { attempt, page } = await openPage(unknown, pages);
      expect(unknown.receiveAuthorizationCode(page.searchParams.get("state") ?? "", CODE), "No sign-in waited.");
      const failure = await runCauseEffect(attempt.complete()).then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      expect(failure?.includes(sourceText("error.backend.googleSignInUnavailable")) === true, `error: ${failure}`);
      expect(googleCalls.length === calls, "Google got a request.");
      return failure;
    } finally {
      await runCauseEffect(unknown.close());
    }
  });

  await check("A sign-in app that the user saved wins over the OpenBot app", async () => {
    const saved = new Map<string, McpOAuthRecord>([
      [SERVER_URL, { app: { clientId: "999999999999-own.apps.googleusercontent.com", clientSecret: "own-secret" } }],
    ]);
    const pages: string[] = [];
    const own = oauthWith(saved, withTicket, pages);
    try {
      const { attempt, page } = await openPage(own, pages);
      attempt.abandon();
      expect(page.searchParams.get("client_id") === "999999999999-own.apps.googleusercontent.com", "Wrong client.");
      expect(own.signInApp(SERVER_URL)?.clientId.startsWith("999999999999") === true, "The saved app is hidden.");
      return "the page names the saved client";
    } finally {
      await runCauseEffect(own.close());
    }
  });

  await check("A host with no ticket gets the account sentence", async () => {
    const pages: string[] = [];
    const calls = googleCalls.length;
    const none = oauthWith(new Map(), { available: () => true, ticket: async () => null }, pages);
    try {
      const { attempt, page } = await openPage(none, pages);
      expect(none.receiveAuthorizationCode(page.searchParams.get("state") ?? "", CODE), "No sign-in waited.");
      const failure = await runCauseEffect(attempt.complete()).then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      expect(failure?.includes(sourceText("error.backend.googleSignInNeedsAccount")) === true, `error: ${failure}`);
      expect(googleCalls.length === calls, "Google got a request.");
      return failure;
    } finally {
      await runCauseEffect(none.close());
    }
  });
} catch (error) {
  checks.push({
    name: "Signal starts",
    passed: false,
    evidence: error instanceof Error ? error.message : String(error),
  });
} finally {
  child.kill("SIGTERM");
  google.close();
}

mkdirSync(OUT, { recursive: true });
const failed = checks.filter((item) => !item.passed);
const report = { checks, passed: checks.length - failed.length, failed: failed.length };
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(failed.length === 0 ? 0 : 1);
