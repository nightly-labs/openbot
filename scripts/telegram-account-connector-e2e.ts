// Drives the real connector service, GramJS adapter and loopback MCP server. Only Telegram's
// network methods and the operating-system cipher are replaced; no real account is used.
// Run with `bun scripts/telegram-account-connector-e2e.ts`.
// Writes .openbot-build/telegram-account-connector-e2e/report.json.

import { spyOn } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect } from "effect";
import { Api, TelegramClient } from "telegram";
import type { EntityLike } from "telegram/define";
import { returnBigInt } from "telegram/Helpers";
import { z } from "zod";
import { TelegramAccountClient } from "../src/main/telegram-account-client";
import { TelegramAccountConnectorService } from "../src/main/telegram-account-connector-service";
import { TelegramAccountConnectorStore } from "../src/main/telegram-account-connector-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/telegram-account-connector-e2e");
const SINCE = 1_790_000_000;
const user = new Api.User({ id: returnBigInt(42), firstName: "Synthetic account", self: true });
const peer = new Api.InputPeerUser({ userId: user.id, accessHash: returnBigInt(7) });
const cases: Array<{ name: string; ok: true }> = [];

async function check(name: string, run: () => Promise<void>): Promise<void> {
  await run();
  cases.push({ name, ok: true });
  process.stdout.write(`ok - ${name}\n`);
}

function message(id: number, date = SINCE): Api.Message {
  return new Api.Message({ id, peerId: new Api.PeerUser({ userId: user.id }), date, message: `Message ${id}` });
}

const history = Array.from({ length: 125 }, (_, index) => message(index + 101, index < 120 ? SINCE - 1 : SINCE));
const documents = ["界".repeat(90), "𐐀".repeat(90), "a".repeat(300), "e\u0301".repeat(90)].map((name, index) => {
  const item = message(2_147_483_647 - index);
  item.media = new Api.MessageMediaDocument({
    document: new Api.Document({
      id: returnBigInt(item.id),
      accessHash: returnBigInt(7),
      fileReference: Buffer.alloc(0),
      date: SINCE,
      mimeType: "application/pdf",
      size: returnBigInt(4),
      dcId: 2,
      attributes: [new Api.DocumentAttributeFilename({ fileName: `${name}.pdf` })],
    }),
  });
  return item;
});

// The real adapter still owns lookup, iteration, filtering and writes. Its connection lifecycle
// is offline, so this script cannot open a Telegram connection.
class OfflineClient extends TelegramAccountClient {
  override connect() {
    return Effect.void;
  }
  override checkSession() {
    return Effect.void;
  }
  override destroy() {
    return Effect.void;
  }
}

let lookup: {
  started: ReturnType<typeof Promise.withResolvers<void>>;
  release: ReturnType<typeof Promise.withResolvers<void>>;
} | null = null;
function resolveEntity(reference: EntityLike): Promise<Api.User>;
function resolveEntity(reference: EntityLike[]): Promise<Api.User[]>;
async function resolveEntity(reference: EntityLike | EntityLike[]): Promise<Api.User | Api.User[]> {
  const pending = lookup;
  if (pending) {
    pending.started.resolve();
    await pending.release.promise;
  }
  return Array.isArray(reference) ? reference.map(() => user) : user;
}
const entity = spyOn(TelegramClient.prototype, "getEntity").mockImplementation(resolveEntity);
const input = spyOn(TelegramClient.prototype, "getInputEntity").mockResolvedValue(peer);
const rpc = spyOn(TelegramClient.prototype, "invoke").mockImplementation(async (request) => {
  if (request instanceof Api.messages.GetHistory) {
    const forward = request.addOffset < 0;
    const available = history.filter((item) =>
      forward ? item.id >= request.offsetId : request.offsetId === 0 || item.id < request.offsetId,
    );
    const selected = forward ? available.slice(0, request.limit) : available.slice(-request.limit);
    return new Api.messages.Messages({ messages: [...selected].reverse(), chats: [], users: [user] });
  }
  if (request instanceof Api.messages.GetMessages) {
    // GramJS converts numeric ids when it serializes the RPC. This offline boundary sees them
    // before serialization, although the generated RPC type names only InputMessage objects.
    const ids = request.id.flatMap((item) =>
      typeof item === "number" ? [item] : item instanceof Api.InputMessageID ? [item.id] : [],
    );
    return new Api.messages.Messages({
      messages: documents.filter((item) => ids.includes(item.id)),
      chats: [],
      users: [user],
    });
  }
  throw new Error(`Unexpected Telegram request: ${request.className}`);
});
const sent = message(999);
const sends = spyOn(TelegramClient.prototype, "sendMessage").mockResolvedValue(sent);
const files = spyOn(TelegramClient.prototype, "sendFile").mockResolvedValue(sent);
const reads = spyOn(TelegramClient.prototype, "markAsRead").mockResolvedValue(true);
const downloads = spyOn(TelegramClient.prototype, "downloadMedia").mockImplementation(async (_media, options) => {
  const path = options?.outputFile;
  assert.ok(typeof path === "string");
  assert.ok(Buffer.byteLength(basename(path)) <= 255, "Temporary name exceeds the file-system byte limit");
  await writeFile(path, "%PDF");
  return path;
});

const root = await mkdtemp(join(tmpdir(), "openbot-telegram-connector-"));
const store = new TelegramAccountConnectorStore(join(root, "connection.json"), {
  encrypt: (value) => Buffer.from(value),
  decrypt: (value) => value.toString(),
});
const service = new TelegramAccountConnectorService({
  store,
  appVersion: "0.0.0-test",
  mediaDirectory: join(root, "downloads"),
  protectedDirectory: join(root, "private"),
  createClient: (options) => Effect.succeed(new OfflineClient({ ...options, session: "" })),
});
const client = new Client({ name: "telegram-connector-e2e", version: "0.0.0" });
const pageSchema = z.object({ messages: z.array(z.object({ id: z.number() })), has_more: z.boolean() });
const contentSchema = z.array(z.object({ type: z.string(), text: z.string().optional() }));

async function call(name: string, args: Record<string, string | number>) {
  return client.callTool({ name, arguments: args });
}

async function page(args: Record<string, string | number>) {
  const result = await call("telegram_read_messages", { chat: "me", limit: 2, ...args });
  assert.notEqual(result.isError, true);
  const content = contentSchema.parse(result.content);
  return pageSchema.parse(JSON.parse(content.find((item) => item.type === "text")?.text ?? "null"));
}

try {
  await Effect.runPromise(
    store.update(() => ({
      apiId: 12345,
      apiHash: "1".repeat(32),
      session: "synthetic-session",
      account: { id: "42", firstName: "Synthetic account", lastName: "", username: null, phone: null },
      sendingEnabled: false,
      connectedAt: Date.now(),
    })),
  );
  await Effect.runPromise(service.load());
  const url = service.mcpServer()?.url;
  const secret = await Effect.runPromise(service.mcpAuthorization());
  assert.ok(url && secret);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${secret}` } },
    }),
  );

  await check("forward pages cross more than one GramJS batch of messages older than since", async () => {
    const since = new Date(SINCE * 1000).toISOString();
    const first = await page({ after_id: 100, since });
    assert.deepEqual(
      first.messages.map((item) => item.id),
      [221, 222],
    );
    assert.equal(first.has_more, true);
    const second = await page({ after_id: 222, since });
    assert.deepEqual(
      second.messages.map((item) => item.id),
      [223, 224],
    );
    assert.equal(second.has_more, true);
    const last = await page({ after_id: 224, since });
    assert.deepEqual(
      last.messages.map((item) => item.id),
      [225],
    );
    assert.equal(last.has_more, false);
  });
  await check("forward and backward pages without since retain their order and limits", async () => {
    const forward = await page({ after_id: 100 });
    assert.deepEqual(
      forward.messages.map((item) => item.id),
      [101, 102],
    );
    assert.equal(forward.has_more, true);
    const backward = await page({ before_id: 225 });
    assert.deepEqual(
      backward.messages.map((item) => item.id),
      [223, 224],
    );
    assert.equal(backward.has_more, true);
  });
  await check("since is inclusive and an exhausted date filter reports no more messages", async () => {
    const filtered = await page({ before_id: 224, since: new Date(SINCE * 1000).toISOString(), limit: 3 });
    assert.deepEqual(
      filtered.messages.map((item) => item.id),
      [221, 222, 223],
    );
    assert.equal(filtered.has_more, false);
    const empty = await page({ after_id: 100, since: new Date((SINCE + 1) * 1000).toISOString() });
    assert.deepEqual(empty.messages, []);
    assert.equal(empty.has_more, false);
  });

  const file = join(root, "report.pdf");
  await writeFile(file, "%PDF");
  const writeTools: Array<{ name: string; args: Record<string, string | number>; count: () => number }> = [
    {
      name: "telegram_send_message",
      args: { chat: "me", text: "Synthetic message" },
      count: () => sends.mock.calls.length,
    },
    { name: "telegram_send_file", args: { chat: "me", path: file }, count: () => files.mock.calls.length },
    { name: "telegram_mark_read", args: { chat: "me" }, count: () => reads.mock.calls.length },
  ];
  for (const tool of writeTools) {
    await check(`${tool.name} stops after sending is disabled during chat lookup`, async () => {
      await Effect.runPromise(service.setSending(true));
      const gate = { started: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
      lookup = gate;
      const before = tool.count();
      const pending = call(tool.name, tool.args);
      try {
        await Promise.race([
          gate.started.promise,
          pending.then(() => {
            throw new Error(`${tool.name} finished before chat lookup`);
          }),
        ]);
        const status = await Effect.runPromise(service.setSending(false));
        assert.equal(status.sendingEnabled, false);
      } finally {
        gate.release.resolve();
        lookup = null;
      }
      const result = await pending;
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result.content), /Sending is turned off/u);
      assert.equal(tool.count(), before);
      const lookups = entity.mock.calls.length;
      assert.equal((await call(tool.name, tool.args)).isError, true);
      assert.equal(entity.mock.calls.length, lookups);
      await Effect.runPromise(service.setSending(true));
      assert.notEqual((await call(tool.name, tool.args)).isError, true);
      assert.equal(tool.count(), before + 1);
    });
  }

  await check("Unicode downloads fit the byte limit, keep the extension and reuse the saved file", async () => {
    for (const item of documents) {
      const result = await call("telegram_download_media", { chat: "me", message_id: item.id });
      assert.notEqual(result.isError, true, JSON.stringify(result.content));
      const content = contentSchema.parse(result.content);
      const answer = z.object({ path: z.string() }).parse(JSON.parse(content[0]?.text ?? "null"));
      const name = basename(answer.path);
      assert.ok(Buffer.byteLength(name) <= 255, name);
      assert.ok(name.startsWith(`${item.id}-`) && name.endsWith(".pdf"), name);
      assert.ok(!name.includes("\uFFFD"), name);
      assert.equal(await readFile(answer.path, "utf8"), "%PDF");
      const count = downloads.mock.calls.length;
      assert.notEqual((await call("telegram_download_media", { chat: "me", message_id: item.id })).isError, true);
      assert.equal(downloads.mock.calls.length, count);
    }
  });

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ ok: true, cases }, null, 2)}\n`);
  process.stdout.write(`\n${cases.length} cases passed. Report: ${join(OUT, "report.json")}\n`);
} finally {
  await client.close();
  await Effect.runPromise(service.dispose());
  for (const mock of [entity, input, rpc, sends, files, reads, downloads]) mock.mockRestore();
  await rm(root, { recursive: true, force: true });
}
