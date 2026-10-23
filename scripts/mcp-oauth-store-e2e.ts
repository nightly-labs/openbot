// Checks that a completed MCP sign-in can replace one unread row without deleting the file, and
// that a registration still refuses while every row is unread. The store uses a fake cipher, so
// this does not open Keychain or a browser.
//
// `bun scripts/mcp-oauth-store-e2e.ts`. Writes .openbot-build/mcp-oauth-store-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type McpOAuthRecord, mcpOAuthRecordSchema } from "../src/backend/mcp-oauth-provider";
import { McpOAuthStore } from "../src/main/mcp-oauth-store";
import type { SecretCipher } from "../src/main/provider-credential-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-oauth-store-e2e");
const NOTION = "https://mcp.notion.com/mcp";
const VERCEL = "https://mcp.vercel.com/";
const STRIPE = "https://mcp.stripe.com/";
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
    client: { client_id: `${name}-client`, redirect_uris: ["http://127.0.0.1/mcp-auth"] },
  });
}

function encryptRecord(key: string, record: McpOAuthRecord): string {
  return cipher(key).encrypt(JSON.stringify(record)).toString("base64");
}

const envelopeSchema = z.object({
  version: z.literal(1),
  servers: z.record(z.string(), z.string()),
});

async function envelope(path: string) {
  return envelopeSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

async function writeEnvelope(path: string, servers: Record<string, string>): Promise<void> {
  await writeFile(path, `${JSON.stringify({ version: 1, servers })}\n`);
}

async function expectUnreadable(operation: Effect.Effect<void, { readonly cause: unknown }>): Promise<void> {
  await assert.rejects(runCauseEffect(operation), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, UNREADABLE);
    return true;
  });
}

const root = await mkdtemp(join(tmpdir(), "openbot-mcp-oauth-store-"));

try {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const current = cipher("current");

  // 1. A registration cannot replace a file whose rows this cipher cannot read.
  const lockedPath = join(root, "locked.json");
  await writeEnvelope(lockedPath, {
    [NOTION]: encryptRecord("previous", tokens("notion")),
    [VERCEL]: encryptRecord("previous", tokens("vercel")),
  });
  const locked = new McpOAuthStore(lockedPath, current);
  assert.equal((await Effect.runPromise(locked.load()))?.message, UNREADABLE);
  assert.equal(locked.read(NOTION), null);
  await expectUnreadable(locked.write(NOTION, registration("notion")));
  const lockedAfter = await envelope(lockedPath);
  assert.deepEqual(Object.keys(lockedAfter.servers).sort(), [NOTION, VERCEL].sort());
  assert.equal(lockedAfter.servers[NOTION], encryptRecord("previous", tokens("notion")));
  assert.equal(lockedAfter.servers[VERCEL], encryptRecord("previous", tokens("vercel")));
  const registrationRefused = { ok: true, servers: Object.keys(lockedAfter.servers).sort() };

  // 2. A completed sign-in replaces that unread row and keeps the other ciphertext.
  await runCauseEffect(locked.write(NOTION, tokens("notion-new")));
  assert.deepEqual(locked.read(NOTION)?.tokens, tokens("notion-new").tokens);
  assert.equal(locked.read(VERCEL), null);
  const recovered = await envelope(lockedPath);
  assert.equal(recovered.servers[VERCEL], encryptRecord("previous", tokens("vercel")));
  assert.notEqual(recovered.servers[NOTION], encryptRecord("previous", tokens("notion")));
  const reread = new McpOAuthStore(lockedPath, current);
  assert.equal(await Effect.runPromise(reread.load()), null);
  assert.deepEqual(reread.read(NOTION)?.tokens, tokens("notion-new").tokens);
  assert.equal(reread.read(VERCEL), null);
  const completedSignInKeepsOthers = { ok: true, readable: [NOTION], unread: [VERCEL] };

  // 3. A later completed sign-in recovers the remaining unread row without dropping the first.
  await runCauseEffect(reread.write(VERCEL, tokens("vercel-new")));
  assert.deepEqual(reread.read(NOTION)?.tokens, tokens("notion-new").tokens);
  assert.deepEqual(reread.read(VERCEL)?.tokens, tokens("vercel-new").tokens);
  const both = new McpOAuthStore(lockedPath, current);
  assert.equal(await Effect.runPromise(both.load()), null);
  assert.deepEqual(both.read(NOTION)?.tokens, tokens("notion-new").tokens);
  assert.deepEqual(both.read(VERCEL)?.tokens, tokens("vercel-new").tokens);
  const secondSignInRecoversRest = { ok: true, readable: [NOTION, VERCEL].sort() };

  // 4. One unread row among readable ones does not hide the readable row.
  const mixedPath = join(root, "mixed.json");
  await writeEnvelope(mixedPath, {
    [NOTION]: encryptRecord("current", tokens("notion")),
    [STRIPE]: encryptRecord("previous", tokens("stripe")),
  });
  const mixed = new McpOAuthStore(mixedPath, current);
  assert.equal(await Effect.runPromise(mixed.load()), null);
  assert.deepEqual(mixed.read(NOTION)?.tokens, tokens("notion").tokens);
  assert.equal(mixed.read(STRIPE), null);
  await runCauseEffect(mixed.write(STRIPE, tokens("stripe-new")));
  assert.deepEqual(mixed.read(NOTION)?.tokens, tokens("notion").tokens);
  assert.deepEqual(mixed.read(STRIPE)?.tokens, tokens("stripe-new").tokens);
  const partialDecrypt = { ok: true, kept: NOTION, recovered: STRIPE };

  // 5. An unparseable file is still replaced by a completed sign-in.
  const corruptPath = join(root, "corrupt.json");
  await writeFile(corruptPath, "{not-json");
  const corrupt = new McpOAuthStore(corruptPath, current);
  assert.equal((await Effect.runPromise(corrupt.load()))?.message, UNREADABLE);
  await runCauseEffect(corrupt.write(NOTION, tokens("notion")));
  assert.deepEqual(corrupt.read(NOTION)?.tokens, tokens("notion").tokens);
  const corruptReplaced = { ok: true };

  const cases = {
    registrationRefused,
    completedSignInKeepsOthers,
    secondSignInRecoversRest,
    partialDecrypt,
    corruptReplaced,
  };
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ ok: true, cases }, null, 2)}\n`);
  process.stdout.write(`mcp-oauth-store-e2e: ${Object.keys(cases).length} cases passed\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
