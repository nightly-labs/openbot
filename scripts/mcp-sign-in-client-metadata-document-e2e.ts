// Drives the MCP probe and McpOAuth against a local MCP server for issue #5440.
// bun scripts/mcp-sign-in-client-metadata-document-e2e.ts
// The authorization server acts as ElevenLabs' does: it has no registration endpoint and sets
// `client_id_metadata_document_supported`. OpenBot must send its client metadata document URL as
// the `client_id`, with no secret, and keep a record that the encrypted store can read again after
// a restart. A server that offers registration as well must keep the registration.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { McpOAuth, type McpOAuthRecord, mcpOAuthRecordSchema } from "../src/backend/mcp-oauth-provider";
import { testMcpServer } from "../src/backend/mcp-probe";

const out = resolve(import.meta.dirname, "../.openbot-build/mcp-sign-in-client-metadata-document-e2e");
const CLIENT_METADATA_URL = "https://openbot.run/oauth/mcp-client.json";
const REDIRECT_URL = "http://127.0.0.1:28417/mcp-auth";
/** The address when another program holds the preferred port. */
const OTHER_REDIRECT_URL = "http://127.0.0.1:28418/mcp-auth";
const ACCESS_TOKEN = "e2e-access-token";
const REGISTERED_CLIENT = "e2e-registered-client";

const rpcRequest = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string() });

interface FakeServer {
  url: string;
  /** The `client_id` of each authorization page that the sign-in opened, in order. */
  pageClientIds: (string | null)[];
  /** The `redirect_uri` of each authorization page that the sign-in opened, in order. */
  pageRedirectUris: (string | null)[];
  /** The `client_id` of each token request, in order. */
  tokenClientIds: (string | null)[];
  /** Whether each token request carried a client secret, in order. */
  tokenRequestsWithSecret: boolean[];
  registrations: number;
  toolLists: number;
  close: () => Promise<void>;
}

interface Case {
  name: string;
  attempts: { toolCount: number; error: string | null }[];
  pageClientIds: (string | null)[];
  tokenClientIds: (string | null)[];
  tokenRequestsWithSecret: boolean[];
  registrations: number;
  toolLists: number;
  /** The stored client, after a round trip through the store's schema, as a restart reads it. */
  storedClient: { clientId: string; redirectUris: string[] } | null;
  signedIn: boolean;
  /** The result of a probe from a new McpOAuth on the same records, as after a restart. */
  afterRestart: { toolCount: number; error: string | null } | null;
  failures: string[];
}

const report: { passed: boolean; cases: (Case | PortChangeCase)[]; failures: string[] } = {
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

/** `registration` adds an RFC 7591 endpoint next to the client metadata document support. */
async function fakeServer(registration: boolean): Promise<FakeServer> {
  const state: Omit<FakeServer, "url" | "close"> = {
    pageClientIds: [],
    pageRedirectUris: [],
    tokenClientIds: [],
    tokenRequestsWithSecret: [],
    registrations: 0,
    toolLists: 0,
  };
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
          ...(registration ? { registration_endpoint: `${base}/register` } : {}),
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
          client_id_metadata_document_supported: true,
        });
      if (request.method === "POST" && path === "/register") {
        state.registrations++;
        const asked = z.object({ redirect_uris: z.array(z.string()) }).parse(JSON.parse(await body(request)));
        return json(response, 201, {
          client_id: REGISTERED_CLIENT,
          token_endpoint_auth_method: "none",
          redirect_uris: asked.redirect_uris,
        });
      }
      if (request.method === "POST" && path === "/token") {
        const form = new URLSearchParams(await body(request));
        state.tokenClientIds.push(form.get("client_id"));
        state.tokenRequestsWithSecret.push(request.headers.authorization !== undefined || form.has("client_secret"));
        if (form.get("code") !== "e2e-grant") return json(response, 400, { error: "invalid_grant" });
        return json(response, 200, {
          access_token: ACCESS_TOKEN,
          refresh_token: "e2e-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
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
            serverInfo: { name: "client-metadata-document", version: "1" },
          },
        });
      if (message.method === "tools/list") {
        state.toolLists++;
        return json(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [{ name: "text_to_speech", description: "speak", inputSchema: { type: "object" } }] },
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
  // The counters change after this returns, so the state object itself is the result, not a copy.
  return Object.assign(state, {
    url: `${base}/mcp`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  });
}

function httpConfig(url: string): McpServerConfig {
  return {
    id: "client-metadata-document",
    name: "client_metadata_document",
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
 * The records go through JSON and `mcpOAuthRecordSchema` on each write, as the encrypted store does
 * when it loads them. A record that the schema refuses fails the case.
 */
function oauthOn(records: Map<string, McpOAuthRecord>, server: FakeServer, redirectUrl = REDIRECT_URL): McpOAuth {
  const oauth: McpOAuth = new McpOAuth({
    storage: {
      read: (resource) => records.get(resource) ?? null,
      write: (resource, record) =>
        Effect.sync(() => void records.set(resource, mcpOAuthRecordSchema.parse(JSON.parse(JSON.stringify(record))))),
      clear: (resource) => Effect.sync(() => void records.delete(resource)),
    },
    // The browser: the authorization server sends the grant straight back.
    openExternal: async (page) => {
      const url = new URL(page);
      server.pageClientIds.push(url.searchParams.get("client_id"));
      server.pageRedirectUris.push(url.searchParams.get("redirect_uri"));
      const state = url.searchParams.get("state");
      assert.ok(state, "the page has a state");
      setTimeout(() => oauth.receiveAuthorizationCode(state, "e2e-grant"), 50);
    },
    redirectUrl,
    signInTimeoutMs: 10_000,
  });
  return oauth;
}

function probe(oauth: McpOAuth, url: string): Promise<{ toolCount: number; error: string | null }> {
  const authority = {
    accessToken: (resource: string) => oauth.accessToken(resource),
    signIn: (resource: string) => oauth.signIn(resource),
  };
  return runCauseEffect(testMcpServer(httpConfig(url), 10_000, undefined, authority, "here"));
}

async function runCase(name: string, registration: boolean): Promise<Case> {
  const server = await fakeServer(registration);
  const records = new Map<string, McpOAuthRecord>();
  const oauth = oauthOn(records, server);
  let restarted: McpOAuth | null = null;
  try {
    const first = await probe(oauth, server.url);
    await runCauseEffect(oauth.close());
    restarted = oauthOn(records, server);
    const afterRestart = await probe(restarted, server.url);
    const client = records.get(server.url)?.client;
    return {
      name,
      attempts: [first],
      pageClientIds: [...server.pageClientIds],
      tokenClientIds: [...server.tokenClientIds],
      tokenRequestsWithSecret: [...server.tokenRequestsWithSecret],
      registrations: server.registrations,
      toolLists: server.toolLists,
      storedClient: client ? { clientId: client.client_id, redirectUris: client.redirect_uris } : null,
      signedIn: restarted.signedIn(server.url),
      afterRestart,
      failures: [],
    };
  } finally {
    if (restarted) await runCauseEffect(restarted.close());
    await server.close();
  }
}

interface PortChangeCase {
  name: string;
  attempts: { toolCount: number; error: string | null }[];
  pageClientIds: (string | null)[];
  pageRedirectUris: (string | null)[];
  registrations: number;
  storedRedirectUris: string[] | null;
  failures: string[];
}

/**
 * A sign-in, a sign-out, and a sign-in after a restart on another port. The stored client names the
 * first address, so the second sign-in must use the document again with the new address. It must
 * not try to register with a server that has no registration endpoint.
 */
async function runPortChange(): Promise<PortChangeCase> {
  const server = await fakeServer(false);
  const records = new Map<string, McpOAuthRecord>();
  const first = oauthOn(records, server);
  let second: McpOAuth | null = null;
  try {
    const attempts = [await probe(first, server.url)];
    await runCauseEffect(first.signOut(server.url));
    await runCauseEffect(first.close());
    second = oauthOn(records, server, OTHER_REDIRECT_URL);
    attempts.push(await probe(second, server.url));
    return {
      name: "client-metadata-document-port-change",
      attempts,
      pageClientIds: [...server.pageClientIds],
      pageRedirectUris: [...server.pageRedirectUris],
      registrations: server.registrations,
      storedRedirectUris: records.get(server.url)?.client?.redirect_uris ?? null,
      failures: [],
    };
  } finally {
    if (second) await runCauseEffect(second.close());
    await server.close();
  }
}

function check(entry: { failures: string[] }, condition: boolean, text: string): void {
  if (!condition) entry.failures.push(text);
}

async function main(): Promise<void> {
  await mkdir(out, { recursive: true });
  try {
    // ElevenLabs: no registration endpoint. The document URL is the client, and the sign-in works.
    const document = await runCase("client-metadata-document", false);
    check(document, document.attempts[0]?.error === null, `the sign-in failed: ${document.attempts[0]?.error}`);
    check(document, document.attempts[0]?.toolCount === 1, "the tools were not listed after the sign-in");
    check(document, document.registrations === 0, `the sign-in registered ${document.registrations} times`);
    check(
      document,
      document.pageClientIds.join() === CLIENT_METADATA_URL,
      `the pages named ${document.pageClientIds.join()}`,
    );
    check(
      document,
      document.tokenClientIds.join() === CLIENT_METADATA_URL,
      `the token requests named ${document.tokenClientIds.join()}`,
    );
    check(document, document.tokenRequestsWithSecret.join() === "false", "a token request carried a client secret");
    check(
      document,
      document.storedClient?.clientId === CLIENT_METADATA_URL &&
        document.storedClient.redirectUris.join() === REDIRECT_URL,
      `the stored client is ${JSON.stringify(document.storedClient)}`,
    );
    check(document, document.afterRestart?.error === null, `after a restart: ${document.afterRestart?.error}`);
    check(document, document.afterRestart?.toolCount === 1, "after a restart the tools were not listed");
    check(document, document.pageClientIds.length === 1, "a restart opened the sign-in page again");
    check(document, document.signedIn, "no token is stored after the sign-in");
    report.cases.push(document);

    // Another port after a restart: the document again, with the new address, and no registration.
    const port = await runPortChange();
    for (const [index, attempt] of port.attempts.entries())
      check(port, attempt.error === null, `attempt ${index + 1} failed: ${attempt.error}`);
    check(
      port,
      port.pageClientIds.join() === `${CLIENT_METADATA_URL},${CLIENT_METADATA_URL}`,
      `the pages named ${port.pageClientIds.join()}`,
    );
    check(
      port,
      port.pageRedirectUris.join() === `${REDIRECT_URL},${OTHER_REDIRECT_URL}`,
      `the pages sent ${port.pageRedirectUris.join()}`,
    );
    check(port, port.registrations === 0, `the sign-ins registered ${port.registrations} times`);
    check(
      port,
      port.storedRedirectUris?.join() === OTHER_REDIRECT_URL,
      `the stored client names ${port.storedRedirectUris?.join()}`,
    );
    report.cases.push(port);

    // A server that offers registration as well keeps the registration.
    const both = await runCase("registration-preferred", true);
    check(both, both.attempts[0]?.error === null, `the sign-in failed: ${both.attempts[0]?.error}`);
    check(both, both.registrations === 1, `the sign-in registered ${both.registrations} times`);
    check(both, both.pageClientIds.join() === REGISTERED_CLIENT, `the pages named ${both.pageClientIds.join()}`);
    check(both, both.afterRestart?.error === null, `after a restart: ${both.afterRestart?.error}`);
    check(both, both.signedIn, "no token is stored after the sign-in");
    report.cases.push(both);
  } catch (error) {
    report.failures.push(error instanceof Error ? error.message : String(error));
  }
  report.passed = report.failures.length === 0 && report.cases.every((entry) => entry.failures.length === 0);
  await writeFile(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

await main();
