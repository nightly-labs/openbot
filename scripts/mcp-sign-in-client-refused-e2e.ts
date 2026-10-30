// Drives the MCP probe and McpOAuth against a local MCP server for issue #3429.
// bun scripts/mcp-sign-in-client-refused-e2e.ts
// The authorization server acts as Railway's does: registration gives a client secret, and the token
// endpoint refuses every request that carries that secret. A public client (`none`) is accepted.
// A server that lists `none` must get a public registration and a working sign-in. A server that
// does not list it gets a secret client, and the refusal must say that the server did not accept
// OpenBot, not the SDK's "Existing OAuth client information is required" text.
// Make lists only `client_secret_post` and refuses a registration that names no method it lists.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpOAuth, type McpOAuthRecord } from "../src/backend/mcp-oauth-provider";
import { testMcpServer } from "../src/backend/mcp-probe";

const out = resolve(import.meta.dirname, "../.openbot-build/mcp-sign-in-client-refused-e2e");
const ACCESS_TOKEN = "e2e-access-token";
const CLIENT_SECRET = "e2e-client-secret";

const registrationRequest = z.object({
  token_endpoint_auth_method: z.string().optional(),
  redirect_uris: z.array(z.string()),
});
const rpcRequest = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string() });

interface FakeServer {
  url: string;
  /** The `token_endpoint_auth_method` each registration asked for, in order. */
  registrations: (string | null)[];
  /** Whether each token request carried the client secret, in order. */
  tokenRequestsWithSecret: boolean[];
  /** One entry for each `tools/list` that carried the token. */
  toolLists: boolean[];
  close: () => Promise<void>;
}

interface Case {
  name: string;
  attempts: { toolCount: number; error: string | null }[];
  registrations: (string | null)[];
  tokenRequestsWithSecret: boolean[];
  toolLists: boolean[];
  storedClient: boolean;
  signedIn: boolean;
  failures: string[];
}

const report: { passed: boolean; cases: Case[]; failures: string[] } = { passed: false, cases: [], failures: [] };

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

/**
 * `secretAccepted` is Make: the token endpoint takes the secret in the body. Without it, the server
 * is Railway and refuses every secret it issued.
 */
async function fakeServer(authMethods: string[], secretAccepted: boolean): Promise<FakeServer> {
  const state: Omit<FakeServer, "url" | "close"> = { registrations: [], tokenRequestsWithSecret: [], toolLists: [] };
  let base = "";
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", base).pathname;
      if (request.method === "GET" && path === "/.well-known/oauth-protected-resource/mcp")
        return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
      if (request.method === "GET" && path === "/.well-known/oauth-authorization-server")
        return json(response, 200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: authMethods,
        });
      if (request.method === "POST" && path === "/register") {
        const asked = registrationRequest.parse(JSON.parse(await body(request)));
        state.registrations.push(asked.token_endpoint_auth_method ?? null);
        const id = `e2e-client-${state.registrations.length}`;
        // RFC 7591: a registration that names no method asks for `client_secret_basic`.
        const method = asked.token_endpoint_auth_method ?? "client_secret_basic";
        if (!authMethods.includes(method))
          return json(response, 400, {
            code: "SC400",
            name: "APIError",
            message: "No supported Token Endpoint Auth Method provided.",
          });
        return json(response, 201, {
          client_id: id,
          ...(method === "none" ? {} : { client_secret: CLIENT_SECRET }),
          token_endpoint_auth_method: method,
          redirect_uris: asked.redirect_uris,
        });
      }
      if (request.method === "POST" && path === "/token") {
        const form = new URLSearchParams(await body(request));
        const withSecret = request.headers.authorization !== undefined || form.has("client_secret");
        state.tokenRequestsWithSecret.push(withSecret);
        const secretInBody = request.headers.authorization === undefined && form.get("client_secret") === CLIENT_SECRET;
        // Railway: the secret it issued is refused. Make: the secret must come in the body.
        if (secretAccepted ? !secretInBody : withSecret)
          return json(response, 401, { error: "invalid_client", error_description: "client authentication failed" });
        if (form.get("code") !== "e2e-grant") return json(response, 400, { error: "invalid_grant" });
        return json(response, 200, { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600 });
      }
      if (path !== "/mcp") return json(response, 404, { error: "not found" });
      if (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`)
        return json(
          response,
          401,
          { error: "unauthorized" },
          { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` },
        );
      const message = rpcRequest.parse(JSON.parse(await body(request)));
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
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "client-refused", version: "1" },
          },
        });
      if (message.method === "tools/list") {
        state.toolLists.push(true);
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [{ name: "list_projects", description: "list", inputSchema: { type: "object" } }] },
        });
      }
      return json(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown" } });
    })().catch((error: unknown) => {
      response.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "the server listens on a TCP port");
  base = `http://127.0.0.1:${address.port}`;
  return {
    url: `${base}/mcp`,
    ...state,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function httpConfig(url: string): McpServerConfig {
  return {
    id: "client-refused",
    name: "client_refused",
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

/**
 * Signs in `attempts` times in a row against one server and one store. With `storedDiscovery`, the
 * store starts with only the discovery state, as an earlier sign-in that ended before the token
 * leaves it: the SDK reads that state and no server metadata.
 */
async function runCase(
  name: string,
  authMethods: string[],
  attempts: number,
  { storedDiscovery = false, secretAccepted = false } = {},
): Promise<Case> {
  const server = await fakeServer(authMethods, secretAccepted);
  const records = new Map<string, McpOAuthRecord>();
  if (storedDiscovery)
    records.set(server.url, {
      discovery: {
        authorizationServerUrl: new URL(server.url).origin,
        resourceMetadataUrl: `${new URL(server.url).origin}/.well-known/oauth-protected-resource/mcp`,
      },
    });
  const oauth: McpOAuth = new McpOAuth({
    storage: {
      read: (resource) => records.get(resource) ?? null,
      write: (resource, record) => Effect.sync(() => void records.set(resource, record)),
      clear: (resource) => Effect.sync(() => void records.delete(resource)),
    },
    // The browser: the authorization server sends the grant straight back.
    openExternal: async (page) => {
      const state = new URL(page).searchParams.get("state");
      assert.ok(state, "the page has a state");
      setTimeout(() => oauth.receiveAuthorizationCode(state, "e2e-grant"), 50);
    },
    redirectUrl: "http://127.0.0.1:28417/mcp-auth",
    signInTimeoutMs: 10_000,
  });
  try {
    const authority = {
      accessToken: (url: string) => oauth.accessToken(url),
      signIn: (url: string) => oauth.signIn(url),
    };
    const results: Case["attempts"] = [];
    for (let attempt = 0; attempt < attempts; attempt++)
      results.push(await runCauseEffect(testMcpServer(httpConfig(server.url), 10_000, undefined, authority, "here")));
    return {
      name,
      attempts: results,
      registrations: [...server.registrations],
      tokenRequestsWithSecret: [...server.tokenRequestsWithSecret],
      toolLists: [...server.toolLists],
      storedClient: records.get(server.url)?.client !== undefined,
      signedIn: oauth.signedIn(server.url),
      failures: [],
    };
  } finally {
    await runCauseEffect(oauth.close());
    await server.close();
  }
}

function check(entry: Case, condition: boolean, text: string): void {
  if (!condition) entry.failures.push(text);
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  try {
    // Railway's metadata lists `none`: OpenBot registers a public client and the sign-in works.
    const listed = await runCase("public-client-when-listed", ["client_secret_basic", "client_secret_post", "none"], 1);
    const [first] = listed.attempts;
    check(listed, first?.error === null, `the sign-in failed: ${first?.error}`);
    check(listed, first?.toolCount === 1, "the tools were not listed after the sign-in");
    check(listed, listed.registrations.join() === "none", `the registration asked for ${listed.registrations.join()}`);
    check(listed, listed.tokenRequestsWithSecret.join() === "false", "a token request carried a client secret");
    check(listed, listed.signedIn, "no token is stored after the sign-in");
    report.cases.push(listed);

    // The same server, with a discovery state already on file: the registration is still public.
    const cached = await runCase("public-client-with-stored-discovery", ["client_secret_basic", "none"], 1, {
      storedDiscovery: true,
    });
    check(cached, cached.attempts[0]?.error === null, `the sign-in failed: ${cached.attempts[0]?.error}`);
    check(cached, cached.registrations.join() === "none", `the registration asked for ${cached.registrations.join()}`);
    check(cached, cached.tokenRequestsWithSecret.join() === "false", "a token request carried a client secret");
    check(cached, cached.signedIn, "no token is stored after the sign-in");
    report.cases.push(cached);

    // A server that does not list `none` chooses the method. Its refusal of the secret is reported
    // as a refusal, and the next sign-in registers again instead of reusing the refused client.
    const unlisted = await runCase("secret-client-refused", ["client_secret_basic"], 2);
    const refused = sourceText("error.backend.mcpSignInClientRefused");
    for (const [index, attempt] of unlisted.attempts.entries()) {
      check(unlisted, attempt.error === refused, `attempt ${index + 1} reported: ${attempt.error}`);
      check(unlisted, !attempt.error?.includes(CLIENT_SECRET), `attempt ${index + 1} quoted the client secret`);
    }
    check(unlisted, unlisted.registrations.join() === ",", `the registrations were ${unlisted.registrations.join()}`);
    check(unlisted, !unlisted.storedClient, "the refused client is still stored");
    check(unlisted, !unlisted.signedIn, "a token is stored after a refused sign-in");
    report.cases.push(unlisted);

    // Make lists only `client_secret_post`. A registration that names no method asks for
    // `client_secret_basic`, and Make answers 400, so OpenBot must ask for `client_secret_post`.
    const make = await runCase("secret-post-only", ["client_secret_post"], 1, { secretAccepted: true });
    check(make, make.attempts[0]?.error === null, `the sign-in failed: ${make.attempts[0]?.error}`);
    check(make, make.attempts[0]?.toolCount === 1, "the tools were not listed after the sign-in");
    check(
      make,
      make.registrations.join() === "client_secret_post",
      `the registration asked for ${make.registrations.join()}`,
    );
    check(make, make.tokenRequestsWithSecret.join() === "true", "the token request did not carry the client secret");
    check(make, make.signedIn, "no token is stored after the sign-in");
    report.cases.push(make);

    // The same server, with a discovery state already on file: the registration still names the method.
    const makeCached = await runCase("secret-post-only-with-stored-discovery", ["client_secret_post"], 1, {
      storedDiscovery: true,
      secretAccepted: true,
    });
    check(makeCached, makeCached.attempts[0]?.error === null, `the sign-in failed: ${makeCached.attempts[0]?.error}`);
    check(
      makeCached,
      makeCached.registrations.join() === "client_secret_post",
      `the registration asked for ${makeCached.registrations.join()}`,
    );
    check(makeCached, makeCached.signedIn, "no token is stored after the sign-in");
    report.cases.push(makeCached);
  } catch (error) {
    report.failures.push(error instanceof Error ? error.message : String(error));
  }
  report.passed = report.failures.length === 0 && report.cases.every((entry) => entry.failures.length === 0);
  await writeFile(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

await main();
