import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mcpAccountUrl } from "@openbot/contracts/mcp-accounts";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  McpOAuth,
  type McpOAuthRecord,
  mcpOAuthAccountKey,
  mcpOAuthRecordSchema,
  normalizeResource,
} from "../src/backend/mcp-oauth-provider";
import { McpOAuthStore } from "../src/main/mcp-oauth-store";
import type { SecretCipher } from "../src/main/provider-credential-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-oauth-store-e2e");
const NOTION = "https://mcp.notion.com/mcp";
const VERCEL = "https://mcp.vercel.com/";
const STRIPE = "https://mcp.stripe.com/";
const REDIRECT_URL = "http://127.0.0.1:28417/mcp-auth";
const UNREADABLE = sourceText("error.mcp.signInFileUnreadable");

function cipher(key: string): SecretCipher {
  const prefix = `${key}:`;
  return {
    encrypt: (value) => Buffer.from(`${prefix}${value}`, "utf8"),
    decrypt: (value) => {
      const text = value.toString("utf8");
      if (!text.startsWith(prefix)) throw new Error("decrypt failed");
      return text.slice(prefix.length);
    },
  };
}

function tokens(name: string): McpOAuthRecord {
  return mcpOAuthRecordSchema.parse({
    tokens: { access_token: `${name}-access`, token_type: "Bearer", refresh_token: `${name}-refresh` },
  });
}

function registration(name: string): McpOAuthRecord {
  return mcpOAuthRecordSchema.parse({
    client: { client_id: `${name}-client`, redirect_uris: [REDIRECT_URL] },
  });
}

function encryptRecord(key: string, record: McpOAuthRecord): string {
  return cipher(key).encrypt(JSON.stringify(record)).toString("base64");
}

const envelopeSchema = z.object({
  version: z.literal(1),
  servers: z.record(z.string(), z.string()),
});

async function servers(path: string) {
  return envelopeSchema.parse(JSON.parse(await readFile(path, "utf8"))).servers;
}

async function writeEnvelope(path: string, rows: Record<string, string>): Promise<void> {
  await writeFile(path, `${JSON.stringify({ version: 1, servers: rows })}\n`);
}

async function expectRows(path: string, expected: Record<string, string>): Promise<void> {
  const actual = await servers(path);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const [resource, encrypted] of Object.entries(expected)) assert.equal(actual[resource], encrypted);
}

async function expectUnreadable(operation: Effect.Effect<void, { readonly cause: unknown }>): Promise<void> {
  await assert.rejects(runCauseEffect(operation), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, UNREADABLE);
    return true;
  });
}

async function startAuthorizationServer() {
  const seen: string[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", base);
    const body = await readBody(request);
    seen.push(`${request.url ?? ""} ${body}`);
    answer(url.pathname, request, response, body);
  });
  function answer(path: string, request: IncomingMessage, response: ServerResponse, body: string) {
    if (path === "/.well-known/oauth-authorization-server")
      return json(response, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (path === "/.well-known/oauth-protected-resource/mcp")
      return json(response, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    if (path === "/register")
      return json(response, 201, {
        client_id: "registered",
        redirect_uris: [REDIRECT_URL],
        token_endpoint_auth_method: "none",
      });
    if (path === "/token" && request.method === "POST") {
      const code = new URLSearchParams(body).get("code") ?? "";
      return json(response, 200, {
        access_token: `access-${code}`,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: `refresh-${code}`,
      });
    }
    json(response, 404, {});
  }
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  return { base, seen, close: () => new Promise<void>((done) => server.close(() => done())) };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let text = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      text += chunk;
    });
    request.on("end", () => done(text));
  });
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function connect(
  store: McpOAuthStore,
  url: string,
  finish: "sign-in" | "cancel",
  code = "signed-in",
): Promise<void> {
  let state: string | null = null;
  const oauth = new McpOAuth({
    storage: store,
    openExternal: async (page) => {
      state = new URL(page).searchParams.get("state");
    },
    redirectUrl: REDIRECT_URL,
  });
  try {
    const signIn = oauth.signIn(url);
    assert.ok(signIn);
    assert.equal(await runCauseEffect(signIn.begin()), true);
    assert.ok(state);
    if (finish === "cancel") {
      assert.equal(oauth.cancelSignIn(url), true);
      await assert.rejects(runCauseEffect(signIn.complete()));
      return;
    }
    assert.equal(oauth.receiveAuthorizationCode(state, code), true);
    await runCauseEffect(signIn.complete());
  } finally {
    await runCauseEffect(oauth.close());
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-mcp-oauth-store-"));
const auth = await startAuthorizationServer();

try {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const current = cipher("current");

  const lockedPath = join(root, "locked.json");
  const lockedRows = {
    [NOTION]: encryptRecord("previous", tokens("notion")),
    [VERCEL]: encryptRecord("previous", tokens("vercel")),
  };
  await writeEnvelope(lockedPath, lockedRows);
  const locked = new McpOAuthStore(lockedPath, current);
  assert.equal((await Effect.runPromise(locked.load()))?.message, UNREADABLE);
  assert.equal(locked.read(NOTION), null);
  await runCauseEffect(locked.write(NOTION, registration("notion")));
  assert.equal(locked.read(NOTION)?.client?.client_id, "notion-client");
  await expectRows(lockedPath, lockedRows);
  await runCauseEffect(locked.clear(NOTION));
  await expectRows(lockedPath, lockedRows);
  const registrationKeepsRows = { ok: true, servers: Object.keys(lockedRows).sort() };

  await runCauseEffect(locked.write(NOTION, registration("notion")));
  await runCauseEffect(locked.write(NOTION, { ...registration("notion"), ...tokens("notion-new") }));
  assert.deepEqual(locked.read(NOTION)?.tokens, tokens("notion-new").tokens);
  assert.equal(locked.read(VERCEL), null);
  const recovered = await servers(lockedPath);
  assert.equal(recovered[VERCEL], lockedRows[VERCEL]);
  assert.notEqual(recovered[NOTION], lockedRows[NOTION]);
  const reread = new McpOAuthStore(lockedPath, current);
  assert.equal(await Effect.runPromise(reread.load()), null);
  assert.deepEqual(reread.read(NOTION)?.tokens, tokens("notion-new").tokens);
  assert.equal(reread.read(NOTION)?.client?.client_id, "notion-client");
  assert.equal(reread.read(VERCEL), null);
  const completedSignInKeepsOthers = { ok: true, readable: [NOTION], unread: [VERCEL] };

  await runCauseEffect(reread.write(VERCEL, tokens("vercel-new")));
  const both = new McpOAuthStore(lockedPath, current);
  assert.equal(await Effect.runPromise(both.load()), null);
  assert.deepEqual(both.read(NOTION)?.tokens, tokens("notion-new").tokens);
  assert.deepEqual(both.read(VERCEL)?.tokens, tokens("vercel-new").tokens);
  const secondSignInRecoversRest = { ok: true, readable: [NOTION, VERCEL].sort() };

  const mixedPath = join(root, "mixed.json");
  const stripeRow = encryptRecord("previous", tokens("stripe"));
  await writeEnvelope(mixedPath, { [NOTION]: encryptRecord("current", tokens("notion")), [STRIPE]: stripeRow });
  const mixed = new McpOAuthStore(mixedPath, current);
  assert.equal(await Effect.runPromise(mixed.load()), null);
  assert.deepEqual(mixed.read(NOTION)?.tokens, tokens("notion").tokens);
  assert.equal(mixed.read(STRIPE), null);
  await runCauseEffect(mixed.write(STRIPE, registration("stripe")));
  assert.equal((await servers(mixedPath))[STRIPE], stripeRow);
  await runCauseEffect(mixed.write(STRIPE, tokens("stripe-new")));
  const mixedAfter = new McpOAuthStore(mixedPath, current);
  assert.equal(await Effect.runPromise(mixedAfter.load()), null);
  assert.deepEqual(mixedAfter.read(NOTION)?.tokens, tokens("notion").tokens);
  assert.deepEqual(mixedAfter.read(STRIPE)?.tokens, tokens("stripe-new").tokens);
  const partialDecrypt = { ok: true, kept: NOTION, recovered: STRIPE };

  const corruptPath = join(root, "corrupt.json");
  await writeFile(corruptPath, "{not-json");
  const corrupt = new McpOAuthStore(corruptPath, current);
  assert.equal((await Effect.runPromise(corrupt.load()))?.message, UNREADABLE);
  await runCauseEffect(corrupt.write(NOTION, tokens("notion")));
  assert.deepEqual(corrupt.read(NOTION)?.tokens, tokens("notion").tokens);
  const corruptReplaced = { ok: true };

  let refusedFile: { ok: boolean; skipped?: string } = { ok: true, skipped: "running as root" };
  if (process.getuid?.() !== 0) {
    const refusedPath = join(root, "refused.json");
    await writeEnvelope(refusedPath, lockedRows);
    await chmod(refusedPath, 0o000);
    const refused = new McpOAuthStore(refusedPath, current);
    assert.ok(await Effect.runPromise(refused.load()));
    await expectUnreadable(refused.write(NOTION, tokens("notion")));
    await runCauseEffect(refused.clear(NOTION));
    await chmod(refusedPath, 0o600);
    await expectRows(refusedPath, lockedRows);
    refusedFile = { ok: true };
  }

  const mcpUrl = `${auth.base}/mcp`;
  const resource = normalizeResource(mcpUrl);
  assert.ok(resource);
  const connectPath = join(root, "connect.json");
  const connectRows = {
    [resource]: encryptRecord("previous", tokens("local")),
    [VERCEL]: encryptRecord("previous", tokens("vercel")),
  };
  await writeEnvelope(connectPath, connectRows);
  const connectStore = new McpOAuthStore(connectPath, current);
  assert.equal((await Effect.runPromise(connectStore.load()))?.message, UNREADABLE);
  await connect(connectStore, mcpUrl, "cancel");
  await expectRows(connectPath, connectRows);
  await connect(connectStore, mcpUrl, "sign-in");
  const afterConnect = new McpOAuthStore(connectPath, current);
  assert.equal(await Effect.runPromise(afterConnect.load()), null);
  assert.equal(afterConnect.read(resource)?.tokens?.access_token, "access-signed-in");
  assert.equal(afterConnect.read(resource)?.client?.client_id, "registered");
  assert.equal(afterConnect.read(resource)?.discovery?.authorizationServerUrl, auth.base);
  assert.equal((await servers(connectPath))[VERCEL], connectRows[VERCEL]);
  const connectRecovers = { ok: true, cancelKeptRows: 2, recovered: "local", kept: VERCEL };

  const mixedConnectPath = join(root, "mixed-connect.json");
  const mixedConnectRows = {
    [NOTION]: encryptRecord("current", tokens("notion")),
    [resource]: encryptRecord("previous", tokens("local")),
  };
  await writeEnvelope(mixedConnectPath, mixedConnectRows);
  const mixedConnect = new McpOAuthStore(mixedConnectPath, current);
  assert.equal(await Effect.runPromise(mixedConnect.load()), null);
  await connect(mixedConnect, mcpUrl, "cancel");
  await expectRows(mixedConnectPath, mixedConnectRows);
  await connect(mixedConnect, mcpUrl, "sign-in");
  const afterMixedConnect = new McpOAuthStore(mixedConnectPath, current);
  assert.equal(await Effect.runPromise(afterMixedConnect.load()), null);
  assert.deepEqual(afterMixedConnect.read(NOTION)?.tokens, tokens("notion").tokens);
  assert.equal(afterMixedConnect.read(resource)?.tokens?.access_token, "access-signed-in");
  const mixedConnectRecovers = { ok: true, kept: NOTION, recovered: "local" };

  const work = mcpAccountUrl(mcpUrl, "work");
  const personal = mcpAccountUrl(mcpUrl, "personal");
  const workKey = mcpOAuthAccountKey(work);
  const personalKey = mcpOAuthAccountKey(personal);
  assert.ok(workKey && personalKey);
  assert.equal(mcpOAuthAccountKey(mcpUrl), resource);
  assert.equal(new Set([resource, workKey, personalKey]).size, 3);
  const accountsPath = join(root, "accounts.json");
  const accounts = new McpOAuthStore(accountsPath, current);
  assert.equal(await Effect.runPromise(accounts.load()), null);
  const sentBefore = auth.seen.length;
  await connect(accounts, mcpUrl, "sign-in", "plain");
  await connect(accounts, work, "sign-in", "work");
  await connect(accounts, personal, "sign-in", "personal");
  const signedIn = await servers(accountsPath);
  const third = mcpAccountUrl(mcpUrl, "third");
  await connect(accounts, third, "cancel");
  const afterCancel = await servers(accountsPath);
  for (const [key, row] of Object.entries(signedIn)) assert.equal(afterCancel[key], row);
  const thirdKey = mcpOAuthAccountKey(third);
  assert.ok(thirdKey);
  assert.equal(accounts.read(thirdKey)?.tokens, undefined);
  const accountsRead = new McpOAuthStore(accountsPath, current);
  assert.equal(await Effect.runPromise(accountsRead.load()), null);
  assert.equal(accountsRead.read(resource)?.tokens?.access_token, "access-plain");
  assert.equal(accountsRead.read(workKey)?.tokens?.access_token, "access-work");
  assert.equal(accountsRead.read(personalKey)?.tokens?.access_token, "access-personal");
  await runCauseEffect(accountsRead.clear(workKey));
  const afterRemove = new McpOAuthStore(accountsPath, current);
  assert.equal(await Effect.runPromise(afterRemove.load()), null);
  assert.equal(afterRemove.read(workKey), null);
  assert.equal(afterRemove.read(resource)?.tokens?.access_token, "access-plain");
  assert.equal(afterRemove.read(personalKey)?.tokens?.access_token, "access-personal");
  const sent = auth.seen.slice(sentBefore);
  assert.ok(sent.some((line) => line.startsWith("/token")));
  assert.ok(sent.every((line) => !line.includes("account-") && !line.includes("%23")));
  const accountsSeparate = {
    ok: true,
    rows: [resource, workKey, personalKey],
    afterRemove: [resource, personalKey],
    requests: sent.length,
  };

  const cases = {
    registrationKeepsRows,
    completedSignInKeepsOthers,
    secondSignInRecoversRest,
    partialDecrypt,
    corruptReplaced,
    refusedFile,
    connectRecovers,
    mixedConnectRecovers,
    accountsSeparate,
  };
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ ok: true, cases }, null, 2)}\n`);
  process.stdout.write(`mcp-oauth-store-e2e: ${Object.keys(cases).length} cases passed\n`);
} finally {
  await auth.close();
  await rm(root, { recursive: true, force: true });
}
