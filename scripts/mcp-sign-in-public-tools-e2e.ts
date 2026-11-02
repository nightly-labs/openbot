// Drives the MCP probe and McpOAuth against a local MCP server for issue #1932.
// bun scripts/mcp-sign-in-public-tools-e2e.ts
// The server lists its tools with no token, as Google's MCP servers do, and names an authorization
// server in its protected-resource metadata. A Sign in must open the authorization page, take the
// grant, and connect again with the token. A server with no such metadata opens no page, and a Test
// opens no page.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpOAuth, type McpOAuthRecord } from "../src/backend/mcp-oauth-provider";
import { testMcpServer } from "../src/backend/mcp-probe";

const out = resolve(import.meta.dirname, "../.openbot-build/mcp-sign-in-public-tools-e2e");
const ACCESS_TOKEN = "e2e-access-token";
const CLIENT_ID = "e2e-client";

interface FakeServer {
  url: string;
  /** Whether each `tools/list` carried the token, in order. */
  toolLists: boolean[];
  tokenRequests: number;
  close: () => Promise<void>;
}

interface Case {
  name: string;
  result: { toolCount: number; error: string | null };
  pagesOpened: number;
  toolLists: boolean[];
  tokenRequests: number;
  signedIn: boolean;
  failures: string[];
}

const report: { passed: boolean; cases: Case[]; failures: string[] } = { passed: false, cases: [], failures: [] };

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function rpcMessage(value: unknown): { id?: number | string; method: string } {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "the request is a JSON object");
  const id = "id" in value ? value.id : undefined;
  const method = "method" in value ? value.method : undefined;
  assert.ok(typeof method === "string", "the request has a method");
  assert.ok(id === undefined || typeof id === "number" || typeof id === "string", "the request id is valid");
  return id === undefined ? { method } : { id, method };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

/** What the server publishes about its sign-in. */
type Metadata = "published" | "absent" | "refused" | "unreadable" | "busy" | "unanswered";

async function fakeServer(metadata: Metadata): Promise<FakeServer> {
  const state: Omit<FakeServer, "url" | "close"> = { toolLists: [], tokenRequests: 0 };
  let base = "";
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", base).pathname;
      // A refusal at the path and at the root is an answer: the server takes no sign-in.
      if (
        request.method === "GET" &&
        path.startsWith("/.well-known/oauth-protected-resource") &&
        metadata === "refused"
      )
        return json(response, 403, { error: "forbidden" });
      if (request.method === "GET" && path.startsWith("/.well-known/oauth-protected-resource") && metadata === "busy")
        return json(response, 429, { error: "too many requests" });
      // The path is not found, and the root gives no answer: the 404 must not count for the root.
      if (request.method === "GET" && path === "/.well-known/oauth-protected-resource" && metadata === "unanswered") {
        request.socket.destroy();
        return;
      }
      if (request.method === "GET" && path === "/.well-known/oauth-protected-resource/mcp") {
        // A read that fails says nothing about the server. The sign-in must not end as if the server
        // asked for none.
        if (metadata === "unreadable") return json(response, 500, { error: "server error" });
        if (metadata === "published")
          return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [`${base}/`] });
      }
      if (request.method === "GET" && path === "/.well-known/oauth-authorization-server" && metadata === "published")
        return json(response, 200, {
          issuer: `${base}/`,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        });
      if (request.method === "POST" && path === "/token") {
        state.tokenRequests += 1;
        const form = new URLSearchParams(await body(request));
        if (form.get("code") !== "e2e-grant") return json(response, 400, { error: "invalid_grant" });
        return json(response, 200, { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600 });
      }
      if (path !== "/mcp") return json(response, 404, { error: "not found" });
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const message = rpcMessage(JSON.parse(await body(request)));
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
            serverInfo: { name: "public-tools", version: "1" },
          },
        });
      if (message.method === "tools/list") {
        state.toolLists.push(request.headers.authorization === `Bearer ${ACCESS_TOKEN}`);
        const tool = (name: string) => ({ name, description: name, inputSchema: { type: "object", properties: {} } });
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [tool("list_spaces"), tool("read_messages"), tool("send_message"), tool("search")] },
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
    get toolLists() {
      return state.toolLists;
    },
    get tokenRequests() {
      return state.tokenRequests;
    },
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function httpConfig(url: string): McpServerConfig {
  return {
    id: "public-tools",
    name: "public_tools",
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

async function runCase(name: string, metadata: Metadata, signIn: boolean): Promise<Case> {
  const server = await fakeServer(metadata);
  const records = new Map<string, McpOAuthRecord>();
  // A saved sign-in app, as in the issue: the server offers no client registration.
  records.set(server.url, { app: { clientId: CLIENT_ID, clientSecret: "e2e-secret" } });
  let pagesOpened = 0;
  const oauth: McpOAuth = new McpOAuth({
    storage: {
      read: (resource) => records.get(resource) ?? null,
      write: (resource, record) => Effect.sync(() => void records.set(resource, record)),
      clear: (resource) => Effect.sync(() => void records.delete(resource)),
    },
    // The browser: the page goes to the authorization server, which sends the grant back.
    openExternal: async (page) => {
      pagesOpened += 1;
      const url = new URL(page);
      assert.equal(url.origin + url.pathname, server.url.replace("/mcp", "/authorize"));
      assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
      const state = url.searchParams.get("state");
      assert.ok(state, "the page has a state");
      setTimeout(() => oauth.receiveAuthorizationCode(state, "e2e-grant"), 50);
    },
    redirectUrl: "http://127.0.0.1:28417/mcp-auth",
    signInTimeoutMs: 10_000,
  });
  const failures: string[] = [];
  try {
    const authority = {
      accessToken: (url: string) => oauth.accessToken(url),
      signIn: signIn ? (url: string) => oauth.signIn(url) : () => null,
    };
    const result = await runCauseEffect(
      testMcpServer(httpConfig(server.url), 10_000, undefined, authority, signIn ? "here" : null),
    );
    return {
      name,
      result,
      pagesOpened,
      toolLists: [...server.toolLists],
      tokenRequests: server.tokenRequests,
      signedIn: oauth.signedIn(server.url),
      failures,
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
    const signIn = await runCase("sign-in-public-tools", "published", true);
    check(signIn, signIn.result.error === null, `the sign-in failed: ${signIn.result.error}`);
    check(signIn, signIn.result.toolCount === 4, "the sign-in did not count 4 tools");
    check(signIn, signIn.pagesOpened === 1, "the sign-in did not open one authorization page");
    check(signIn, signIn.tokenRequests === 1, "the grant was not traded for a token");
    check(signIn, signIn.signedIn, "the token was not stored");
    check(signIn, signIn.toolLists.join() === "false,true", "the second connection did not send the token");
    report.cases.push(signIn);

    const noMetadata = await runCase("sign-in-no-oauth-metadata", "absent", true);
    check(noMetadata, noMetadata.result.error === null, `the connection failed: ${noMetadata.result.error}`);
    check(noMetadata, noMetadata.result.toolCount === 4, "the connection did not count 4 tools");
    check(noMetadata, noMetadata.pagesOpened === 0, "a server with no OAuth metadata opened a page");
    check(noMetadata, noMetadata.tokenRequests === 0, "a server with no OAuth metadata got a token request");
    report.cases.push(noMetadata);

    const refused = await runCase("sign-in-metadata-refused", "refused", true);
    check(refused, refused.result.error === null, `the connection failed: ${refused.result.error}`);
    check(refused, refused.result.toolCount === 4, "the connection did not count 4 tools");
    check(refused, refused.pagesOpened === 0, "a server that refused the metadata read opened a page");
    check(refused, refused.tokenRequests === 0, "a server that refused the metadata read got a token request");
    report.cases.push(refused);

    // A server error, a busy server, and no answer say nothing about the sign-in.
    for (const metadata of ["unreadable", "busy", "unanswered"] as const) {
      const unreadable = await runCase(`sign-in-metadata-${metadata}`, metadata, true);
      check(
        unreadable,
        unreadable.result.error ===
          "OpenBot could not read the sign-in information of this server. Check the server address and try again.",
        `a sign-in with an unreadable metadata document reported: ${unreadable.result.error}`,
      );
      check(unreadable, unreadable.pagesOpened === 0, "a sign-in with an unreadable metadata document opened a page");
      check(
        unreadable,
        unreadable.tokenRequests === 0,
        "a sign-in with an unreadable metadata document asked for a token",
      );
      check(
        unreadable,
        unreadable.result.toolCount === 0,
        "a sign-in with an unreadable metadata document counted tools",
      );
      report.cases.push(unreadable);
    }

    const test = await runCase("test-public-tools", "published", false);
    check(test, test.result.error === null, `the test failed: ${test.result.error}`);
    check(test, test.pagesOpened === 0, "a test opened a page");
    check(test, !test.signedIn, "a test stored a token");
    report.cases.push(test);
  } catch (error) {
    report.failures.push(error instanceof Error ? error.message : String(error));
  }
  report.passed = report.failures.length === 0 && report.cases.every((entry) => entry.failures.length === 0);
  await writeFile(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

await main();
