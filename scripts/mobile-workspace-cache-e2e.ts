import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createOpenBotLogger } from "@openbot/logging";
import { plugin } from "bun";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "mobile-workspace-cache-e2e");
const FILES = join(OUT, "cache-directory");
const MOBILE_SRC = join(ROOT, "apps", "mobile", "src");
const MODEL_DIR = join(MOBILE_SRC, "features", "workspace", "model");
const CACHE_SOURCE = "apps/mobile/src/features/workspace/model/workspace-cache.ts";
const SCOPE = "https://e2e.openbot.test:user-e2e";
const SERVER_ID = "8f0c2c4e-6b1f-4f0e-9d55-cache0000001";
const ROUNDS = 7;
const AGENTS = 60;
const MESSAGES_PER_PAGE = 50;
const MESSAGE_TEXT_LENGTH = 1_100;
const CHANNELS = 6;
const SIGNAL_HOME = {
  preferred: null,
  current: "a",
  homes: [
    { id: "a", latencyMs: 41 },
    { id: "us", latencyMs: null },
  ],
};
const MAX_CACHE_JSON = 3 * 1024 * 1024;
const require = createRequire(import.meta.url);
const logger = createOpenBotLogger("mobile-workspace-cache-e2e");

const keychain = new Map<string, string>();

interface SealedData {
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

class TestAesKey {
  constructor(readonly bytes: Buffer) {}
  static async import(encoded: string) {
    return new TestAesKey(Buffer.from(encoded, "base64"));
  }
  static async generate() {
    return new TestAesKey(randomBytes(32));
  }
  async encoded() {
    return this.bytes.toString("base64");
  }
}

class TestSealedData implements SealedData {
  constructor(
    readonly iv: Buffer,
    readonly ciphertext: Buffer,
    readonly tag: Buffer,
  ) {}
  static fromCombined(combined: string) {
    const bytes = Buffer.from(combined, "base64");
    return new TestSealedData(bytes.subarray(0, 12), bytes.subarray(12, bytes.length - 16), bytes.subarray(-16));
  }
  async combined() {
    return Buffer.concat([this.iv, this.ciphertext, this.tag]).toString("base64");
  }
}

function filePath(uri: string) {
  return uri.startsWith("file://") ? new URL(uri).pathname : uri;
}

plugin({
  name: "mobile-workspace-cache-boundaries",
  setup(build) {
    build.module("expo-secure-store", () => ({
      loader: "object",
      exports: {
        AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
        getItemAsync: async (key: string, options?: { keychainService?: string }) =>
          keychain.get(`${options?.keychainService ?? ""}:${key}`) ?? null,
        setItemAsync: async (key: string, value: string, options?: { keychainService?: string }) => {
          keychain.set(`${options?.keychainService ?? ""}:${key}`, value);
        },
        deleteItemAsync: async (key: string, options?: { keychainService?: string }) => {
          keychain.delete(`${options?.keychainService ?? ""}:${key}`);
        },
        getItem: (key: string, options?: { keychainService?: string }) =>
          keychain.get(`${options?.keychainService ?? ""}:${key}`) ?? null,
        setItem: (key: string, value: string, options?: { keychainService?: string }) => {
          keychain.set(`${options?.keychainService ?? ""}:${key}`, value);
        },
      },
    }));
    build.module("expo-crypto", () => ({
      loader: "object",
      exports: {
        AESEncryptionKey: TestAesKey,
        AESSealedData: TestSealedData,
        AESKeySize: { AES256: 256 },
        CryptoDigestAlgorithm: { SHA256: "SHA-256" },
        randomUUID,
        digestStringAsync: async (_algorithm: string, value: string) =>
          createHash("sha256").update(value).digest("hex"),
        aesEncryptAsync: async (plaintext: Uint8Array, key: TestAesKey, options: { additionalData: Uint8Array }) => {
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key.bytes, iv);
          cipher.setAAD(options.additionalData);
          const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
          return new TestSealedData(iv, ciphertext, cipher.getAuthTag());
        },
        aesDecryptAsync: async (sealed: SealedData, key: TestAesKey, options: { additionalData: Uint8Array }) => {
          const decipher = createDecipheriv("aes-256-gcm", key.bytes, sealed.iv);
          decipher.setAAD(options.additionalData);
          decipher.setAuthTag(sealed.tag);
          return new Uint8Array(Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]));
        },
      },
    }));
    build.module("expo-file-system/legacy", () => ({
      loader: "object",
      exports: {
        cacheDirectory: `${FILES}/`,
        getInfoAsync: async (uri: string) => ({ exists: existsSync(filePath(uri)) }),
        readAsStringAsync: async (uri: string) => readFile(filePath(uri), "utf8"),
        writeAsStringAsync: async (uri: string, value: string) => writeFile(filePath(uri), value),
        deleteAsync: async (uri: string) => rm(filePath(uri), { recursive: true, force: true }),
        moveAsync: async ({ from, to }: { from: string; to: string }) => rename(filePath(from), filePath(to)),
        makeDirectoryAsync: async (uri: string) => {
          await mkdir(filePath(uri), { recursive: true });
        },
        readDirectoryAsync: async (uri: string) => readdir(filePath(uri)),
      },
    }));
    build.onResolve({ filter: /^@\// }, ({ path }) => ({ path: require.resolve(join(MOBILE_SRC, path.slice(2))) }));
    build.onLoad({ filter: /shared[/\\]lib[/\\]format-updated-at\.ts$/ }, () => ({
      loader: "object",
      exports: { formatUpdatedAt: (value: string) => value },
    }));
  },
});

interface CachedPages {
  conversations: { agentId: string; messages: unknown[] }[];
  channelPages: unknown[];
}

interface SplitRead {
  agents: { id: string }[];
  drawer: { memberCount?: number; signalHome?: unknown } | null;
  channels: unknown[] | null;
  readPages(): Promise<CachedPages | null>;
}

interface LegacyRead {
  agents: { id: string }[];
  conversations: { agentId: string; messages: unknown[] }[];
  channels: { channels: unknown[]; pages: unknown[] } | null;
}

interface CacheApi<Read> {
  read(serverId: string): Promise<Read | null>;
  write(serverId: string, value: unknown): Promise<boolean>;
  remove(serverId: string): Promise<void>;
  retain(serverIds: readonly string[]): Promise<void>;
  readHosts(): Promise<unknown[] | null>;
  writeHosts(hosts: readonly unknown[]): Promise<void>;
}

interface CacheModule<Read> {
  createWorkspaceCache(scope: string): CacheApi<Read> | null;
  deleteWorkspaceCaches(): Promise<void>;
}

function releasedBase() {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  try {
    return git("merge-base", "HEAD", "origin/main");
  } catch {
    return git("rev-parse", "HEAD~1");
  }
}

async function loadCopiedModule<Read>(source: string, folder: string): Promise<CacheModule<Read>> {
  const rewritten = source
    .replace(/from "\.\/([^"]+)"/g, (_match, name: string) => `from ${JSON.stringify(join(MODEL_DIR, name))}`)
    .replace(/from "@\/([^"]+)"/g, (_match, name: string) => `from ${JSON.stringify(join(MOBILE_SRC, name))}`);
  const target = join(OUT, folder, "workspace-cache.ts");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, rewritten);
  return import(pathToFileURL(target).href);
}

function loadReleasedModule(base: string) {
  const source = execFileSync("git", ["show", `${base}:${CACHE_SOURCE}`], { cwd: ROOT, encoding: "utf8" });
  return loadCopiedModule<LegacyRead>(source, "released");
}

async function loadCurrentWithoutTextDecoder() {
  const source = await readFile(join(ROOT, CACHE_SOURCE), "utf8");
  const saved = Object.getOwnPropertyDescriptor(globalThis, "TextDecoder");
  Reflect.deleteProperty(globalThis, "TextDecoder");
  try {
    return await loadCopiedModule<SplitRead>(source, "current-without-text-decoder");
  } finally {
    if (saved) Object.defineProperty(globalThis, "TextDecoder", saved);
  }
}

const UNICODE_TAIL = " zażółć gęślą jaźń 漢字 😀";

function message(agentId: string, index: number, day = 1) {
  const body = `${agentId} message ${index} `.padEnd(MESSAGE_TEXT_LENGTH - UNICODE_TAIL.length, "x") + UNICODE_TAIL;
  return {
    id: `${agentId}-m${index}`,
    author: index % 2 ? "assistant" : "user",
    text: body,
    createdAt: new Date(Date.UTC(2026, 10, day, 0, index)).toISOString(),
    status: "completed",
  };
}

function channel(index: number) {
  return {
    id: `channel-${index}`,
    name: `Channel ${index}`,
    title: "Team",
    instructions: "",
    members: [{ agentId: "agent-0" }, { agentId: "agent-1" }],
    leadAgentId: "agent-0",
    unreadCount: 0,
    activeTasks: 0,
    lastMessage: null,
    archived: false,
    revision: 1,
    createdAt: "2026-11-01T00:00:00.000Z",
  };
}

function workspaceValue() {
  const agents = Array.from({ length: AGENTS }, (_, index) => ({
    id: `agent-${index}`,
    name: `Agent ${index}`,
    title: "Helper",
    description: "An agent for the cache test.",
    preview: "Last reply",
    updatedAt: "2026-11-27T10:00:00.000Z",
    avatarSeed: `seed-${index}`,
    avatarHue: null,
    avatarUrl: null,
  }));
  const conversations = agents.map((agent, index) => ({
    agentId: agent.id,
    threadId: `thread-${index}`,
    activeTurnId: null,
    revision: 3,
    messages: Array.from({ length: MESSAGES_PER_PAGE }, (_, messageIndex) => message(agent.id, messageIndex)),
    pageInfo: { hasOlder: false, olderCursor: null },
    references: {},
  }));
  const channels = Array.from({ length: CHANNELS }, (_, index) => channel(index));
  const pages = channels.map((summary) => ({
    channel: summary,
    messages: Array.from({ length: 10 }, (_, index) => ({
      id: `${summary.id}-cm${index}`,
      channelId: summary.id,
      sequence: index + 1,
      author: { kind: "agent", id: "agent-0", name: "Agent 0" },
      taskId: null,
      superseded: false,
      message: message(summary.id, index, 2),
    })),
    tasks: [],
    olderCursor: null,
    throughSequence: 10,
  }));
  return {
    agents,
    hidden: ["agent-3"],
    colors: [{ agentId: "agent-1", color: "blue" }],
    sidebar: null,
    conversations,
    capabilities: ["chat-channels"],
    drawer: { memberCount: 3, signalHome: SIGNAL_HOME },
    channels: { channels, pages },
  };
}

const HOSTS = [
  {
    hostId: SERVER_ID,
    name: "Test server",
    logoKey: null,
    devicePublicKey: "test-device-key",
    membershipId: "membership-1",
    role: "owner",
  },
];

async function accountFolder() {
  const hash = createHash("sha256").update(SCOPE).digest("hex");
  return join(FILES, "workspace-cache-v1", hash);
}

async function listedFiles() {
  const folder = await accountFolder();
  return existsSync(folder) ? (await readdir(folder)).sort() : [];
}

async function fileSize(name: string) {
  return (await stat(join(await accountFolder(), name))).size;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number((sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(2));
}

async function timed<T>(operation: () => Promise<T>): Promise<Timed<T>> {
  const start = performance.now();
  const value = await operation();
  return { value, ms: performance.now() - start };
}

function required<T>(value: T | null): T {
  assert.ok(value, "The cache directory is not set.");
  return value;
}

interface Timed<T> {
  value: T;
  ms: number;
}

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
async function check(name: string, run: () => Promise<unknown>) {
  try {
    const detail = await run();
    checks.push({ name, passed: true, ...(detail === undefined ? {} : { detail }) });
  } catch (error) {
    checks.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(FILES, { recursive: true });

const base = releasedBase();
const released = await loadReleasedModule(base);
const current: CacheModule<SplitRead> = await import(pathToFileURL(join(MODEL_DIR, "workspace-cache.ts")).href);
const value = workspaceValue();
const withoutTextDecoder = await loadCurrentWithoutTextDecoder();
const releasedCache: CacheApi<LegacyRead> = required(released.createWorkspaceCache(SCOPE));
const currentCache: CacheApi<SplitRead> = required(current.createWorkspaceCache(SCOPE));

const timings: Record<
  | "releasedFullRead"
  | "workspaceReady"
  | "pagesReady"
  | "workspaceReadyWithoutTextDecoder"
  | "pagesReadyWithoutTextDecoder",
  number[]
> = {
  releasedFullRead: [],
  workspaceReady: [],
  pagesReady: [],
  workspaceReadyWithoutTextDecoder: [],
  pagesReadyWithoutTextDecoder: [],
};
let releasedJsonBytes = 0;
let splitBytes = { workspace: 0, pages: 0 };

await check("released code writes and reads a 3 MB cache (baseline)", async () => {
  assert.equal(await releasedCache.write(SERVER_ID, value), true);
  releasedJsonBytes = await fileSize(`${SERVER_ID}.bin`);
  for (let round = 0; round < ROUNDS; round += 1) {
    const read: Timed<LegacyRead | null> = await timed(() => releasedCache.read(SERVER_ID));
    assert.equal(read.value?.agents.length, AGENTS);
    timings.releasedFullRead.push(read.ms);
  }
  return { sealedFileBytes: releasedJsonBytes };
});

await check("new code reads the released format after an upgrade", async () => {
  const read = await currentCache.read(SERVER_ID);
  assert.ok(read, "The released cache was not read.");
  assert.equal(read.agents.length, AGENTS);
  assert.equal(read.channels?.length, CHANNELS);
  const pages = await read.readPages();
  assert.ok(pages && pages.conversations.length > 0, "The released conversation pages were not read.");
  assert.equal(pages.channelPages.length > 0, true);
  return {
    agents: read.agents.length,
    conversations: pages.conversations.length,
    channelPages: pages.channelPages.length,
  };
});

await check("the first new write replaces the released file with the split files", async () => {
  assert.equal(await currentCache.write(SERVER_ID, value), true);
  const files = await listedFiles();
  assert.deepEqual(files, [`${SERVER_ID}~pages.bin`, `${SERVER_ID}~workspace.bin`]);
  splitBytes = {
    workspace: await fileSize(`${SERVER_ID}~workspace.bin`),
    pages: await fileSize(`${SERVER_ID}~pages.bin`),
  };
  return { files, sealedBytes: splitBytes };
});

await check("the saved Signal server settings read back before the host answers", async () => {
  const read = await currentCache.read(SERVER_ID);
  assert.ok(read, "The workspace part was not read.");
  assert.deepEqual(read.drawer, { memberCount: 3, signalHome: SIGNAL_HOME });
  const damaged = { ...value, drawer: { memberCount: 3, signalHome: { ...SIGNAL_HOME, current: "Not An Id" } } };
  assert.equal(await currentCache.write(SERVER_ID, damaged), true);
  const reread = await currentCache.read(SERVER_ID);
  assert.deepEqual(reread?.drawer, { memberCount: 3 });
  assert.equal(await currentCache.write(SERVER_ID, value), true);
  return read.drawer;
});

await check("new code makes the workspace part ready before it decodes the pages", async () => {
  let conversations = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const head: Timed<SplitRead | null> = await timed(() => currentCache.read(SERVER_ID));
    assert.ok(head.value, "The workspace part was not read.");
    assert.equal(head.value.agents.length, AGENTS);
    assert.equal(head.value.channels?.length, CHANNELS);
    const readPages = head.value.readPages;
    const pages: Timed<CachedPages | null> = await timed(() => readPages());
    assert.ok(pages.value, "The pages part was not read.");
    conversations = pages.value.conversations.length;
    timings.workspaceReady.push(head.ms);
    timings.pagesReady.push(head.ms + pages.ms);
  }
  return { conversations };
});

await check("the chunk fallback without TextDecoder decodes the same split cache", async () => {
  const cache: CacheApi<SplitRead> = required(withoutTextDecoder.createWorkspaceCache(SCOPE));
  let conversations = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const head: Timed<SplitRead | null> = await timed(() => cache.read(SERVER_ID));
    assert.equal(head.value?.agents.length, AGENTS);
    const readPages = head.value?.readPages;
    assert.ok(readPages);
    const pages: Timed<CachedPages | null> = await timed(() => readPages());
    assert.ok(pages.value);
    conversations = pages.value.conversations.length;
    timings.workspaceReadyWithoutTextDecoder.push(head.ms);
    timings.pagesReadyWithoutTextDecoder.push(head.ms + pages.ms);
  }
  return { conversations };
});

await check("the split cache keeps the same pages as the released cache", async () => {
  const legacyFolder = await accountFolder();
  const releasedRead = await (async () => {
    const isolated = released.createWorkspaceCache(`${SCOPE}:compare`);
    assert.ok(isolated);
    await isolated.write(SERVER_ID, value);
    return isolated.read(SERVER_ID);
  })();
  const head = await currentCache.read(SERVER_ID);
  const pages = await head?.readPages();
  assert.ok(releasedRead && pages);
  assert.deepEqual(
    pages.conversations.map((page) => page.agentId).sort(),
    releasedRead.conversations.map((page) => page.agentId).sort(),
  );
  assert.equal(pages.channelPages.length, releasedRead.channels?.pages.length ?? 0);
  const compareFolder = join(dirname(legacyFolder), createHash("sha256").update(`${SCOPE}:compare`).digest("hex"));
  await rm(compareFolder, { recursive: true, force: true });
  return { conversations: pages.conversations.length, channelPages: pages.channelPages.length };
});

await check("the split files stay within the released 3 MB limit", async () => {
  const head = await currentCache.read(SERVER_ID);
  const pages = await head?.readPages();
  assert.ok(head && pages);
  const plainLength = JSON.stringify(head).length + JSON.stringify(pages).length;
  assert.ok(plainLength <= MAX_CACHE_JSON * 1.05, `The cache holds ${plainLength} characters.`);
  return { decodedJsonCharacters: plainLength };
});

await check("a released bundle finds nothing after the new write and does not throw (rollback)", async () => {
  const read = await releasedCache.read(SERVER_ID);
  assert.equal(read, null);
  assert.deepEqual(await listedFiles(), [`${SERVER_ID}~pages.bin`, `${SERVER_ID}~workspace.bin`]);
});

await check("a released bundle still reads the unchanged server list file", async () => {
  await currentCache.writeHosts(HOSTS);
  const hosts = await releasedCache.readHosts();
  assert.equal(hosts?.length, 1);
});

await check("a released bundle's retain deletes the split files without error", async () => {
  await releasedCache.retain([SERVER_ID]);
  assert.deepEqual(await listedFiles(), ["~hosts.bin"]);
});

await check("after a rollback write, the new code prefers the newer released file", async () => {
  await currentCache.write(SERVER_ID, value);
  const olderAgents = { ...value, agents: value.agents.slice(0, 5) };
  await releasedCache.write(SERVER_ID, olderAgents);
  const read = await currentCache.read(SERVER_ID);
  assert.equal(read?.agents.length, 5);
  await currentCache.write(SERVER_ID, value);
  assert.equal(existsSync(join(await accountFolder(), `${SERVER_ID}.bin`)), false);
  return { agentsFromReleasedFile: read?.agents.length };
});

await check("pages from another write are dropped, and the workspace part stays", async () => {
  const folder = await accountFolder();
  const pagesFile = join(folder, `${SERVER_ID}~pages.bin`);
  const keptPages = await readFile(pagesFile, "utf8");
  await currentCache.write(SERVER_ID, value);
  await writeFile(pagesFile, keptPages);
  const head = await currentCache.read(SERVER_ID);
  assert.equal(head?.agents.length, AGENTS);
  assert.equal(await head?.readPages(), null);
  assert.equal(existsSync(pagesFile), false);
});

await check("a damaged workspace part is deleted and reads as empty", async () => {
  await currentCache.write(SERVER_ID, value);
  const folder = await accountFolder();
  await writeFile(join(folder, `${SERVER_ID}~workspace.bin`), Buffer.from("damaged").toString("base64"));
  assert.equal(await currentCache.read(SERVER_ID), null);
  assert.equal(existsSync(join(folder, `${SERVER_ID}~workspace.bin`)), false);
});

await check("server removal deletes every cache file of the server", async () => {
  await currentCache.write(SERVER_ID, value);
  await currentCache.remove(SERVER_ID);
  assert.deepEqual(await listedFiles(), ["~hosts.bin"]);
});

await check("new retain keeps the split files of a listed server and deletes others", async () => {
  await currentCache.write(SERVER_ID, value);
  await currentCache.write("removed-server", value);
  await currentCache.retain([SERVER_ID]);
  assert.deepEqual(await listedFiles(), [`${SERVER_ID}~pages.bin`, `${SERVER_ID}~workspace.bin`, "~hosts.bin"]);
});

await check("no cache file has plain text", async () => {
  const folder = await accountFolder();
  for (const name of await listedFiles()) {
    const raw = await readFile(join(folder, name), "utf8");
    assert.equal(raw.includes("agent-1"), false, `${name} has plain text.`);
    assert.equal(Buffer.from(raw, "base64").toString("latin1").includes("agent-1"), false, `${name} has plain text.`);
  }
});

await check("sign-out with the released bundle deletes the split files and the key", async () => {
  await released.deleteWorkspaceCaches();
  assert.equal(existsSync(join(FILES, "workspace-cache-v1")), false);
  assert.equal(
    [...keychain.keys()].some((key) => key.includes("workspace-cache-key")),
    false,
  );
});

await check("sign-out with the new bundle deletes the split files and the key", async () => {
  const cache = current.createWorkspaceCache(SCOPE);
  assert.ok(cache);
  await cache.write(SERVER_ID, value);
  await current.deleteWorkspaceCaches();
  assert.equal(existsSync(join(FILES, "workspace-cache-v1")), false);
  assert.equal(
    [...keychain.keys()].some((key) => key.includes("workspace-cache-key")),
    false,
  );
});

const report = {
  generatedAt: new Date().toISOString(),
  releasedBase: base,
  runtime: `bun ${Bun.version}`,
  textDecoder: typeof TextDecoder === "function",
  rounds: ROUNDS,
  data: {
    agents: AGENTS,
    messagesPerPage: MESSAGES_PER_PAGE,
    channels: CHANNELS,
    releasedSealedBytes: releasedJsonBytes,
    splitSealedBytes: splitBytes,
  },
  medianMs: {
    beforeWorkspaceReady: median(timings.releasedFullRead),
    afterWorkspaceReady: median(timings.workspaceReady),
    afterPagesReady: median(timings.pagesReady),
    afterWorkspaceReadyWithoutTextDecoder: median(timings.workspaceReadyWithoutTextDecoder),
    afterPagesReadyWithoutTextDecoder: median(timings.pagesReadyWithoutTextDecoder),
  },
  timingsMs: timings,
  checks,
  passed: checks.every((entry) => entry.passed),
};
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await rm(join(OUT, "released"), { recursive: true, force: true });
await rm(join(OUT, "current-without-text-decoder"), { recursive: true, force: true });
await rm(FILES, { recursive: true, force: true });
for (const entry of checks) {
  if (entry.passed) logger.info(`ok ${entry.name}`);
  else logger.error(`FAIL ${entry.name}: ${JSON.stringify(entry.detail)}`);
}
logger.info(`Median ms: ${JSON.stringify(report.medianMs)}`);
logger.info(`Report: ${join(OUT, "report.json")}`);
if (!report.passed) process.exit(1);
