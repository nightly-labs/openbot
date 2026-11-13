// Drives the MCP probe and McpOAuth against a local MCP server for issue #3429.
// bun scripts/mcp-sign-in-client-refused-e2e.ts
// The authorization server acts as Railway's does: registration gives a client secret, and the token
// endpoint refuses every request that carries that secret. A public client (`none`) is accepted.
// A server that lists `none` must get a public registration and a working sign-in. A server that
// does not list it gets a secret client, and the refusal must say that the server did not accept
// OpenBot, not the SDK's "Existing OAuth client information is required" text.
// Make lists only `client_secret_post` and refuses a registration that names no method it lists.
// RevenueCat (#4884) registers only the clients it approved and answers every other registration
// with 400 `invalid_client`: the refusal must say so, not quote "The client is not registered.".
// Omnisend (#7722) registers only the app names it approved and answers OpenBot with 400
// `invalid_client_metadata` "unknown application: OpenBot": the refusal must say so too. The same
// error about other metadata keeps the server's own words.
// Microsoft 365 (#7812) has no protected-resource metadata and names no scope in its challenge, and
// Microsoft refuses a sign-in page with no scope: OpenBot must ask for the scopes that its
// authorization server lists. A resource with metadata keeps the scope it names, or none.
// Dropbox (#8025) answers a registration with 403 `registration_not_supported` unless its loopback
// path is one that it knows, such as `/callback`, and registers its loopback addresses with no port:
// OpenBot must register the `/callback` form, send it, and use that registration again.
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
  scope: z.string().optional(),
  redirect_uris: z.array(z.string()),
});
const rpcRequest = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string() });

interface FakeServer {
  url: string;
  /** The `token_endpoint_auth_method` each registration asked for, in order. */
  registrations: (string | null)[];
  /** The `scope` each registration asked for, in order. */
  registrationScopes: (string | null)[];
  /** Whether each token request carried the client secret, in order. */
  tokenRequestsWithSecret: boolean[];
  /** One entry for each `tools/list` that carried the token. */
  toolLists: boolean[];
  /** One entry for each authorization page that the sign-in opened. */
  pagesOpened: string[];
  /** The `redirect_uri` of each registration and token request, in order. */
  redirects: string[];
  close: () => Promise<void>;
}

interface Case {
  name: string;
  attempts: { toolCount: number; error: string | null }[];
  registrations: (string | null)[];
  registrationScopes: (string | null)[];
  /** The `scope` of each sign-in page that opened, in order. */
  pageScopes: (string | null)[];
  tokenRequestsWithSecret: boolean[];
  toolLists: boolean[];
  pagesOpened: number;
  /** The `redirect_uri` of each registration, sign-in page and token request, in order. */
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

/** The 400 body of a registration that is refused, word for word from the service that answers it. */
const REGISTRATION_REFUSALS = {
  revenueCat: {
    error: "invalid_client",
    error_description: "The client is not registered. Contact support if you need to register a new client.",
  },
  omnisend: { error: "invalid_client_metadata", error_description: "unknown application: OpenBot" },
  badMetadata: { error: "invalid_client_metadata", error_description: "redirect URI must have a host" },
} as const;
type RegistrationRefusal = keyof typeof REGISTRATION_REFUSALS;

/** Dropbox's 403 body, word for word. `dropbox` accepts `/callback`; `forbidden` accepts no path. */
const REGISTRATION_FORBIDDEN = {
  error: "registration_not_supported",
  error_description:
    "Dynamic client registration is not supported. Only pre-registered MCP trusted partners are allowed.",
};
type RegistrationForbidden = "dropbox" | "forbidden";

/** The loopback addresses that Dropbox registers, whatever the registration asked for. */
const DROPBOX_REDIRECTS = ["http://localhost/callback", "http://127.0.0.1/callback", "http://127.0.0.1"];

/** The `scopes_supported` of each metadata document. */
interface ScopeMetadata {
  /** Of the protected-resource metadata. `null` answers that document with 404. */
  resource?: string[] | null;
  /** Of the authorization server metadata. */
  server?: string[];
}

/**
 * `secretAccepted` is Make: the token endpoint takes the secret in the body. Without it, the server
 * is Railway and refuses every secret it issued. With `registrationRefused`, no registration is
 * accepted.
 */
async function fakeServer(
  authMethods: string[],
  secretAccepted: boolean,
  registrationRefused: RegistrationRefusal | null,
  scopes: ScopeMetadata = {},
  registrationForbidden: RegistrationForbidden | null = null,
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
          if (registrationForbidden === "forbidden" || path !== "/callback")
            return json(response, 403, REGISTRATION_FORBIDDEN);
          return json(response, 201, {
            client_id: id,
            token_endpoint_auth_method: "none",
            redirect_uris: DROPBOX_REDIRECTS,
          });
        }
        // RFC 7591: a registration that names no method asks for `client_secret_basic`.
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
          ...(method === "none" ? {} : { client_secret: CLIENT_SECRET }),
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
  {
    storedDiscovery = false,
    secretAccepted = false,
    registrationRefused = null,
    scopes = {},
    registrationForbidden = null,
    storedClient = null,
  }: {
    storedDiscovery?: boolean;
    secretAccepted?: boolean;
    registrationRefused?: RegistrationRefusal | null;
    scopes?: ScopeMetadata;
    registrationForbidden?: RegistrationForbidden | null;
    /** A Dropbox registration already on file, with no tokens. */
    storedClient?: string | null;
  } = {},
): Promise<Case> {
  const server = await fakeServer(authMethods, secretAccepted, registrationRefused, scopes, registrationForbidden);
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
      server.pagesOpened.push(page);
      server.redirects.push(`page ${new URL(page).searchParams.get("redirect_uri")}`);
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

    // RevenueCat refuses the registration with 400 `invalid_client`. In each attempt, the SDK
    // registers once more after it drops the credentials, both times as a public client. Then the
    // probe says that the server does not accept OpenBot.
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

    // Omnisend refuses the name with 400 `invalid_client_metadata`. The probe says that the server
    // does not accept OpenBot, not "unknown application: OpenBot".
    const omnisend = await runCase("registration-refused-unknown-application", ["none"], 2, {
      registrationRefused: "omnisend",
    });
    for (const [index, attempt] of omnisend.attempts.entries())
      check(omnisend, attempt.error === registrationRefused, `attempt ${index + 1} reported: ${attempt.error}`);
    check(omnisend, omnisend.pagesOpened === 0, "a sign-in page opened with no registered client");
    check(omnisend, !omnisend.storedClient, "a client is stored after a refused registration");
    check(omnisend, !omnisend.signedIn, "a token is stored after a refused registration");
    report.cases.push(omnisend);

    // The same error about metadata that does not name OpenBot is not a refusal of OpenBot.
    const badMetadata = await runCase("registration-bad-metadata", ["none"], 1, { registrationRefused: "badMetadata" });
    const [metadataAttempt] = badMetadata.attempts;
    check(
      badMetadata,
      metadataAttempt?.error !== registrationRefused && metadataAttempt?.error?.includes("must have a host") === true,
      `the attempt reported: ${metadataAttempt?.error}`,
    );
    check(badMetadata, !badMetadata.signedIn, "a token is stored after a refused registration");
    report.cases.push(badMetadata);

    // Dropbox refuses `/mcp-auth` with 403. OpenBot registers the `/callback` form once more and
    // sends it on the page and in the token request, although the registration names no port.
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

    // The next sign-in uses the Dropbox registration on file, which names no port, and registers nothing.
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

    // A server that refuses every registration with 403 still gets the sentence that it does not accept OpenBot.
    const forbidden = await runCase("registration-forbidden", ["none"], 1, { registrationForbidden: "forbidden" });
    check(
      forbidden,
      forbidden.attempts[0]?.error === registrationRefused,
      `the attempt reported: ${forbidden.attempts[0]?.error}`,
    );
    check(forbidden, forbidden.pagesOpened === 0, "a sign-in page opened with no registered client");
    check(forbidden, !forbidden.signedIn, "a token is stored after a refused registration");
    report.cases.push(forbidden);

    // Microsoft 365 (#7812): the challenge names a resource metadata address that answers 404, and
    // only the authorization server lists scopes. The page and the registration ask for that list.
    const entraScopes = ["api://e2e-resource/.default", "offline_access", "openid", "email"];
    const scopeCases: { name: string; scopes: ScopeMetadata; expected: string | null }[] = [
      {
        name: "scope-from-authorization-server",
        scopes: { resource: null, server: entraScopes },
        expected: entraScopes.join(" "),
      },
      // A resource with metadata keeps the scope it names (with `offline_access`), or none.
      {
        name: "scope-from-resource-metadata",
        scopes: { resource: ["read"], server: entraScopes },
        expected: "read offline_access",
      },
      { name: "no-scope-in-resource-metadata", scopes: { resource: [], server: entraScopes }, expected: null },
      { name: "no-scope-anywhere", scopes: { resource: null }, expected: null },
    ];
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
