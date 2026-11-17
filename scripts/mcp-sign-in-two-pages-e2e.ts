import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { McpServerConfig, McpTestResult, TestMcpServerInput } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { Effect, Fiber } from "effect";
import { AgentLifecycleFailed } from "../src/backend/agent-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpOAuth, type McpOAuthRecord } from "../src/backend/mcp-oauth-provider";
import { testMcpServer } from "../src/backend/mcp-probe";
import { McpHostSignIns } from "../src/main/mcp-host-sign-ins";
import { SignInRelayClient, type SignInRelayRemote } from "../src/main/sign-in-relay-client";
import { SignInRelayHost } from "../src/main/sign-in-relay-host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-sign-in-two-pages-e2e");
const MEMBER = "member-1";
const TOOLS = ["search_profiles", "read_posts"];
const CANCELLED = "The sign-in was cancelled.";

interface Registration {
  clientId: string;
  redirectUris: string[];
}

interface FakeServer {
  url: string;
  registrations: Registration[];
  tokenClients: Map<string, string>;
  approve: (page: string) => { code: string; state: string; redirectUri: string };
  refusals: string[];
  close: () => Promise<void>;
}

interface Page {
  url: string;
  clientId: string;
  redirectUri: string;
  state: string;
}

interface CaseResult {
  name: string;
  pages: Array<Omit<Page, "state">>;
  results: McpTestResult[];
  signedIn: boolean;
  storedClient: string | null;
  tokenClient: string | null;
  refreshed: boolean;
  refusals: string[];
  failures: string[];
}

const report: { passed: boolean; cases: CaseResult[]; failures: string[] } = {
  passed: false,
  cases: [],
  failures: [],
};

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

function portOf(server: Server): number {
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "the server listens on a TCP port");
  return address.port;
}

function redirectUris(value: unknown): string[] {
  assert.ok(
    typeof value === "object" && value !== null && "redirect_uris" in value,
    "the registration names its addresses",
  );
  const uris = value.redirect_uris;
  assert.ok(Array.isArray(uris) && uris.every((uri) => typeof uri === "string"), "the addresses are strings");
  return uris;
}

function rpcMessage(value: unknown): { id?: number | string; method: string } {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "the request is a JSON object");
  const id = "id" in value ? value.id : undefined;
  const method = "method" in value ? value.method : undefined;
  assert.ok(typeof method === "string", "the request has a method");
  assert.ok(id === undefined || typeof id === "number" || typeof id === "string", "the request id is valid");
  return id === undefined ? { method } : { id, method };
}

function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function fakeServer(): Promise<FakeServer> {
  let base = "";
  const registrations: Registration[] = [];
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string }>();
  const accessTokens = new Map<string, string>();
  const refreshTokens = new Map<string, string>();
  const refusals: string[] = [];
  const issue = (clientId: string) => {
    const access = `access-${randomUUID()}`;
    const refresh = `refresh-${randomUUID()}`;
    accessTokens.set(access, clientId);
    refreshTokens.set(refresh, clientId);
    return { access_token: access, refresh_token: refresh, token_type: "bearer", expires_in: 3600 };
  };
  const refuse = (response: ServerResponse, reason: string) => {
    refusals.push(reason);
    json(response, 400, { error: "invalid_grant", error_description: reason });
  };
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", base).pathname;
      if (path === "/.well-known/oauth-protected-resource/mcp")
        return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [`${base}/`] });
      if (path === "/.well-known/oauth-authorization-server")
        return json(response, 200, {
          issuer: `${base}/`,
          authorization_endpoint: "https://auth.example/authorize",
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        });
      if (path.startsWith("/.well-known/")) return json(response, 404, { error: "not found" });
      if (path === "/register" && request.method === "POST") {
        const registration = {
          clientId: `client-${registrations.length + 1}`,
          redirectUris: redirectUris(JSON.parse(await body(request))),
        };
        registrations.push(registration);
        return json(response, 201, {
          redirect_uris: registration.redirectUris,
          token_endpoint_auth_method: "none",
          client_id: registration.clientId,
          client_id_issued_at: 1,
        });
      }
      if (path === "/token" && request.method === "POST") {
        const form = new URLSearchParams(await body(request));
        const clientId = form.get("client_id") ?? "";
        if (form.get("grant_type") === "refresh_token") {
          const owner = refreshTokens.get(form.get("refresh_token") ?? "");
          if (owner !== clientId) return refuse(response, `refresh by ${clientId} for a token of ${owner}`);
          return json(response, 200, issue(clientId));
        }
        const code = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        if (!code) return refuse(response, "unknown or spent code");
        if (code.clientId !== clientId) return refuse(response, `code of ${code.clientId} sent by ${clientId}`);
        if (code.redirectUri !== form.get("redirect_uri"))
          return refuse(response, `code for ${code.redirectUri} sent with ${form.get("redirect_uri")}`);
        if (challengeOf(form.get("code_verifier") ?? "") !== code.challenge) return refuse(response, "PKCE mismatch");
        return json(response, 200, issue(clientId));
      }
      if (path !== "/mcp") return json(response, 404, { error: "not found" });
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const message = rpcMessage(JSON.parse(await body(request)));
      const token = (request.headers.authorization ?? "").replace(/^Bearer /i, "");
      if (!accessTokens.has(token))
        return json(
          response,
          401,
          { jsonrpc: "2.0", error: { code: -32600, message: "Authorization required" }, id: null },
          { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` },
        );
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "initialize")
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "two-pages", version: "1" },
          },
        });
      if (message.method === "tools/list")
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: TOOLS.map((name) => ({ name, inputSchema: { type: "object", properties: {} } })) },
        });
      return json(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown" } });
    })().catch((error: unknown) => {
      response.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${portOf(server)}`;
  return {
    url: `${base}/mcp`,
    registrations,
    tokenClients: accessTokens,
    approve: (page) => {
      const url = new URL(page);
      const clientId = url.searchParams.get("client_id") ?? "";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      const code = `code-${randomUUID()}`;
      codes.set(code, { clientId, redirectUri, challenge: url.searchParams.get("code_challenge") ?? "" });
      return { code, state: url.searchParams.get("state") ?? "", redirectUri };
    },
    refusals,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function httpConfig(url: string): McpServerConfig {
  return {
    id: "two-pages",
    name: "two_pages",
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

function fakeBrowser() {
  const pages: Page[] = [];
  const waiters: Array<{ count: number; done: () => void }> = [];
  return {
    pages,
    open: async (page: string) => {
      const url = new URL(page);
      pages.push({
        url: page,
        clientId: url.searchParams.get("client_id") ?? "",
        redirectUri: url.searchParams.get("redirect_uri") ?? "",
        state: url.searchParams.get("state") ?? "",
      });
      for (const waiter of waiters.filter((entry) => pages.length >= entry.count)) waiter.done();
    },
    opened: (count: number, press: Fiber.Fiber<McpTestResult, unknown>) =>
      Promise.race([
        new Promise<void>((done) => {
          if (pages.length >= count) done();
          else waiters.push({ count, done });
        }),
        Effect.runPromise(Fiber.join(press)).then((result) => {
          if (pages.length < count)
            throw new Error(`a sign-in ended before its page opened: ${JSON.stringify(result)}`);
        }),
      ]),
  };
}

function newOAuth(server: FakeServer, browser: ReturnType<typeof fakeBrowser>, redirectUrl: string) {
  const records = new Map<string, McpOAuthRecord>();
  const oauth = new McpOAuth({
    storage: {
      read: (key) => records.get(key) ?? null,
      write: (key, record) => Effect.sync(() => void records.set(key, record)),
      clear: (key) => Effect.sync(() => void records.delete(key)),
    },
    openExternal: browser.open,
    redirectUrl,
    signInTimeoutMs: 20_000,
  });
  return { oauth, records, url: server.url };
}

async function finalState(server: FakeServer, setup: ReturnType<typeof newOAuth>) {
  const record = setup.records.get(server.url);
  const access = record?.tokens?.access_token ?? null;
  const refreshed = access
    ? (await runCauseEffect(setup.oauth.refreshAccessToken(server.url, access))) !== null
    : false;
  return {
    signedIn: setup.oauth.signedIn(server.url),
    storedClient: record?.client?.client_id ?? null,
    tokenClient: access ? (server.tokenClients.get(access) ?? null) : null,
    refreshed,
  };
}

function check(entry: CaseResult, condition: boolean, text: string): void {
  if (!condition) entry.failures.push(text);
}

async function localCase(name: string, finish: 0 | 1 | "cancel"): Promise<CaseResult> {
  const server = await fakeServer();
  const browser = fakeBrowser();
  const setup = newOAuth(server, browser, "http://127.0.0.1:28417/mcp-auth");
  const authority = {
    accessToken: (url: string) => setup.oauth.accessToken(url),
    signIn: (url: string) => setup.oauth.signIn(url),
  };
  const press = () => Effect.runFork(testMcpServer(httpConfig(server.url), 20_000, undefined, authority, "here"));
  try {
    const first = press();
    await browser.opened(1, first);
    const second = press();
    await browser.opened(2, second);
    if (finish === "cancel") setup.oauth.cancelSignIn(server.url);
    else {
      const page = browser.pages[finish];
      assert.ok(page, "the page opened");
      const approved = server.approve(page.url);
      assert.ok(setup.oauth.receiveAuthorizationCode(approved.state, approved.code), "a sign-in waited for the page");
    }
    const results = [await Effect.runPromise(Fiber.join(first)), await Effect.runPromise(Fiber.join(second))];
    const state = await finalState(server, setup);
    return {
      name,
      pages: browser.pages.map(({ url, clientId, redirectUri }) => ({ url, clientId, redirectUri })),
      results,
      ...state,
      refusals: [...server.refusals],
      failures: [],
    };
  } finally {
    await runCauseEffect(setup.oauth.close());
    await server.close();
  }
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const port = portOf(probe);
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

async function joinedCase(name: string, finish: 0 | 1): Promise<CaseResult> {
  const server = await fakeServer();
  const browser = fakeBrowser();
  const hostPort = await freePort();
  const setup = newOAuth(server, browser, `http://127.0.0.1:${hostPort}/mcp-auth`);
  const unused = () => Effect.die(new Error("This case does not use it."));
  const signIns = new McpHostSignIns({
    service: {
      signInMcpServer: (input, open, deepLinkRedirectUrl) =>
        testMcpServer(
          input.config,
          20_000,
          undefined,
          {
            accessToken: (url) => setup.oauth.accessToken(url),
            signIn: (url) => setup.oauth.signIn(url, open, deepLinkRedirectUrl),
          },
          "here",
        ).pipe(Effect.mapError((cause) => new AgentLifecycleFailed({ operation: "signInMcpServer", cause }))),
      cancelMcpSignIn: (input) => void setup.oauth.cancelSignIn(input.url),
      signOutMcpServer: unused,
      listMcpSignIns: () => [],
      mcpSignInApp: () => {
        throw new Error("This case does not use it.");
      },
      saveMcpSignInApp: unused,
      removeMcpSignInApp: unused,
    },
    browser: { openPrivate: unused, privateTab: () => null, close: () => Effect.void },
  });
  const host = new SignInRelayHost({
    mcp: signIns,
    providers: { startRelay: unused, relayStatus: () => ({ pageUrl: null, result: null }), cancel: unused },
    accounts: { startRelay: unused, relayStatus: () => ({ pageUrl: null, result: null }), cancelSignIn: unused },
    receiveMcpGrant: (state, code) => setup.oauth.receiveAuthorizationCode(state, code),
    receiveMcpRefusal: (state) => setup.oauth.refuseAuthorization(state),
    printedLink: () => false,
  });
  const client = new SignInRelayClient({
    openExternal: browser.open,
    language: { locale: "en", translate: translateFor("en") },
    ownListener: () => null,
    deepLinkRedirectUrl: () => undefined,
  });
  const input: TestMcpServerInput = { config: httpConfig(server.url) };
  const remote: SignInRelayRemote<unknown> = {
    start: host.startMcp(MEMBER, input),
    status: (flowId) => Effect.try(() => host.status(MEMBER, flowId)),
    complete: (flowId, query) => host.complete(MEMBER, flowId, query),
    cancel: (flowId) => host.cancel(MEMBER, flowId),
  };
  const key = `server-1\n${server.url}`;
  try {
    const first = Effect.runFork(client.run(key, remote));
    await browser.opened(1, first);
    const second = Effect.runFork(client.run(key, remote));
    await browser.opened(2, second);
    const page = browser.pages[finish];
    assert.ok(page, "the page opened");
    const approved = server.approve(page.url);
    const back = new URL(approved.redirectUri);
    const returned = await fetch(
      `http://127.0.0.1:${back.port}${back.pathname}?code=${approved.code}&state=${approved.state}`,
    );
    const text = (await returned.text())
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const results = [await Effect.runPromise(Fiber.join(first)), await Effect.runPromise(Fiber.join(second))];
    const state = await finalState(server, setup);
    const entry: CaseResult = {
      name,
      pages: browser.pages.map(({ url, clientId, redirectUri }) => ({ url, clientId, redirectUri })),
      results,
      ...state,
      refusals: [...server.refusals],
      failures: [],
    };
    check(entry, returned.status === 200, `the return page answered ${returned.status}: ${text}`);
    return entry;
  } finally {
    await runCauseEffect(signIns.close());
    await runCauseEffect(setup.oauth.close());
    await server.close();
  }
}

function checkSignedIn(entry: CaseResult, finished: 0 | 1): void {
  const page = entry.pages[finished];
  check(entry, entry.pages.length === 2, `${entry.pages.length} pages opened, not 2`);
  check(
    entry,
    entry.pages[0]?.redirectUri !== entry.pages[1]?.redirectUri,
    "the second page did not use the next return address",
  );
  for (const [index, result] of entry.results.entries())
    check(
      entry,
      result.error === null && result.toolCount === TOOLS.length,
      `press ${index + 1} ended with ${JSON.stringify(result)}`,
    );
  check(entry, entry.signedIn, "the sign-in was not saved");
  check(
    entry,
    entry.tokenClient === page?.clientId,
    `the token belongs to ${entry.tokenClient}, not to the finished page`,
  );
  check(
    entry,
    entry.storedClient === entry.tokenClient,
    `the store holds ${entry.storedClient} with a token of ${entry.tokenClient}`,
  );
  check(entry, entry.refreshed, "a refresh with the saved sign-in failed");
  check(entry, entry.refusals.length === 0, `the server refused: ${entry.refusals.join("; ")}`);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  try {
    for (const finish of [0, 1] as const) {
      const entry = await localCase(`this computer: finish page ${finish + 1}`, finish);
      checkSignedIn(entry, finish);
      report.cases.push(entry);
    }
    const cancelled = await localCase("this computer: Cancel ends both pages", "cancel");
    for (const [index, result] of cancelled.results.entries())
      check(cancelled, result.error === CANCELLED, `press ${index + 1} ended with ${JSON.stringify(result)}`);
    check(cancelled, !cancelled.signedIn, "a cancelled sign-in was saved");
    report.cases.push(cancelled);
    for (const finish of [0, 1] as const) {
      const entry = await joinedCase(`joined server: finish page ${finish + 1}`, finish);
      checkSignedIn(entry, finish);
      report.cases.push(entry);
    }
  } catch (error) {
    report.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
  report.passed = report.failures.length === 0 && report.cases.every((entry) => entry.failures.length === 0);
  await writeFile(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const entry of report.cases)
    process.stdout.write(
      `${entry.failures.length === 0 ? "pass" : "FAIL"}  ${entry.name}\n${entry.failures.map((f) => `      ${f}\n`).join("")}`,
    );
  for (const failure of report.failures) process.stdout.write(`ERROR ${failure}\n`);
  if (!report.passed) process.exitCode = 1;
}

await main();
