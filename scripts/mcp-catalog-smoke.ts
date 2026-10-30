// Checks each http MCP server in the Marketplace catalog against the live server, with no account
// and no key. A server with no sign-in must answer `initialize`. A server with a `link` sign-in must
// refuse it with a Bearer challenge, and its metadata must offer what `McpOAuth` needs: dynamic
// registration and S256 PKCE. Metadata goes through `secureOAuthFetch`, so the app's https, size,
// time, redirect and private-network rules apply. The script never registers a client and never
// sends a credential.
//
// It needs the network and the vendors' servers, so it is a manual run, not a CI gate.
// `bun run test:mcp-catalog`. Writes .openbot-build/mcp-catalog-smoke/report.json.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  extractResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { secureOAuthFetch } from "../src/backend/mcp-oauth-provider";
import { hostAddresses, isPublicAddress, systemAddressLookup } from "../src/backend/network-address";
import { defaultPluginCatalogPaths, loadPluginCatalog, type PluginApp } from "./build-plugin-catalog";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-catalog-smoke");
const TIMEOUT_MS = 20_000;
const logger = createOpenBotLogger("mcp-catalog-smoke");

/** `open`: the catalog names no sign-in. `link`: the user signs in in the browser. */
type Kind = "open" | "link";

interface Checked {
  slug: string;
  app: string;
  url: string;
  kind: Kind;
  ok: boolean;
  failure: string | null;
  details: OpenDetails | LinkDetails | null;
  /** Every request the check sent, as `METHOD url`. */
  requests: string[];
}

interface OpenDetails {
  server: string;
  tools: boolean;
}

interface LinkDetails {
  challenge: string;
  resourceMetadataUrl: string | null;
  issuer: string;
  registrationEndpoint: string;
  revocation: boolean;
}

interface Skipped {
  slug: string;
  app: string;
  reason: string;
}

/** The server to check and how, or why the entry is out of scope. */
function scope(app: PluginApp): { kind: Kind; url: string } | { reason: string } {
  const server = app.server;
  if (server.transport !== "http") return { reason: "stdio server" };
  const kinds = new Set((server.auth ?? []).map((flow) => flow.kind));
  if (kinds.has("link")) return { kind: "link", url: server.url };
  if (kinds.size === 0) return { kind: "open", url: server.url };
  return { reason: `${[...kinds].join(" and ")} sign-in: needs the user's key or computer` };
}

class CheckFailed extends Error {}

function check(condition: unknown, failure: string): asserts condition {
  if (!condition) throw new CheckFailed(failure);
}

/** A fetch that records each request, and refuses a POST anywhere but the MCP server, redirects included. */
function recording(fetchFn: FetchLike, url: string, requests: string[]): FetchLike {
  const server = withoutHash(new URL(url));
  return (input, init) => {
    const target = new URL(input instanceof URL ? input.toString() : input);
    const method = init?.method ?? "GET";
    requests.push(`${method} ${withoutHash(target)}`);
    // Registration and token requests are POSTs to the authorization server. This check sends none.
    if (method !== "GET" && withoutHash(target) !== server)
      return Promise.reject(new Error(`Refused ${method} to ${target.origin}: the smoke never registers.`));
    // A followed 307 or 308 sends the POST again to its target, past the check above.
    return fetchFn(input, method === "GET" ? init : { ...init, redirect: "manual" });
  };
}

function withoutHash(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`;
}

/**
 * The SDK transport classes declare their handlers and `sessionId` as `T | undefined`, which
 * `exactOptionalPropertyTypes` does not accept as a `Transport`. This one forwards to such a class.
 */
function asTransport(inner: {
  start(): Promise<void>;
  send: Transport["send"];
  close(): Promise<void>;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
  onmessage?: Transport["onmessage"] | undefined;
  setProtocolVersion?: ((version: string) => void) | undefined;
}): Transport {
  const transport: Transport = {
    start: () => {
      inner.onclose = () => transport.onclose?.();
      inner.onerror = (error) => transport.onerror?.(error);
      inner.onmessage = (message, extra) => transport.onmessage?.(message, extra);
      return inner.start();
    },
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion?.(version),
  };
  return transport;
}

/** An open server answers `initialize` from the SDK client with no credential. */
async function checkOpen(url: string, requests: string[]): Promise<OpenDetails> {
  const client = new Client({ name: "openbot-catalog-smoke", version: "1.0.0" });
  const transport = asTransport(
    new StreamableHTTPClientTransport(new URL(url), {
      fetch: recording((input, init) => fetch(input, init), url, requests),
    }),
  );
  try {
    await client.connect(transport, { timeout: TIMEOUT_MS });
    const server = client.getServerVersion();
    check(server, "initialize returned no server information");
    return { server: `${server.name} ${server.version}`, tools: client.getServerCapabilities()?.tools !== undefined };
  } finally {
    await client.close();
  }
}

/**
 * A sign-in server refuses `initialize` with a Bearer challenge, then names an authorization server
 * that registers clients and supports S256. The endpoints that get credentials in a real sign-in
 * must use https and public addresses, as `secureOAuthFetch` requires when it sends to them.
 */
async function checkLink(url: string, requests: string[]): Promise<LinkDetails> {
  const answer = await recording(
    (input, init) => fetch(input, init),
    url,
    requests,
  )(url, {
    method: "POST",
    headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "openbot-catalog-smoke", version: "1.0.0" },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await answer.body?.cancel();
  check(answer.status === 401, `initialize with no sign-in answered ${answer.status}, not 401`);
  const challenge = answer.headers.get("www-authenticate") ?? "";
  check(/^bearer\b/i.test(challenge), "the 401 has no Bearer challenge");

  const oauthFetch = recording(secureOAuthFetch({ resource: url }), url, requests);
  const resourceMetadataUrl = extractResourceMetadataUrl(answer);
  const resource = await discoverOAuthProtectedResourceMetadata(
    url,
    resourceMetadataUrl ? { resourceMetadataUrl } : undefined,
    oauthFetch,
  );
  const issuer = resource.authorization_servers?.[0];
  check(issuer, "the protected-resource metadata names no authorization server");
  const metadata = await discoverAuthorizationServerMetadata(issuer, { fetchFn: oauthFetch });
  check(metadata, `no authorization server metadata at ${issuer}`);
  check(metadata.registration_endpoint, "no registration_endpoint: the user would need a sign-in app");
  check(metadata.code_challenge_methods_supported?.includes("S256"), "S256 PKCE is not listed");
  check(metadata.response_types_supported.includes("code"), "response type code is not supported");

  const revocation = "revocation_endpoint" in metadata ? metadata.revocation_endpoint : undefined;
  const endpoints = [
    metadata.authorization_endpoint,
    metadata.token_endpoint,
    metadata.registration_endpoint,
    revocation,
  ].filter((endpoint) => endpoint !== undefined);
  for (const endpoint of endpoints) {
    const target = new URL(endpoint);
    check(target.protocol === "https:", `${target.origin} does not use https`);
    const addresses = await runCauseEffect(hostAddresses(target, systemAddressLookup));
    check(addresses.length > 0 && addresses.every(isPublicAddress), `${target.origin} is on a private network`);
  }
  return {
    challenge,
    resourceMetadataUrl: resourceMetadataUrl?.toString() ?? null,
    issuer,
    registrationEndpoint: metadata.registration_endpoint,
    revocation: revocation !== undefined,
  };
}

async function main(): Promise<void> {
  const { plugins } = await loadPluginCatalog(defaultPluginCatalogPaths().sourceRoot);
  const checked: Checked[] = [];
  const skipped: Skipped[] = [];
  for (const plugin of plugins) {
    for (const app of plugin.apps) {
      const target = scope(app);
      if ("reason" in target) {
        skipped.push({ slug: plugin.slug, app: app.id, reason: target.reason });
        continue;
      }
      const { kind, url } = target;
      const requests: string[] = [];
      let entry: Checked;
      try {
        const details = kind === "open" ? await checkOpen(url, requests) : await checkLink(url, requests);
        entry = { slug: plugin.slug, app: app.id, url, kind, ok: true, failure: null, details, requests };
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        entry = { slug: plugin.slug, app: app.id, url, kind, ok: false, failure, details: null, requests };
      }
      checked.push(entry);
      if (entry.ok) logger.info("Catalog server passed.", { slug: entry.slug, kind });
      else logger.error("Catalog server failed.", { slug: entry.slug, kind, failure: entry.failure });
    }
  }
  const failed = checked.filter((entry) => !entry.ok).map((entry) => entry.slug);
  const report = { ok: failed.length === 0, checkedAt: new Date().toISOString(), failed, checked, skipped };
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info("Wrote the catalog report.", {
    path: ".openbot-build/mcp-catalog-smoke/report.json",
    checked: checked.length,
    skipped: skipped.length,
    failed,
  });
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  logger.error("The catalog smoke stopped.", toLogValue(error));
  process.exitCode = 1;
});
