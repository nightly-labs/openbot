// Drives McpOAuth against a local MCP server for issue #9209.
// bun scripts/mcp-sign-in-relay-deep-link-e2e.ts
// TradingView's firewall blocks its sign-in page when the page returns to `127.0.0.1` or `localhost`.
// On a joined server, the sign-in page opens on the member's computer (`sign-in-relay-v1`). When that
// computer opens `openbot://mcp-auth` in OpenBot (`sign-in-relay-deep-link-v1`), the third relayed
// sign-in after two that got no grant back must register and send `openbot://mcp-auth`, and the token
// request must name it. A relayed sign-in from a client that cannot open the link keeps the two
// loopback names, as before.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpOAuth, type McpOAuthRecord } from "../src/backend/mcp-oauth-provider";
import { testMcpServer } from "../src/backend/mcp-probe";

const out = resolve(import.meta.dirname, "../.openbot-build/mcp-sign-in-relay-deep-link-e2e");
const ACCESS_TOKEN = "e2e-access-token";
const GRANT = "e2e-grant";
const HOST_REDIRECT = "http://127.0.0.1:28417/mcp-auth";
const DEEP_LINK = "openbot://mcp-auth";

const registrationRequest = z.object({ redirect_uris: z.array(z.string()) });
const rpcRequest = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string() });

interface Case {
  name: string;
  /** The `redirect_uri` of each registration, sign-in page and token request, in order. */
  redirects: string[];
  errors: (string | null)[];
  signedIn: boolean;
  failures: string[];
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(value));
}

/** An MCP server and its authorization server, which accepts each redirect address and records it. */
async function fakeServer(redirects: string[]) {
  let base = "";
  let clients = 0;
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
          token_endpoint_auth_methods_supported: ["none"],
        });
      if (request.method === "POST" && path === "/register") {
        const asked = registrationRequest.parse(JSON.parse(await body(request)));
        redirects.push(`register ${asked.redirect_uris.join(" ")}`);
        clients += 1;
        return json(response, 201, {
          client_id: `e2e-client-${clients}`,
          token_endpoint_auth_method: "none",
          redirect_uris: asked.redirect_uris,
        });
      }
      if (request.method === "POST" && path === "/token") {
        const form = new URLSearchParams(await body(request));
        redirects.push(`token ${form.get("redirect_uri")}`);
        if (form.get("code") !== GRANT) return json(response, 400, { error: "invalid_grant" });
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
            serverInfo: { name: "relay-deep-link", version: "1" },
          },
        });
      if (message.method === "tools/list")
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [{ name: "quote", description: "quote", inputSchema: { type: "object" } }] },
        });
      return json(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unknown" } });
    })().catch((error: unknown) => {
      response.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "the server listens on a TCP port");
  base = `http://127.0.0.1:${address.port}`;
  return { url: `${base}/mcp`, close: () => new Promise<void>((done) => server.close(() => done())) };
}

function httpConfig(url: string): McpServerConfig {
  return {
    id: "relay-deep-link",
    name: "relay_deep_link",
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
 * Three relayed sign-ins on a host whose own system does not open `openbot://`. In the first two the
 * firewall blocks the page, so no grant comes back and the member closes the dialog (a cancel). In the
 * third the grant comes back through `complete`, as `receiveMcpGrant` gives it.
 */
async function runCase(name: string, deepLinkRedirectUrl: string | undefined): Promise<Case> {
  const redirects: string[] = [];
  const server = await fakeServer(redirects);
  const records = new Map<string, McpOAuthRecord>();
  let attempt = 0;
  const oauth: McpOAuth = new McpOAuth({
    storage: {
      read: (resource) => records.get(resource) ?? null,
      write: (resource, record) => Effect.sync(() => void records.set(resource, record)),
      clear: (resource) => Effect.sync(() => void records.delete(resource)),
    },
    openExternal: async () => assert.fail("A relayed sign-in opened this computer's browser."),
    redirectUrl: HOST_REDIRECT,
    deepLinkRedirectUrl: () => undefined,
    signInTimeoutMs: 10_000,
  });
  // The relay: the page waits for the member's computer, which is this opener.
  const open = async (page: string) => {
    const url = new URL(page);
    redirects.push(`page ${url.searchParams.get("redirect_uri")}`);
    const state = url.searchParams.get("state");
    assert.ok(state, "the page has a state");
    setTimeout(() => {
      if (attempt < 3) oauth.cancelSignIn(server.url);
      else assert.ok(oauth.receiveAuthorizationCode(state, GRANT), "the grant found no sign-in");
    }, 50);
  };
  try {
    const authority = {
      accessToken: (url: string) => oauth.accessToken(url),
      signIn: (url: string) => oauth.signIn(url, open, deepLinkRedirectUrl),
    };
    const errors: (string | null)[] = [];
    for (attempt = 1; attempt <= 3; attempt++) {
      const result = await runCauseEffect(testMcpServer(httpConfig(server.url), 10_000, undefined, authority, "here"));
      errors.push(result.error);
    }
    return { name, redirects, errors, signedIn: oauth.signedIn(server.url), failures: [] };
  } finally {
    await runCauseEffect(oauth.close());
    await server.close();
  }
}

function check(entry: Case, condition: boolean, text: string): void {
  if (!condition) entry.failures.push(text);
}

function pages(entry: Case): string[] {
  return entry.redirects.filter((line) => line.startsWith("page ")).map((line) => line.slice("page ".length));
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  const localhost = HOST_REDIRECT.replace("127.0.0.1", "localhost");
  const cases: Case[] = [];

  const deepLinked = await runCase("relay-with-deep-link", DEEP_LINK);
  check(
    deepLinked,
    pages(deepLinked).join(" ") === [HOST_REDIRECT, localhost, DEEP_LINK].join(" "),
    `the pages returned to ${pages(deepLinked).join(", ")}`,
  );
  check(deepLinked, deepLinked.redirects.includes(`register ${DEEP_LINK}`), "the deep link was not registered");
  check(deepLinked, deepLinked.redirects.at(-1) === `token ${DEEP_LINK}`, "the token request did not name the link");
  check(deepLinked, deepLinked.errors[2] === null, `the third sign-in failed: ${deepLinked.errors[2]}`);
  check(deepLinked, deepLinked.signedIn, "no token is stored after the sign-in");
  cases.push(deepLinked);

  // An older desktop client, the web client and the phone cannot open the link.
  const loopbackOnly = await runCase("relay-without-deep-link", undefined);
  check(
    loopbackOnly,
    pages(loopbackOnly).join(" ") === [HOST_REDIRECT, localhost, HOST_REDIRECT].join(" "),
    `the pages returned to ${pages(loopbackOnly).join(", ")}`,
  );
  check(
    loopbackOnly,
    !loopbackOnly.redirects.some((line) => line.includes(DEEP_LINK)),
    "a client without the link got it",
  );
  check(loopbackOnly, loopbackOnly.errors[2] === null, `the third sign-in failed: ${loopbackOnly.errors[2]}`);
  check(loopbackOnly, loopbackOnly.signedIn, "no token is stored after the sign-in");
  cases.push(loopbackOnly);

  const failures = cases.flatMap((entry) => entry.failures.map((failure) => `${entry.name}: ${failure}`));
  const report = { passed: failures.length === 0, cases, failures };
  await writeFile(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

await main();
