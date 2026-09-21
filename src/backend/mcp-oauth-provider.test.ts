import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  describeUnusableRedirectUrl,
  McpOAuth,
  type McpOAuthAuthority,
  type McpOAuthRecord,
  type McpOAuthStorage,
  normalizeResource,
} from "./mcp-oauth-provider";
import { testMcpServer } from "./mcp-probe";

/**
 * A server that answers 401 until it is shown a token, and an authorization server beside it.
 *
 * Written on `node:http` rather than on the SDK's server helpers, so what is asserted is the wire a
 * real bridge speaks: RFC 9728 discovery, RFC 7591 registration, a PKCE authorization code, and the
 * bearer header on the request that finally works.
 */
const GRANT = "grant-abc";
const ACCESS_TOKEN = "issued-access-token";
const REFRESH_TOKEN = "issued-refresh-token";
const REFRESHED_TOKEN = "refreshed-access-token";

interface FakeServer {
  base: string;
  url: string;
  registrations: number;
  /** Every address a registration asked grants to be sent to, in the order they were registered. */
  registeredRedirectUris: string[];
  tokenRequests: URLSearchParams[];
  close: () => Promise<void>;
}

/** The one field of a registration request this fake reads back. */
const registrationRequestSchema = z.object({ redirect_uris: z.array(z.string()).default(["openbot://mcp-auth"]) });

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise<string>((resolve, reject) => {
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

interface FakeServerOptions {
  quoteTokenOnError?: boolean;
  hangToken?: boolean;
  delayTokenMs?: number;
  /** Overrides the authorization endpoint the metadata advertises. */
  authorizeUrl?: string;
  /** Overrides the token endpoint the metadata advertises. */
  tokenUrl?: string;
  /** Answers the code exchange with a refusal that quotes back what the request carried. */
  quoteCredentialsOnTokenError?: boolean;
  /** Redirects the token endpoint to another address, to check what the next hop is handed. */
  redirectTokenTo?: string;
  /** Refuses every bearer token, so a stored one that looks valid still ends in a 401. */
  rejectEveryToken?: boolean;
  /** The protected-resource metadata URL the 401 challenge advertises. */
  advertisedPrmPath?: string;
  /** Authorization servers the default protected-resource metadata names. */
  defaultAuthorizationServers?: string[];
}

async function startFakeServer(options: FakeServerOptions = {}): Promise<FakeServer> {
  const { quoteTokenOnError = false, hangToken = false, delayTokenMs = 0 } = options;
  const { quoteCredentialsOnTokenError = false, rejectEveryToken = false } = options;
  const state: {
    registrations: number;
    registeredRedirectUris: string[];
    tokenRequests: URLSearchParams[];
    refreshToken: string;
  } = {
    registrations: 0,
    registeredRedirectUris: [],
    tokenRequests: [],
    refreshToken: REFRESH_TOKEN,
  };
  let base = "";
  // Sockets a hanging endpoint still holds. `server.close` waits for them, so a `/token` that
  // never answers would hold the test's own teardown past its deadline; destroying them first
  // keeps the hang inside the test.
  const sockets = new Set<import("node:net").Socket>();
  const advertisedPrm = options.advertisedPrmPath ?? "/.well-known/oauth-protected-resource";
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", base).pathname;
      if (path === "/.well-known/oauth-protected-resource") {
        // `base` is set once the server listens, before any request arrives.
        const authorizationServers = options.defaultAuthorizationServers ?? [base];
        sendJson(response, 200, { resource: `${base}/mcp`, authorization_servers: authorizationServers });
        return;
      }
      if (path === advertisedPrm && advertisedPrm !== "/.well-known/oauth-protected-resource") {
        sendJson(response, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
        return;
      }
      if (path === "/.well-known/oauth-authorization-server") {
        sendJson(response, 200, {
          issuer: base,
          authorization_endpoint: options.authorizeUrl ?? `${base}/authorize`,
          token_endpoint: options.tokenUrl ?? `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
        });
        return;
      }
      if (path === "/register") {
        const body = await readBody(request);
        state.registrations += 1;
        // Echoed, as RFC 7591 says a registration answer does, so a test can read back the
        // address this installation asked its grants to be sent to.
        const { redirect_uris: uris } = registrationRequestSchema.parse(JSON.parse(body || "{}"));
        state.registeredRedirectUris.push(...uris);
        sendJson(response, 201, { client_id: "test-client", redirect_uris: uris });
        return;
      }
      if (path === "/token") {
        // A token endpoint that moved. 307 keeps the method and the body, which is what makes the
        // next origin a place the code or the refresh token would otherwise arrive at.
        if (options.redirectTokenTo !== undefined) {
          response.writeHead(307, { location: options.redirectTokenTo }).end();
          return;
        }
        const form = new URLSearchParams(await readBody(request));
        state.tokenRequests.push(form);
        // An authorization server that takes the connection and never answers. The request is
        // recorded above, so a test can prove the exchange started without waiting for it.
        if (hangToken) return;
        // A slow authorization server, so a test can remove the row mid-exchange.
        if (delayTokenMs > 0) await new Promise((resolve) => setTimeout(resolve, delayTokenMs));
        if (form.get("grant_type") === "refresh_token") {
          // Rotating, like the specification recommends: the refresh token just spent is dead, so
          // a second exchange with it would be refused and the grant would be at risk.
          if (form.get("refresh_token") !== state.refreshToken) {
            sendJson(response, 400, { error: "invalid_grant" });
            return;
          }
          state.refreshToken = `${state.refreshToken}-next`;
          sendJson(response, 200, {
            access_token: REFRESHED_TOKEN,
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: state.refreshToken,
          });
          return;
        }
        // An authorization server that states its refusal by quoting the request back. The SDK
        // makes `error_description` the message of the error it throws, so every value named here
        // reaches the panel unless the sign-in's own ledger redacts it first.
        if (quoteCredentialsOnTokenError) {
          sendJson(response, 400, {
            error: "invalid_request",
            error_description: `rejected code ${form.get("code")} with verifier ${form.get("code_verifier")}`,
          });
          return;
        }
        if (form.get("code") !== GRANT || !form.get("code_verifier")) {
          sendJson(response, 400, { error: "invalid_grant" });
          return;
        }
        sendJson(response, 200, {
          access_token: ACCESS_TOKEN,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: REFRESH_TOKEN,
        });
        return;
      }
      if (path !== "/mcp") {
        response.writeHead(404).end();
        return;
      }
      if (
        rejectEveryToken ||
        (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}` &&
          request.headers.authorization !== `Bearer ${REFRESHED_TOKEN}`)
      ) {
        response.writeHead(401, {
          "www-authenticate": `Bearer resource_metadata="${base}${advertisedPrm}"`,
        });
        response.end();
        return;
      }
      // The transport also opens a stream and deletes the session as it closes; neither carries a
      // request, and answering them keeps the test's failures about the sign-in.
      const body = await readBody(request);
      if (!body) {
        response.writeHead(request.method === "DELETE" ? 204 : 405).end();
        return;
      }
      const message: { id?: number; method?: string } = JSON.parse(body);
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      if (quoteTokenOnError) {
        // A server that reports a failure by quoting the credential it was shown. Rare, and the
        // reason the probe cannot redact only what the row holds: this token is on no row.
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: `the workspace rejected ${ACCESS_TOKEN}` },
        });
        return;
      }
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id: message.id,
        result:
          message.method === "initialize"
            ? {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "fake", version: "1" },
              }
            : { tools: [{ name: "one", inputSchema: { type: "object" } }] },
      });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The fake server has no port.");
  base = `http://127.0.0.1:${address.port}`;
  return {
    get base() {
      return base;
    },
    url: `${base}/mcp`,
    get registrations() {
      return state.registrations;
    },
    get tokenRequests() {
      return state.tokenRequests;
    },
    get registeredRedirectUris() {
      return state.registeredRedirectUris;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** The store, without the file. `McpOAuthStore` covers the encryption and the envelope. */
function memoryStorage(): McpOAuthStorage & { records: Map<string, McpOAuthRecord> } {
  const records = new Map<string, McpOAuthRecord>();
  return {
    records,
    read: (resource) => records.get(resource) ?? null,
    write: async (resource, record) => {
      records.set(resource, record);
    },
    clear: async (resource) => {
      records.delete(resource);
    },
  };
}

function config(url: string): McpServerConfig {
  return {
    id: "mcp-1",
    name: "Signed in",
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

const servers: FakeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function fakeServer(options: FakeServerOptions = {}): Promise<FakeServer> {
  const server = await startFakeServer(options);
  servers.push(server);
  return server;
}

describe("signing in to an http MCP server", () => {
  it("registers, gets a grant from the browser, and connects with the token", async () => {
    const server = await fakeServer();
    const storage = memoryStorage();
    const opened: string[] = [];
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      // The browser stands in for the user: it goes to the address it was given and comes back on
      // the deep link, which is the only way a grant reaches this process.
      openExternal: async (url) => {
        opened.push(url);
        const state = new URL(url).searchParams.get("state") ?? "";
        expect(oauth.receiveAuthorizationCode(state, GRANT)).toBe(true);
      },
      signInTimeoutMs: 10_000,
    });

    expect(await testMcpServer(config(server.url), 10_000, undefined, oauth)).toEqual({ toolCount: 1, error: null });

    const authorize = new URL(opened[0] ?? "");
    expect(authorize.origin + authorize.pathname).toBe(`${server.base}/authorize`);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toBe("openbot://mcp-auth");
    expect(server.tokenRequests[0]?.get("code_verifier")).toBeTruthy();
    expect(storage.read(server.url)?.tokens?.access_token).toBe(ACCESS_TOKEN);
  });

  it("refreshes an expiring token once when two hand-offs ask together", async () => {
    const server = await fakeServer();
    const storage = memoryStorage();
    storage.records.set(server.url, {
      client: { client_id: "test-client", redirect_uris: ["openbot://mcp-auth"] },
      tokens: { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600, refresh_token: REFRESH_TOKEN },
      // Long expired: this is the token a thread would otherwise hand a provider on its way out.
      obtainedAt: Date.now() - 7_200_000,
    });
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => expect.unreachable("A refresh must never open a browser."),
    });

    // Two rows naming the same server, resolved side by side, which is what one hand-off does. A
    // second exchange would spend a refresh token the first one has already rotated away, and a
    // server that reads that as theft revokes the grant.
    const both = await Promise.all([oauth.accessToken(server.url), oauth.accessToken(server.url)]);

    expect(both).toEqual([REFRESHED_TOKEN, REFRESHED_TOKEN]);
    expect(server.tokenRequests).toHaveLength(1);
  });

  it("spends a stored token for a silent test without opening a browser", async () => {
    const server = await fakeServer();
    const storage = memoryStorage();
    storage.records.set(server.url, {
      client: { client_id: "test-client", redirect_uris: ["openbot://mcp-auth"] },
      tokens: { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600, refresh_token: REFRESH_TOKEN },
      // Long expired, so the probe must refresh before it connects. A remote administrator's test
      // reaches the server through this same authority: stored tokens are spent, and `signIn`
      // stays `null`, so no browser opens on a machine nobody is sitting at.
      obtainedAt: Date.now() - 7_200_000,
    });
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => expect.unreachable("A silent test must never open a browser."),
    });
    const silent: McpOAuthAuthority = {
      accessToken: (url) => oauth.accessToken(url),
      signIn: () => null,
      forget: (url) => oauth.forget(url),
    };

    expect(await testMcpServer(config(server.url), 10_000, undefined, silent)).toEqual({
      toolCount: 1,
      error: null,
    });
    expect(server.tokenRequests.filter((form) => form.get("grant_type") === "refresh_token")).toHaveLength(1);
    expect(server.registrations).toBe(0);
  });

  it("answers with the stored token when the refresh hangs", async () => {
    const server = await fakeServer({ hangToken: true });
    const storage = memoryStorage();
    storage.records.set(server.url, {
      client: { client_id: "test-client", redirect_uris: ["openbot://mcp-auth"] },
      tokens: { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600, refresh_token: REFRESH_TOKEN },
      obtainedAt: Date.now() - 7_200_000,
    });
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => expect.unreachable("A refresh must never open a browser."),
      refreshTimeoutMs: 200,
    });

    // The authorization server takes the connection and never answers. The thread start must not
    // hang with it: the wait ends and the token on file answers instead.
    expect(await oauth.accessToken(server.url)).toBe(ACCESS_TOKEN);
    expect(server.tokenRequests).toHaveLength(1);
  });

  it("gives up the token trade when the authorization server hangs", async () => {
    const server = await fakeServer({ hangToken: true });
    const storage = memoryStorage();
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
      refreshTimeoutMs: 200,
    });

    // The user did everything right and the browser came back; the token endpoint then hung.
    // The test reports that instead of holding past its own deadline.
    const result = await testMcpServer(config(server.url), 10_000, undefined, oauth);
    expect(result.toolCount).toBe(0);
    expect(result.error).toContain("The sign-in response did not arrive in time.");
  });

  it("refuses to open a sign-in page that is not on the web", async () => {
    const server = await fakeServer({ authorizeUrl: "file:///etc/hosts" });
    const storage = memoryStorage();
    const opened: string[] = [];
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        opened.push(url);
      },
      signInTimeoutMs: 10_000,
    });

    // The discovered authorization endpoint names a file. Test must not invoke the program the
    // operating system registers for it.
    const result = await testMcpServer(config(server.url), 10_000, undefined, oauth);
    expect(opened).toHaveLength(0);
    expect(result.toolCount).toBe(0);
    expect(result.error).toContain("The sign-in address is not a web page.");
  });

  it("reuses the authorization server the sign-in discovered", async () => {
    const server = await fakeServer({
      advertisedPrmPath: "/custom-prm",
      defaultAuthorizationServers: ["http://127.0.0.1:9/"],
    });
    const storage = memoryStorage();
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
    });
    // The sign-in discovers through the advertised metadata URL...
    expect(await testMcpServer(config(server.url), 10_000, undefined, oauth)).toEqual({
      toolCount: 1,
      error: null,
    });

    // ...then the stored access token is replaced with one the server rejects, and aged out, so
    // the next probe must refresh through the same authorization server. Default discovery names
    // a dead server; without the retained state the refresh fails and the tools stay missing.
    const record = storage.read(server.url);
    if (!record?.tokens) throw new Error("The sign-in stored no tokens.");
    storage.records.set(server.url, {
      ...record,
      tokens: { ...record.tokens, access_token: "rotated-away" },
      obtainedAt: Date.now() - 7_200_000,
    });
    const silent: McpOAuthAuthority = {
      accessToken: (url) => oauth.accessToken(url),
      signIn: () => null,
      forget: (url) => oauth.forget(url),
    };
    expect(await testMcpServer(config(server.url), 10_000, undefined, silent)).toEqual({
      toolCount: 1,
      error: null,
    });
  });

  it("recovers the authorization server after a restart", async () => {
    const server = await fakeServer({
      advertisedPrmPath: "/custom-prm",
      defaultAuthorizationServers: ["http://127.0.0.1:9/"],
    });
    const storage = memoryStorage();
    const signIn = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        signIn.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
    });
    // The sign-in discovers through the advertised metadata URL...
    expect(await testMcpServer(config(server.url), 10_000, undefined, signIn)).toEqual({
      toolCount: 1,
      error: null,
    });

    // ...then OpenBot restarts: a new instance over the same store, and a stored access token the
    // server rejects, aged out. Default discovery names a dead server; only the persisted state
    // still names the one that issued the grant.
    const record = storage.read(server.url);
    if (!record?.tokens) throw new Error("The sign-in stored no tokens.");
    storage.records.set(server.url, {
      ...record,
      tokens: { ...record.tokens, access_token: "rotated-away" },
      obtainedAt: Date.now() - 7_200_000,
    });
    const restarted = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => expect.unreachable("A refresh must never open a browser."),
    });
    const silent: McpOAuthAuthority = {
      accessToken: (url) => restarted.accessToken(url),
      signIn: () => null,
      forget: (url) => restarted.forget(url),
    };
    expect(await testMcpServer(config(server.url), 10_000, undefined, silent)).toEqual({
      toolCount: 1,
      error: null,
    });
  });

  it("starts a fresh exchange when the running refresh stalls", async () => {
    const server = await fakeServer({ delayTokenMs: 300 });
    const storage = memoryStorage();
    storage.records.set(server.url, {
      client: { client_id: "test-client", redirect_uris: ["openbot://mcp-auth"] },
      tokens: { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600, refresh_token: REFRESH_TOKEN },
      obtainedAt: Date.now() - 7_200_000,
    });
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => expect.unreachable("A refresh must never open a browser."),
      refreshTimeoutMs: 100,
    });

    // The token endpoint answers slowly, past the wait. The first caller falls back to the stored
    // token - but the second caller must not join the same stalled request and wait it out again.
    // It starts a fresh exchange instead, which is the second token request below.
    expect(await oauth.accessToken(server.url)).toBe(ACCESS_TOKEN);
    expect(await oauth.accessToken(server.url)).toBe(ACCESS_TOKEN);
    expect(server.tokenRequests.filter((form) => form.get("grant_type") === "refresh_token")).toHaveLength(2);
  });

  it("never opens a browser for a sign-in the probe abandoned", async () => {
    const opened: string[] = [];
    const oauth = new McpOAuth({
      storage: memoryStorage(),
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        opened.push(url);
      },
    });
    const signIn = oauth.signIn("https://mcp.example.com/mcp");
    if (!signIn) throw new Error("The example server cannot be signed in to.");
    signIn.abandon();

    // Discovery slow enough to outlast the probe finishes afterwards. The grant is gone with the
    // callback, so opening the browser now would sign into nothing.
    await signIn.provider.redirectToAuthorization(new URL("https://mcp.example.com/authorize"));
    expect(opened).toHaveLength(0);
    await expect(signIn.complete()).rejects.toThrow("The sign-in was abandoned.");
  });

  it("abandons a refresh whose token endpoint never answers", async () => {
    const server = await fakeServer({ hangToken: true });
    const storage = memoryStorage();
    storage.records.set(server.url, {
      client: { client_id: "test-client", redirect_uris: ["openbot://mcp-auth"] },
      tokens: { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600, refresh_token: REFRESH_TOKEN },
      obtainedAt: Date.now() - 7_200_000,
    });
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => expect.unreachable("A refresh must never open a browser."),
      refreshTimeoutMs: 200,
    });

    // The token endpoint takes the connection and never answers. Each caller falls back to the
    // stored token - but the second caller must not join the same dead request and wait it out
    // again. The aborted exchange is released, so it starts a fresh one instead, which is the
    // second token request below.
    expect(await oauth.accessToken(server.url)).toBe(ACCESS_TOKEN);
    expect(await oauth.accessToken(server.url)).toBe(ACCESS_TOKEN);
    expect(server.tokenRequests.filter((form) => form.get("grant_type") === "refresh_token")).toHaveLength(2);
  });

  it("refuses credential writes from an abandoned sign-in", async () => {
    const storage = memoryStorage();
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => expect.unreachable("Nothing is signed in here."),
    });
    const signIn = oauth.signIn("https://mcp.example.com/mcp");
    if (!signIn) throw new Error("The example server cannot be signed in to.");
    signIn.abandon();

    await expect(signIn.provider.saveTokens({ access_token: "late-token", token_type: "Bearer" })).rejects.toThrow(
      "The MCP sign-in was abandoned.",
    );
    expect(storage.read("https://mcp.example.com/mcp")).toBeNull();
  });

  it("refuses a credential removal from an abandoned sign-in", async () => {
    // The SDK answers `invalid_client` by invalidating everything. A probe that timed out, a user
    // who signed in again, and only then the old attempt's refusal arriving, would otherwise take
    // the account the new sign-in had just stored.
    const storage = memoryStorage();
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => expect.unreachable("Nothing is signed in here."),
    });
    const stale = oauth.signIn("https://mcp.example.com/mcp");
    if (!stale) throw new Error("The example server cannot be signed in to.");
    stale.abandon();
    const fresh: McpOAuthRecord = { tokens: { access_token: "the-new-token", token_type: "Bearer" } };
    storage.records.set("https://mcp.example.com/mcp", fresh);

    // Optional on the SDK's interface, and the whole subject of this test.
    const { invalidateCredentials } = stale.provider;
    if (!invalidateCredentials) throw new Error("The provider cannot invalidate credentials.");
    await expect(invalidateCredentials.call(stale.provider, "all")).rejects.toThrow("The MCP sign-in was abandoned.");
    expect(storage.read("https://mcp.example.com/mcp")).toEqual(fresh);
  });

  it("keeps the token it just minted out of the failure it reports", async () => {
    const server = await fakeServer({ quoteTokenOnError: true });
    const storage = memoryStorage();
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
    });

    // This machine had signed in to nothing, so the row holds no credential and the token the
    // failing request carried was minted between the two attempts. The panel shows this sentence.
    const result = await testMcpServer(config(server.url), 10_000, undefined, oauth);
    expect(result.toolCount).toBe(0);
    expect(result.error).not.toContain(ACCESS_TOKEN);
    expect(result.error).toContain("the workspace rejected •••");
  });

  it("refuses a token endpoint that is not https, and sends the grant nowhere", async () => {
    // Discovery is the server's own document, and the SDK posts the code, the verifier and the
    // refresh token to whatever it names. `normalizeResource` cleared the MCP address; only the
    // fetch guard covers this one.
    const server = await fakeServer({ tokenUrl: "http://auth.example.com/token" });
    const oauth = new McpOAuth({
      storage: memoryStorage(),
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
    });

    const result = await testMcpServer(config(server.url), 10_000, undefined, oauth);
    expect(result.toolCount).toBe(0);
    expect(result.error).toContain("not https");
    // The exchange never left this machine: nothing carrying the grant was sent at all.
    expect(server.tokenRequests).toHaveLength(0);
  });

  it("redacts the code and the verifier from a refusal that quotes them", async () => {
    const server = await fakeServer({ quoteCredentialsOnTokenError: true });
    const oauth = new McpOAuth({
      storage: memoryStorage(),
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
    });

    const result = await testMcpServer(config(server.url), 10_000, undefined, oauth);
    expect(result.toolCount).toBe(0);
    // Both are credentials until the exchange ends, and the store holds neither by now: the
    // exchange failed, so only what the attempt itself recorded can mask them.
    expect(result.error).not.toContain(GRANT);
    const verifier = server.tokenRequests[0]?.get("code_verifier");
    expect(verifier).toBeTruthy();
    expect(result.error).not.toContain(verifier);
  });

  it("guards the refresh the transport starts after a 401 on a stored token", async () => {
    // The transport does OAuth of its own. A token this probe believed was still valid, refused by
    // the server, makes the transport spend the refresh token and the client secret through its
    // own fetch - the path the two explicit exchanges do not cover.
    const server = await fakeServer({ rejectEveryToken: true, tokenUrl: "http://auth.example.com/token" });
    const storage = memoryStorage();
    storage.records.set(server.url, {
      client: { client_id: "test-client", client_secret: "test-secret", redirect_uris: ["openbot://mcp-auth"] },
      tokens: { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600, refresh_token: REFRESH_TOKEN },
      // Well inside its life, so nothing refreshes before the connection: only the 401 does.
      obtainedAt: Date.now(),
      discovery: { authorizationServerUrl: server.base },
    });
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
    });

    // What actually left this machine. The probe falls back to an interactive sign-in after the
    // 401, and that path is guarded already - so the error text alone would not say whether the
    // transport's own refresh was stopped. Only the requests answer that.
    const requested: string[] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      requested.push(input instanceof Request ? input.url : input.toString());
      return realFetch(input, init);
    });
    try {
      const result = await testMcpServer(config(server.url), 10_000, undefined, oauth);
      expect(result.toolCount).toBe(0);
      // The refresh token and the client secret were never offered to the plain-text endpoint the
      // discovery document named.
      expect(requested.filter((url) => url.startsWith("http://auth.example.com"))).toEqual([]);
      expect(server.tokenRequests).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not forward the token request to the origin a redirect names", async () => {
    // `fetch` strips `Authorization` across origins by itself; following redirects by hand means
    // this loop has to, and a token request also carries the code in its body.
    const received: { authorization?: string; body: string }[] = [];
    const elsewhere = createServer((request, response) => {
      void (async () => {
        received.push({ authorization: request.headers.authorization, body: await readBody(request) });
        sendJson(response, 200, { access_token: "leaked", token_type: "Bearer" });
      })();
    });
    await new Promise<void>((resolve) => elsewhere.listen(0, "127.0.0.1", resolve));
    const address = elsewhere.address();
    if (address === null || typeof address === "string") throw new Error("The second server has no port.");
    try {
      // A different port is a different origin, which is what the check is about.
      const server = await fakeServer({ redirectTokenTo: `http://127.0.0.1:${address.port}/token` });
      const oauth = new McpOAuth({
        storage: memoryStorage(),
        redirectUrl: "openbot://mcp-auth",
        openExternal: async (url) => {
          oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
        },
        signInTimeoutMs: 10_000,
      });

      const result = await testMcpServer(config(server.url), 10_000, undefined, oauth);
      expect(result.toolCount).toBe(0);
      expect(result.error).toContain("redirected to");
      // The origin the redirect named was never asked for anything at all.
      expect(received).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => elsewhere.close(() => resolve()));
    }
  });

  it("spends the stored token the next time rather than signing in again", async () => {
    const server = await fakeServer();
    const storage = memoryStorage();
    const opened: string[] = [];
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        opened.push(url);
        oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
    });
    await testMcpServer(config(server.url), 10_000, undefined, oauth);

    expect(await testMcpServer(config(server.url), 10_000, undefined, oauth)).toEqual({ toolCount: 1, error: null });
    // One browser trip and one registration for the whole account: a second window per test, or per
    // thread start, is the failure this store exists to stop.
    expect(opened).toHaveLength(1);
    expect(server.registrations).toBe(1);
    // And the hand-off path answers with the same token without going anywhere.
    expect(await oauth.accessToken(server.url)).toBe(ACCESS_TOKEN);
  });

  it("says so plainly when a server answers 401 and nobody is signing in", async () => {
    const server = await fakeServer();
    // A thread start, not a test the user pressed: no browser opens and the tools are simply absent.
    expect(await testMcpServer(config(server.url), 10_000)).toEqual({
      toolCount: 0,
      error: "The server answered 401.",
    });
  });

  it("does not restore credentials forgotten during a refresh", async () => {
    const server = await fakeServer({ delayTokenMs: 300 });
    const storage = memoryStorage();
    storage.records.set(server.url, {
      client: { client_id: "test-client", redirect_uris: ["openbot://mcp-auth"] },
      tokens: { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600, refresh_token: REFRESH_TOKEN },
      obtainedAt: Date.now() - 7_200_000,
    });
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => expect.unreachable("A refresh must never open a browser."),
    });

    // The token endpoint answers slowly. The removal lands after the exchange started but before
    // it finishes: without a guard the write it ends with would restore the account, and
    // re-adding the URL would reuse it.
    const pending = oauth.accessToken(server.url);
    await vi.waitFor(() => {
      expect(server.tokenRequests.filter((form) => form.get("grant_type") === "refresh_token")).toHaveLength(1);
    });
    await oauth.forget(server.url);

    expect(await pending).toBe(ACCESS_TOKEN);
    expect(storage.read(server.url)).toBeNull();
  });

  it("forgets a sign-in when the server is removed", async () => {
    const server = await fakeServer();
    const storage = memoryStorage();
    const oauth = new McpOAuth({
      storage,
      redirectUrl: "openbot://mcp-auth",
      openExternal: async (url) => {
        oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
    });
    await testMcpServer(config(server.url), 10_000, undefined, oauth);

    await oauth.forget(server.url);
    expect(storage.records.size).toBe(0);
    expect(await oauth.accessToken(server.url)).toBeNull();
  });

  it("ignores a grant for a sign-in this run never started", async () => {
    const oauth = new McpOAuth({
      storage: memoryStorage(),
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => undefined,
    });
    // Which is what makes a forged or replayed `openbot://mcp-auth` link do nothing at all.
    expect(oauth.receiveAuthorizationCode("state-nobody-issued", GRANT)).toBe(false);
  });

  it("offers no sign-in for an address a grant must not be sent to", () => {
    const oauth = new McpOAuth({
      storage: memoryStorage(),
      redirectUrl: "openbot://mcp-auth",
      openExternal: async () => undefined,
    });
    expect(normalizeResource("http://mcp.example.com/mcp")).toBeNull();
    expect(normalizeResource("https://mcp.example.com/mcp#tab")).toBe("https://mcp.example.com/mcp");
    expect(oauth.signIn("http://mcp.example.com/mcp")).toBeNull();
    expect(oauth.signIn("http://localhost:4000/mcp")).not.toBeNull();
  });
});

/**
 * The address a grant comes back to. Canva registers `openbot://mcp-auth` without complaint and
 * then answers the authorization request with `Invalid redirect URI.`, which happens on its own
 * page where OpenBot sees nothing - so what is checked here is what leaves this machine.
 */
describe("the address a returning grant is sent to", () => {
  const LOOPBACK = "http://127.0.0.1:54321/mcp-auth";

  it("registers and sends the loopback address it listens on", async () => {
    const server = await fakeServer();
    const storage = memoryStorage();
    const opened: string[] = [];
    const oauth = new McpOAuth({
      storage,
      redirectUrl: LOOPBACK,
      openExternal: async (url) => {
        opened.push(url);
        oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
    });

    expect(await testMcpServer(config(server.url), 10_000, undefined, oauth)).toEqual({ toolCount: 1, error: null });

    // Registered, sent to the authorization endpoint and repeated at the token endpoint: an
    // authorization server compares all three, and a mismatch between any two ends the sign-in.
    expect(server.registeredRedirectUris).toEqual([LOOPBACK]);
    expect(new URL(opened[0] ?? "").searchParams.get("redirect_uri")).toBe(LOOPBACK);
    expect(server.tokenRequests[0]?.get("redirect_uri")).toBe(LOOPBACK);
  });

  it("registers again when the stored registration names another address", async () => {
    const server = await fakeServer();
    const storage = memoryStorage();
    // What a build that used the deep link left behind. Sending the loopback address against this
    // registration is exactly the refusal the user cannot act on.
    storage.records.set(server.url, { client: { client_id: "old-client", redirect_uris: ["openbot://mcp-auth"] } });
    const oauth = new McpOAuth({
      storage,
      redirectUrl: LOOPBACK,
      openExternal: async (url) => {
        oauth.receiveAuthorizationCode(new URL(url).searchParams.get("state") ?? "", GRANT);
      },
      signInTimeoutMs: 10_000,
    });

    expect(await testMcpServer(config(server.url), 10_000, undefined, oauth)).toEqual({ toolCount: 1, error: null });

    // Once, and only once: a sign-in that registered again for every request the exchange makes
    // would spend its grant against a `client_id` that grant was never issued to.
    expect(server.registrations).toBe(1);
    expect(server.registeredRedirectUris).toEqual([LOOPBACK]);
    expect(storage.read(server.url)?.client?.redirect_uris).toEqual([LOOPBACK]);
    expect(storage.read(server.url)?.tokens?.access_token).toBe(ACCESS_TOKEN);
  });

  it("keeps the stored registration for a silent refresh", async () => {
    const server = await fakeServer();
    const storage = memoryStorage();
    storage.records.set(server.url, {
      client: { client_id: "test-client", redirect_uris: ["openbot://mcp-auth"] },
      tokens: { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600, refresh_token: REFRESH_TOKEN },
      obtainedAt: Date.now() - 7_200_000,
    });
    const oauth = new McpOAuth({
      storage,
      redirectUrl: LOOPBACK,
      openExternal: async () => expect.unreachable("A refresh must never open a browser."),
    });

    // A refresh has no browser to register a new address for, and its refresh token belongs to
    // the `client_id` on file. Registering here would spend it against a client that never got it.
    expect(await oauth.accessToken(server.url)).toBe(REFRESHED_TOKEN);
    expect(server.registrations).toBe(0);
  });

  it("refuses an address no MCP authorization server would send a grant to", () => {
    const storage = memoryStorage();
    const openExternal = async () => undefined;
    expect(() => new McpOAuth({ storage, openExternal, redirectUrl: "https://openbot.run/mcp-auth" })).toThrow(
      /web address/,
    );
    expect(() => new McpOAuth({ storage, openExternal, redirectUrl: "http://openbot.run/mcp-auth" })).toThrow(
      /clear text/,
    );
    expect(() => new McpOAuth({ storage, openExternal, redirectUrl: "mcp-auth" })).toThrow(/complete address/);
    expect(describeUnusableRedirectUrl(LOOPBACK)).toBeNull();
    expect(describeUnusableRedirectUrl("openbot://mcp-auth")).toBeNull();
  });
});
