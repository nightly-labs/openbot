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
import { inspectMcpServer, testMcpServer } from "../src/backend/mcp-probe";

const out = resolve(import.meta.dirname, "../.openbot-build/mcp-sign-in-client-refused-e2e");
const ACCESS_TOKEN = "e2e-access-token";
const CLIENT_SECRET = "e2e-client-secret";

const registrationRequest = z.object({
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
  redirect_uris: z.array(z.string()),
});
const rpcRequest = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string() });

interface FakeServer {
  url: string;
  registrations: (string | null)[];
  registrationScopes: (string | null)[];
  tokenRequestsWithSecret: boolean[];
  toolLists: boolean[];
  pagesOpened: string[];
  redirects: string[];
  close: () => Promise<void>;
}

interface Case {
  name: string;
  attempts: { toolCount: number; error: string | null }[];
  silentTest?: { error: string | null; needs: string | null };
  registrations: (string | null)[];
  registrationScopes: (string | null)[];
  pageScopes: (string | null)[];
  tokenRequestsWithSecret: boolean[];
  toolLists: boolean[];
  pagesOpened: number;
  redirects: string[];
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

const REGISTRATION_REFUSALS = {
  revenueCat: {
    error: "invalid_client",
    error_description: "The client is not registered. Contact support if you need to register a new client.",
  },
  omnisend: { error: "invalid_client_metadata", error_description: "unknown application: OpenBot" },
  tessie: {
    error: "invalid_client_metadata",
    error_description: "No dynamic client registration template matched this request.",
  },
} as const;
type RegistrationRefusal = keyof typeof REGISTRATION_REFUSALS;

const REGISTRATION_FORBIDDEN = {
  error: "registration_not_supported",
  error_description:
    "Dynamic client registration is not supported. Only pre-registered MCP trusted partners are allowed.",
};
type RegistrationForbidden = "dropbox" | "forbidden" | "namecheap";
type AccountRefusal = "forbidden" | "insufficientScope";

const DROPBOX_REDIRECTS = ["http://localhost/callback", "http://127.0.0.1/callback", "http://127.0.0.1"];
const NAMECHEAP_REDIRECTS = ["https://claude.ai/api/mcp/auth_callback", "https://vscode.dev/redirect"];

interface ScopeMetadata {
  resource?: string[] | null;
  server?: string[];
}

async function fakeServer(
  authMethods: string[],
  secretAccepted: boolean,
  registrationRefused: RegistrationRefusal | null,
  scopes: ScopeMetadata = {},
  registrationForbidden: RegistrationForbidden | null = null,
  accountRefused: AccountRefusal | null = null,
  tokenForbidden = false,
  secretForPublic = false,
): Promise<FakeServer> {
  const state: Omit<FakeServer, "url" | "close"> = {
    registrations: [],
    registrationScopes: [],
    tokenRequestsWithSecret: [],
    toolLists: [],
    pagesOpened: [],
    redirects: [],
  };
  let base = "";
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", base).pathname;
      if (request.method === "GET" && path === "/.well-known/oauth-protected-resource/mcp")
        return scopes.resource === null
          ? json(response, 404, { error: "not_found" })
          : json(response, 200, {
              resource: `${base}/mcp`,
              authorization_servers: [base],
              ...(scopes.resource ? { scopes_supported: scopes.resource } : {}),
            });
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
          ...(scopes.server ? { scopes_supported: scopes.server } : {}),
        });
      if (request.method === "POST" && path === "/register") {
        const asked = registrationRequest.parse(JSON.parse(await body(request)));
        state.registrations.push(asked.token_endpoint_auth_method ?? null);
        state.registrationScopes.push(asked.scope ?? null);
        const id = `e2e-client-${state.registrations.length}`;
        state.redirects.push(`register ${asked.redirect_uris.join(" ")}`);
        if (registrationForbidden) {
          const path = URL.parse(asked.redirect_uris[0] ?? "")?.pathname;
          if (registrationForbidden === "namecheap")
            return json(response, 201, {
              client_id: id,
              token_endpoint_auth_method: "none",
              redirect_uris: path === "/callback" ? asked.redirect_uris : NAMECHEAP_REDIRECTS,
            });
          if (registrationForbidden === "forbidden" || path !== "/callback")
            return json(response, 403, REGISTRATION_FORBIDDEN);
          return json(response, 201, {
            client_id: id,
            token_endpoint_auth_method: "none",
            redirect_uris: DROPBOX_REDIRECTS,
          });
        }
        const method = asked.token_endpoint_auth_method ?? "client_secret_basic";
        if (registrationRefused) return json(response, 400, REGISTRATION_REFUSALS[registrationRefused]);
        if (!authMethods.includes(method))
          return json(response, 400, {
            code: "SC400",
            name: "APIError",
            message: "No supported Token Endpoint Auth Method provided.",
          });
        return json(response, 201, {
          client_id: id,
          ...(method === "none" && !secretForPublic ? {} : { client_secret: CLIENT_SECRET }),
          token_endpoint_auth_method: method,
          redirect_uris: asked.redirect_uris,
        });
      }
      if (request.method === "POST" && path === "/token") {
        const form = new URLSearchParams(await body(request));
        state.redirects.push(`token ${form.get("redirect_uri")}`);
        const withSecret = request.headers.authorization !== undefined || form.has("client_secret");
        state.tokenRequestsWithSecret.push(withSecret);
        const secretInBody = request.headers.authorization === undefined && form.get("client_secret") === CLIENT_SECRET;
        if (secretAccepted ? !secretInBody : withSecret)
          return json(response, 401, { error: "invalid_client", error_description: "client authentication failed" });
        if (tokenForbidden) return json(response, 403, { message: "403 Forbidden" });
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
      if (accountRefused === "forbidden") return json(response, 403, { message: "403 Forbidden" });
      if (accountRefused === "insufficientScope")
        return json(
          response,
          403,
          { error: "insufficient_scope" },
          {
            "www-authenticate": `Bearer error="insufficient_scope", scope="mcp", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          },
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

async function runCase(
  name: string,
  authMethods: string[],
  attempts: number,
  {
    storedDiscovery = false,
    secretAccepted = false,
    registrationRefused = null,
    scopes = {},
    registrationForbidden = null,
    storedClient = null,
    relayDeepLink,
    accountRefused = null,
    tokenForbidden = false,
    storedTokens = false,
    secretForPublic = false,
  }: {
    storedDiscovery?: boolean;
    secretAccepted?: boolean;
    registrationRefused?: RegistrationRefusal | null;
    scopes?: ScopeMetadata;
    registrationForbidden?: RegistrationForbidden | null;
    storedClient?: string | null;
    relayDeepLink?: string | null;
    accountRefused?: AccountRefusal | null;
    tokenForbidden?: boolean;
    storedTokens?: boolean;
    secretForPublic?: boolean;
  } = {},
): Promise<Case> {
  const server = await fakeServer(
    authMethods,
    secretAccepted,
    registrationRefused,
    scopes,
    registrationForbidden,
    accountRefused,
    tokenForbidden,
    secretForPublic,
  );
  const records = new Map<string, McpOAuthRecord>();
  if (storedClient)
    records.set(server.url, {
      client: {
        client_id: storedClient,
        token_endpoint_auth_method: "none",
        redirect_uris: DROPBOX_REDIRECTS,
        issuer: new URL(server.url).origin,
      },
    });
  if (storedTokens)
    records.set(server.url, {
      client: { client_id: "e2e-client", token_endpoint_auth_method: "none", redirect_uris: [] },
      tokens: { access_token: ACCESS_TOKEN, token_type: "Bearer", expires_in: 3600 },
      obtainedAt: Date.now(),
      discovery: {
        authorizationServerUrl: new URL(server.url).origin,
        resourceMetadataUrl: `${new URL(server.url).origin}/.well-known/oauth-protected-resource/mcp`,
      },
    });
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
    openExternal: async (page) => {
      server.pagesOpened.push(page);
      server.redirects.push(`page ${new URL(page).searchParams.get("redirect_uri")}`);
      const state = new URL(page).searchParams.get("state");
      assert.ok(state, "the page has a state");
      setTimeout(() => oauth.receiveAuthorizationCode(state, "e2e-grant"), 50);
    },
    redirectUrl: "http://127.0.0.1:28417/mcp-auth",
    signInTimeoutMs: 10_000,
  });
  let attempt = 0;
  const relayed = async (page: string) => {
    server.pagesOpened.push(page);
    server.redirects.push(`page ${new URL(page).searchParams.get("redirect_uri")}`);
    const state = new URL(page).searchParams.get("state");
    assert.ok(state, "the page has a state");
    setTimeout(() => {
      if (attempt < attempts - 1) oauth.cancelSignIn(server.url);
      else oauth.receiveAuthorizationCode(state, "e2e-grant");
    }, 50);
  };
  try {
    const authority = {
      accessToken: (url: string) => oauth.accessToken(url),
      signIn: (url: string) =>
        relayDeepLink === undefined ? oauth.signIn(url) : oauth.signIn(url, relayed, relayDeepLink ?? undefined),
    };
    const results: Case["attempts"] = [];
    for (attempt = 0; attempt < attempts; attempt++)
      results.push(await runCauseEffect(testMcpServer(httpConfig(server.url), 10_000, undefined, authority, "here")));
    const silent = { accessToken: (url: string) => oauth.accessToken(url), signIn: () => null };
    const silentTest = accountRefused
      ? await runCauseEffect(inspectMcpServer(httpConfig(server.url), 10_000, undefined, silent, "here"))
      : null;
    return {
      name,
      attempts: results,
      ...(silentTest ? { silentTest: { error: silentTest.error, needs: silentTest.needs } } : {}),
      registrations: [...server.registrations],
      registrationScopes: [...server.registrationScopes],
      pageScopes: server.pagesOpened.map((page) => new URL(page).searchParams.get("scope")),
      tokenRequestsWithSecret: [...server.tokenRequestsWithSecret],
      toolLists: [...server.toolLists],
      pagesOpened: server.pagesOpened.length,
      redirects: [...server.redirects],
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
    const listed = await runCase("public-client-when-listed", ["client_secret_basic", "client_secret_post", "none"], 1);
    const [first] = listed.attempts;
    check(listed, first?.error === null, `the sign-in failed: ${first?.error}`);
    check(listed, first?.toolCount === 1, "the tools were not listed after the sign-in");
    check(listed, listed.registrations.join() === "none", `the registration asked for ${listed.registrations.join()}`);
    check(listed, listed.tokenRequestsWithSecret.join() === "false", "a token request carried a client secret");
    check(listed, listed.signedIn, "no token is stored after the sign-in");
    report.cases.push(listed);

    const cached = await runCase("public-client-with-stored-discovery", ["client_secret_basic", "none"], 1, {
      storedDiscovery: true,
    });
    check(cached, cached.attempts[0]?.error === null, `the sign-in failed: ${cached.attempts[0]?.error}`);
    check(cached, cached.registrations.join() === "none", `the registration asked for ${cached.registrations.join()}`);
    check(cached, cached.tokenRequestsWithSecret.join() === "false", "a token request carried a client secret");
    check(cached, cached.signedIn, "no token is stored after the sign-in");
    report.cases.push(cached);

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

    const revenueCat = await runCase("registration-refused-invalid-client", ["client_secret_basic", "none"], 2, {
      registrationRefused: "revenueCat",
    });
    const registrationRefused = sourceText("error.backend.mcpRegistrationRefused");
    for (const [index, attempt] of revenueCat.attempts.entries())
      check(revenueCat, attempt.error === registrationRefused, `attempt ${index + 1} reported: ${attempt.error}`);
    check(
      revenueCat,
      revenueCat.registrations.join() === "none,none,none,none",
      `the registrations were ${revenueCat.registrations.join()}`,
    );
    check(revenueCat, revenueCat.pagesOpened === 0, "a sign-in page opened with no registered client");
    check(revenueCat, !revenueCat.storedClient, "a client is stored after a refused registration");
    check(revenueCat, !revenueCat.signedIn, "a token is stored after a refused registration");
    report.cases.push(revenueCat);

    const omnisend = await runCase("registration-refused-unknown-application", ["none"], 2, {
      registrationRefused: "omnisend",
    });
    for (const [index, attempt] of omnisend.attempts.entries())
      check(omnisend, attempt.error === registrationRefused, `attempt ${index + 1} reported: ${attempt.error}`);
    check(omnisend, omnisend.pagesOpened === 0, "a sign-in page opened with no registered client");
    check(omnisend, !omnisend.storedClient, "a client is stored after a refused registration");
    check(omnisend, !omnisend.signedIn, "a token is stored after a refused registration");
    report.cases.push(omnisend);

    const tessie = await runCase("registration-refused-no-template", ["none"], 1, { registrationRefused: "tessie" });
    const [tessieAttempt] = tessie.attempts;
    check(tessie, tessieAttempt?.error === registrationRefused, `the attempt reported: ${tessieAttempt?.error}`);
    check(tessie, tessie.pagesOpened === 0, "a sign-in page opened with no registered client");
    check(tessie, !tessie.storedClient, "a client is stored after a refused registration");
    check(tessie, !tessie.signedIn, "a token is stored after a refused registration");
    report.cases.push(tessie);

    const accountRefused = sourceText("error.backend.mcpSignInAccountRefused");
    const gitlab = await runCase("account-refused-after-sign-in", ["none"], 1, { accountRefused: "forbidden" });
    const [signInAttempt] = gitlab.attempts;
    check(gitlab, signInAttempt?.error === accountRefused, `the sign-in reported: ${signInAttempt?.error}`);
    check(gitlab, gitlab.signedIn, "no token is stored after the sign-in");
    check(
      gitlab,
      gitlab.silentTest?.error === accountRefused,
      `the Test with the saved sign-in reported: ${gitlab.silentTest?.error}`,
    );
    check(gitlab, gitlab.silentTest?.needs === null, `the Test asked for: ${gitlab.silentTest?.needs}`);
    report.cases.push(gitlab);

    const stepUp = await runCase("account-scope-step-up", ["none"], 0, {
      accountRefused: "insufficientScope",
      storedTokens: true,
    });
    const signInRequired = sourceText("error.backend.mcpSignInRequired");
    check(
      stepUp,
      stepUp.silentTest?.error === signInRequired,
      `the Test with the saved sign-in reported: ${stepUp.silentTest?.error}`,
    );
    check(stepUp, stepUp.silentTest?.needs === "sign_in", `the Test asked for: ${stepUp.silentTest?.needs}`);
    report.cases.push(stepUp);

    const enrich = await runCase("public-registration-with-secret", ["client_secret_post", "none"], 1, {
      secretAccepted: true,
      secretForPublic: true,
    });
    check(enrich, enrich.attempts[0]?.error === null, `the sign-in failed: ${enrich.attempts[0]?.error}`);
    check(enrich, enrich.attempts[0]?.toolCount === 1, "the tools were not listed after the sign-in");
    check(enrich, enrich.registrations.join() === "none", `the registration asked for ${enrich.registrations.join()}`);
    check(
      enrich,
      enrich.tokenRequestsWithSecret.join() === "true",
      "the token request did not carry the client secret",
    );
    check(enrich, enrich.signedIn, "no token is stored after the sign-in");
    report.cases.push(enrich);

    const tokenRefused = await runCase("token-endpoint-forbidden", ["none"], 1, { tokenForbidden: true });
    const notAccepted = sourceText("error.backend.mcpSignInNotAccepted");
    check(
      tokenRefused,
      tokenRefused.attempts[0]?.error === notAccepted,
      `the sign-in reported: ${tokenRefused.attempts[0]?.error}`,
    );
    check(tokenRefused, !tokenRefused.signedIn, "a token is stored after a refused grant");
    report.cases.push(tokenRefused);

    const callback = "http://127.0.0.1:28417/callback";
    const dropbox = await runCase("registration-forbidden-except-callback", ["none"], 1, {
      registrationForbidden: "dropbox",
    });
    check(dropbox, dropbox.attempts[0]?.error === null, `the sign-in failed: ${dropbox.attempts[0]?.error}`);
    check(dropbox, dropbox.attempts[0]?.toolCount === 1, "the tools were not listed after the sign-in");
    check(
      dropbox,
      dropbox.redirects.join() ===
        [
          "register http://127.0.0.1:28417/mcp-auth",
          `register ${callback}`,
          `page ${callback}`,
          `token ${callback}`,
        ].join(),
      `the addresses were ${dropbox.redirects.join()}`,
    );
    check(dropbox, dropbox.storedClient, "no client is stored after the sign-in");
    check(dropbox, dropbox.signedIn, "no token is stored after the sign-in");
    report.cases.push(dropbox);

    const dropboxStored = await runCase("registration-with-no-port-used-again", ["none"], 1, {
      registrationForbidden: "dropbox",
      storedClient: "e2e-dropbox-client",
    });
    check(
      dropboxStored,
      dropboxStored.attempts[0]?.error === null,
      `the sign-in failed: ${dropboxStored.attempts[0]?.error}`,
    );
    check(
      dropboxStored,
      dropboxStored.redirects.join() === [`page ${callback}`, `token ${callback}`].join(),
      `the addresses were ${dropboxStored.redirects.join()}`,
    );
    check(dropboxStored, dropboxStored.signedIn, "no token is stored after the sign-in");
    report.cases.push(dropboxStored);

    const namecheap = await runCase("registration-replaces-address-except-callback", ["none"], 1, {
      registrationForbidden: "namecheap",
    });
    check(namecheap, namecheap.attempts[0]?.error === null, `the sign-in failed: ${namecheap.attempts[0]?.error}`);
    check(
      namecheap,
      namecheap.redirects.join() ===
        [
          "register http://127.0.0.1:28417/mcp-auth",
          `register ${callback}`,
          `page ${callback}`,
          `token ${callback}`,
        ].join(),
      `the addresses were ${namecheap.redirects.join()}`,
    );
    check(namecheap, namecheap.signedIn, "no token is stored after the sign-in");
    report.cases.push(namecheap);

    const forbidden = await runCase("registration-forbidden", ["none"], 1, { registrationForbidden: "forbidden" });
    check(
      forbidden,
      forbidden.attempts[0]?.error === registrationRefused,
      `the attempt reported: ${forbidden.attempts[0]?.error}`,
    );
    check(forbidden, forbidden.pagesOpened === 0, "a sign-in page opened with no registered client");
    check(forbidden, !forbidden.signedIn, "a token is stored after a refused registration");
    report.cases.push(forbidden);

    const entraScopes = ["api://e2e-resource/.default", "offline_access", "openid", "email"];
    const scopeCases: { name: string; scopes: ScopeMetadata; expected: string | null }[] = [
      {
        name: "scope-from-authorization-server",
        scopes: { resource: null, server: entraScopes },
        expected: entraScopes.join(" "),
      },
      {
        name: "scope-from-resource-metadata",
        scopes: { resource: ["read"], server: entraScopes },
        expected: "read offline_access",
      },
      { name: "no-scope-in-resource-metadata", scopes: { resource: [], server: entraScopes }, expected: null },
      { name: "no-scope-anywhere", scopes: { resource: null }, expected: null },
    ];
    const loopback = "http://127.0.0.1:28417/mcp-auth";
    const localhost = "http://localhost:28417/mcp-auth";
    const deepLink = "openbot://mcp-auth";
    const pages = (entry: Case) =>
      entry.redirects.filter((line) => line.startsWith("page ")).map((line) => line.slice("page ".length));
    const relayed = await runCase("relay-with-deep-link", ["none"], 3, { relayDeepLink: deepLink });
    check(
      relayed,
      pages(relayed).join(" ") === [loopback, localhost, deepLink].join(" "),
      `the pages returned to ${pages(relayed).join(", ")}`,
    );
    check(relayed, relayed.redirects.includes(`register ${deepLink}`), "the deep link was not registered");
    check(relayed, relayed.redirects.at(-1) === `token ${deepLink}`, "the token request did not name the link");
    check(relayed, relayed.attempts[2]?.error === null, `the third sign-in failed: ${relayed.attempts[2]?.error}`);
    check(relayed, relayed.signedIn, "no token is stored after the sign-in");
    report.cases.push(relayed);
    const relayedLoopback = await runCase("relay-without-deep-link", ["none"], 3, { relayDeepLink: null });
    check(
      relayedLoopback,
      pages(relayedLoopback).join(" ") === [loopback, localhost, loopback].join(" "),
      `the pages returned to ${pages(relayedLoopback).join(", ")}`,
    );
    check(
      relayedLoopback,
      !relayedLoopback.redirects.some((line) => line.includes(deepLink)),
      "a client without the link got it",
    );
    check(relayedLoopback, relayedLoopback.signedIn, "no token is stored after the sign-in");
    report.cases.push(relayedLoopback);

    for (const { name, scopes, expected } of scopeCases) {
      const entry = await runCase(name, ["none"], 1, { scopes });
      check(entry, entry.attempts[0]?.error === null, `the sign-in failed: ${entry.attempts[0]?.error}`);
      check(entry, entry.pageScopes.join() === (expected ?? ""), `the page asked for ${entry.pageScopes.join()}`);
      check(
        entry,
        entry.registrationScopes.join() === (expected ?? ""),
        `the registration asked for ${entry.registrationScopes.join()}`,
      );
      check(entry, entry.signedIn, "no token is stored after the sign-in");
      report.cases.push(entry);
    }
  } catch (error) {
    report.failures.push(error instanceof Error ? error.message : String(error));
  }
  report.passed = report.failures.length === 0 && report.cases.every((entry) => entry.failures.length === 0);
  await writeFile(resolve(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

await main();
