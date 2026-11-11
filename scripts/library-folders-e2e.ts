// Checks that an agent puts the files it attaches into a Library folder, and reads its folders.
// Runs the real agent service, attachment gateway, tool router and Library folders store on a
// temporary profile with a fake Codex app-server. The fake calls `attach_files_to_response` as a
// direct tool and `list_library_folders` through `tool_call`, as a model does, and logs each result.
// The check asserts the folders file on disk after each call: a path makes each level; the same path
// in a different letter case uses the same folders; a path that cannot be used, a full store and a
// host with no store keep the attachment in no folder, with the reason; a repeated call makes one
// message; an agent sees only its own folders and files.
// `bun scripts/library-folders-e2e.ts`. Writes .openbot-build/library-folders-e2e/report.json.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, LIBRARY_FOLDER_LIMITS, libraryFolderPath } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/library-folders-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-library-folders-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

// Before the service modules load: the Codex process and the stores read the home folder.
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { LIBRARY_FOLDERS_FILE, LibraryFoldersStore } = await import("../src/backend/library-folders-store");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const CALL_MARK = "LIBRARY-CALL";
const PERSON = { id: "local", name: "Alex" };

/**
 * A Codex app-server with the methods that the service calls. A turn whose input has
 * `LIBRARY-CALL <<ARGS{"__tool":"…",…}ARGS>>` calls `__tool` with the rest of that JSON, logs the
 * result, and ends. `__direct` calls the tool by its name; without it the call goes through
 * `tool_call`. `__twice` sends the call a second time with the same call id. Other turns answer "Done.".
 */
const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
/** Tool request id -> the turn that waits for its result. */
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId) => {
  const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const calls = text.includes(${JSON.stringify(CALL_MARK)}) ? [...text.matchAll(/<<ARGS([\\s\\S]*?)ARGS>>/g)] : [];
      const match = calls.at(-1);
      if (!match) return setTimeout(() => finish(params.threadId, turnId), 20);
      const id = "tool-" + turnId;
      // The packet carries the request as JSON text, so its quotes arrive escaped.
      const { __tool, __direct, __twice, ...args } = JSON.parse(match[1].replace(/\\\\"/g, '"'));
      const call = {
        method: "item/tool/call",
        params: {
          threadId: params.threadId,
          turnId,
          callId: "call-" + turnId,
          namespace: "openbot",
          tool: __direct ? __tool : "tool_call",
          arguments: __direct ? args : { name: "openbot." + __tool, arguments: args },
        },
      };
      waiting.set(id, { threadId: params.threadId, turnId, again: __twice ? call : null });
      return write({ id, ...call });
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
      else if (!message.method && waiting.has(message.id)) {
        const turn = waiting.get(message.id);
        waiting.delete(message.id);
        log({ turnId: turn.turnId, result: message.result ?? null, error: message.error ?? null });
        if (turn.again) {
          // The same call a second time, as a provider does after a lost result.
          const id = message.id + "-again";
          waiting.set(id, { threadId: turn.threadId, turnId: turn.turnId, again: null });
          write({ id, ...turn.again });
        } else finish(turn.threadId, turn.turnId);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

/** The arguments the fake passes to a tool, valid or not. */
interface LibraryToolArgs {
  paths?: string[];
  folder?: string | number;
}

interface ToolLog {
  turnId: string;
  result: { success: boolean; contentItems: { type: string; text: string }[] } | null;
  error: unknown;
}

const report: {
  calls: { name: string; turnId: string; success: boolean | null; text: string }[];
  checks: { name: string; passed: boolean }[];
  storedFolders: { path: string; files: number }[];
  passed: boolean;
  error?: string;
} = { calls: [], checks: [], storedFolders: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

/** Waits for a state of the service or the fake's log. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function toolLogs(): ToolLog[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

const attachedSchema = z.object({
  status: z.literal("attached"),
  messageId: z.string(),
  attachments: z.array(z.object({ id: z.string(), name: z.string() })),
  folder: z
    .union([
      z.object({ path: z.string(), created: z.boolean() }),
      z.object({ placed: z.literal(false), reason: z.string() }),
    ])
    .optional(),
});
const listingSchema = z.object({
  folders: z.array(
    z.object({
      path: z.string(),
      fileCount: z.number(),
      files: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })),
    }),
  ),
  unfiled: z.number(),
  truncated: z.boolean(),
});
const storedSchema = z.object({
  version: z.literal(1),
  revision: z.number(),
  folders: z.array(
    z.object({ id: z.string(), agentId: z.string(), name: z.string(), parentId: z.string().optional() }),
  ),
  placement: z.record(z.string(), z.string()),
});

/** One profile: a database, the stores and an agent service, with or without Library folders. */
async function startHost(directory: string, withFolders: boolean) {
  const database = new OpenBotDatabase(directory);
  const store = new AgentStore(directory, home, database);
  const mailbox = new MailboxStore(directory, store.sharedRoot, store.database);
  const foldersPath = join(directory, LIBRARY_FOLDERS_FILE);
  const libraryFolders = withFolders ? new LibraryFoldersStore(foldersPath) : null;
  if (libraryFolders) await runCauseEffect(libraryFolders.initialize());
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    timezone: () => "UTC",
    libraryFolders,
  });
  await runCauseEffect(agents.initialize());

  /** Waits until the agent's chat has no open delivery. */
  const idle = (agentId: string) =>
    waitFor("the chat turn to end", () =>
      agents
        .listQueue(agentId)
        .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
    );

  return {
    agents,
    mailbox,
    libraryFolders,
    /** The folders file as it is on disk. */
    stored: () => storedSchema.parse(JSON.parse(readFileSync(foldersPath, "utf8"))),
    hasFoldersFile: () => existsSync(foldersPath),
    async create(name: string) {
      const agent = await runCauseEffect(
        agents.createAgent({
          name,
          description: `${name} makes files.`,
          avatarSeed: name.toLowerCase(),
          avatarHue: null,
          initialMessage: "Hello.",
        }),
      );
      await idle(agent.id);
      return agent;
    },
    /** Sends the person's message that makes the fake call `tool`; answers each logged result. */
    async call(
      name: string,
      agentId: string,
      tool: string,
      args: LibraryToolArgs,
      mode: { direct?: boolean; twice?: boolean } = {},
    ) {
      const before = toolLogs().length;
      const request = { __tool: tool, __direct: mode.direct === true, __twice: mode.twice === true, ...args };
      await runCauseEffect(
        agents.sendMessage({ agentId, text: `${CALL_MARK} <<ARGS${JSON.stringify(request)}ARGS>>` }, PERSON),
      );
      const count = mode.twice ? 2 : 1;
      const entries = await waitFor(`${name} tool result`, () => {
        const logs = toolLogs().slice(before);
        return logs.length >= count && logs;
      });
      await idle(agentId);
      return entries.map((entry) => {
        const text = entry.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(entry.error);
        report.calls.push({ name, turnId: entry.turnId, success: entry.result?.success ?? null, text });
        return { success: entry.result?.success === true, text };
      });
    },
    async stop() {
      await runCauseEffect(agents.stop()).catch(() => {});
      database.close();
    },
  };
}

type Host = Awaited<ReturnType<typeof startHost>>;
const hosts: Host[] = [];

try {
  await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
  const host = await startHost(userData, true);
  hosts.push(host);
  const maker = await host.create("Maker");
  const other = await host.create("Other");
  const fileOf = async (workspace: string, name: string) => {
    const path = join(workspace, name);
    await writeFile(path, `${name}\n`);
    return path;
  };
  const attach = async (name: string, agentId: string, file: string, folder?: string | number, twice = false) => {
    const results = await host.call(
      name,
      agentId,
      "attach_files_to_response",
      { paths: [file], ...(folder === undefined ? {} : { folder }) },
      { direct: true, twice },
    );
    return results.map((result) => ({
      ...result,
      attached: result.success ? attachedSchema.parse(JSON.parse(result.text)) : null,
    }));
  };
  const one = async (name: string, agentId: string, file: string, folder?: string | number) => {
    const [result] = await attach(name, agentId, file, folder);
    if (!result) throw new Error(`${name}: no tool result.`);
    return result;
  };
  const list = async (name: string, agentId: string, folder?: string) => {
    const [result] = await host.call(name, agentId, "list_library_folders", folder === undefined ? {} : { folder });
    if (!result) throw new Error(`${name}: no tool result.`);
    return { ...result, listing: result.success ? listingSchema.parse(JSON.parse(result.text)) : null };
  };
  /** The stored folder with this path of names, for an agent. */
  const storedFolder = (agentId: string, ...names: string[]) => {
    const { folders } = host.stored();
    let parentId: string | undefined;
    let found: (typeof folders)[number] | undefined;
    for (const name of names) {
      found = folders.find(
        (folder) => folder.agentId === agentId && folder.parentId === parentId && folder.name === name,
      );
      if (!found) return null;
      parentId = found.id;
    }
    return found ?? null;
  };
  const storedFileIds = () => new Set(host.mailbox.listStoredFiles().map((file) => file.attachment.id));

  // 1. A path makes each level, and the file goes into the last one.
  pass("A host with no folder has no folders file", !host.hasFoldersFile());
  const first = await one(
    "attach with a new path",
    maker.id,
    await fileOf(maker.workspacePath, "hero.txt"),
    "Autumn campaign/Images",
  );
  const firstId = first.attached?.attachments[0]?.id ?? "";
  const campaign = storedFolder(maker.id, "Autumn campaign");
  const images = storedFolder(maker.id, "Autumn campaign", "Images");
  pass(
    "The result names the folder path and says that it is new",
    first.success &&
      first.attached?.folder !== undefined &&
      "path" in first.attached.folder &&
      first.attached.folder.path === "Autumn campaign/Images" &&
      first.attached.folder.created,
    first.text,
  );
  pass(
    "The folders file has the two levels and the file in the last one",
    campaign !== null &&
      images !== null &&
      campaign.parentId === undefined &&
      host.stored().folders.length === 2 &&
      host.stored().placement[firstId] === images.id,
    JSON.stringify(host.stored()),
  );
  const firstStored = host.mailbox.listStoredFiles().find((file) => file.attachment.id === firstId);
  pass(
    "The attached file is a stored file of the agent that attached it",
    firstStored?.agentId === maker.id && firstStored.attachment.name === "hero.txt" && existsSync(firstStored.path),
    JSON.stringify(firstStored),
  );

  // 2. The same path in a different letter case uses the same folders.
  const second = await one(
    "attach with the path in a different case",
    maker.id,
    await fileOf(maker.workspacePath, "banner.txt"),
    "autumn CAMPAIGN/images/",
  );
  const secondId = second.attached?.attachments[0]?.id ?? "";
  pass(
    "A different letter case makes no folder",
    second.success &&
      second.attached?.folder !== undefined &&
      "path" in second.attached.folder &&
      second.attached.folder.path === "Autumn campaign/Images" &&
      !second.attached.folder.created &&
      host.stored().folders.length === 2 &&
      host.stored().placement[secondId] === images?.id,
    second.text,
  );

  // 3. A new folder in a folder that the agent has; a folder at the top level.
  const video = await one(
    "attach with one new level",
    maker.id,
    await fileOf(maker.workspacePath, "teaser.txt"),
    "Autumn campaign/Video",
  );
  const reports = await one(
    "attach with a top-level folder",
    maker.id,
    await fileOf(maker.workspacePath, "summary.txt"),
    "Reports",
  );
  pass(
    "A path makes only the levels that the agent does not have",
    video.attached?.folder !== undefined &&
      "created" in video.attached.folder &&
      video.attached.folder.created &&
      storedFolder(maker.id, "Autumn campaign", "Video")?.parentId === campaign?.id &&
      reports.attached?.folder !== undefined &&
      "created" in reports.attached.folder &&
      reports.attached.folder.created &&
      storedFolder(maker.id, "Reports") !== null &&
      host.stored().folders.length === 4,
    `${video.text}\n${reports.text}`,
  );

  // 4. A path that cannot be used keeps the attachment, in no folder.
  const beforeBad = host.stored();
  const tooDeep = await one(
    "attach with six levels",
    maker.id,
    await fileOf(maker.workspacePath, "deep.txt"),
    "a/b/c/d/e/f",
  );
  const longName = await one(
    "attach with a long name",
    maker.id,
    await fileOf(maker.workspacePath, "long.txt"),
    `Reports/${"n".repeat(LIBRARY_FOLDER_LIMITS.name + 1)}`,
  );
  const noName = await one(
    "attach with no folder name",
    maker.id,
    await fileOf(maker.workspacePath, "slash.txt"),
    " / ",
  );
  for (const [label, result, reason] of [
    ["six levels", tooDeep, `at most ${LIBRARY_FOLDER_LIMITS.levels} levels`],
    ["a long name", longName, `at most ${LIBRARY_FOLDER_LIMITS.name} characters`],
    ["no name", noName, "must name a Library folder"],
  ] as const) {
    const folder = result.attached?.folder;
    const id = result.attached?.attachments[0]?.id ?? "";
    pass(
      `A path with ${label} keeps the attachment and gives the reason`,
      result.success &&
        folder !== undefined &&
        "placed" in folder &&
        folder.reason.includes(reason) &&
        storedFileIds().has(id) &&
        host.stored().placement[id] === undefined,
      result.text,
    );
  }
  pass(
    "A refused path changes nothing in the folders file",
    JSON.stringify(host.stored()) === JSON.stringify(beforeBad),
  );

  // 5. No folder argument: the result has no folder, as before this change.
  const plain = await one("attach with no folder", maker.id, await fileOf(maker.workspacePath, "plain.txt"));
  pass(
    "An attach call with no folder puts the file in no folder",
    plain.success &&
      plain.attached?.folder === undefined &&
      host.stored().placement[plain.attached?.attachments[0]?.id ?? ""] === undefined,
    plain.text,
  );

  // 6. A folder that is not text fails the call, and no file is attached.
  const filesBefore = storedFileIds().size;
  const notText = await one(
    "attach with a number as folder",
    maker.id,
    await fileOf(maker.workspacePath, "number.txt"),
    5,
  );
  pass(
    "A folder that is not text is refused",
    !notText.success && notText.text.includes("folder") && storedFileIds().size === filesBefore,
    notText.text,
  );

  // 7. The same call a second time makes one message and no second folder.
  const twice = await attach(
    "attach two times with one call id",
    maker.id,
    await fileOf(maker.workspacePath, "retry.txt"),
    "Retry",
    true,
  );
  const [retryFirst, retrySecond] = twice;
  pass(
    "A repeated call gives one message, one file and one folder",
    twice.length === 2 &&
      retryFirst?.attached !== null &&
      retrySecond?.attached !== null &&
      retryFirst?.attached?.messageId === retrySecond?.attached?.messageId &&
      retryFirst?.attached?.attachments[0]?.id === retrySecond?.attached?.attachments[0]?.id &&
      retrySecond?.attached?.folder !== undefined &&
      "path" in retrySecond.attached.folder &&
      retrySecond.attached.folder.path === "Retry" &&
      storedFileIds().size === filesBefore + 1 &&
      host.stored().folders.filter((folder) => folder.name === "Retry").length === 1 &&
      host.stored().placement[retryFirst?.attached?.attachments[0]?.id ?? ""] === storedFolder(maker.id, "Retry")?.id,
    twice.map((result) => result.text).join("\n"),
  );

  // 8. list_library_folders answers the folders with their files, and the files in no folder.
  const all = await list("list the folders", maker.id);
  const listedImages = all.listing?.folders.find((folder) => folder.path === "Autumn campaign/Images");
  pass(
    "The list has each folder path in tree order",
    all.success &&
      JSON.stringify(all.listing?.folders.map((folder) => folder.path)) ===
        JSON.stringify(["Autumn campaign", "Autumn campaign/Images", "Autumn campaign/Video", "Reports", "Retry"]),
    all.text,
  );
  pass(
    "A folder has its files, with the id, name and stored path of each",
    listedImages?.fileCount === 2 &&
      JSON.stringify(listedImages.files.map((file) => file.id).sort()) === JSON.stringify([firstId, secondId].sort()) &&
      listedImages.files.some((file) => file.name === "hero.txt") &&
      listedImages.files.every((file) => existsSync(file.path)),
    all.text,
  );
  // deep.txt, long.txt, slash.txt and plain.txt.
  pass(
    "The list counts the files in no folder",
    all.listing?.unfiled === 4 && all.listing.truncated === false,
    all.text,
  );
  const branch = await list("list one folder", maker.id, "autumn campaign");
  pass(
    "A folder argument limits the list to that folder and the folders in it",
    JSON.stringify(branch.listing?.folders.map((folder) => folder.path)) ===
      JSON.stringify(["Autumn campaign", "Autumn campaign/Images", "Autumn campaign/Video"]),
    branch.text,
  );
  const missing = await list("list an unknown folder", maker.id, "Winter");
  pass(
    "An unknown folder is a failed result that says so",
    !missing.success && missing.text.includes("You have no Library folder") && missing.text.includes("Winter"),
    missing.text,
  );

  // 9. An agent sees and uses only its own folders.
  const empty = await list("list as an agent with no folder", other.id);
  pass(
    "An agent does not see the folders or files of a different agent",
    empty.success && empty.listing?.folders.length === 0 && empty.listing.unfiled === 0,
    empty.text,
  );
  const sameName = await one(
    "attach as a different agent",
    other.id,
    await fileOf(other.workspacePath, "own.txt"),
    "Reports",
  );
  pass(
    "The same folder name of a different agent is a new folder of that agent",
    sameName.attached?.folder !== undefined &&
      "created" in sameName.attached.folder &&
      sameName.attached.folder.created &&
      storedFolder(other.id, "Reports") !== null &&
      storedFolder(other.id, "Reports")?.id !== storedFolder(maker.id, "Reports")?.id,
    sameName.text,
  );

  const names = new Map(host.stored().folders.map((folder) => [folder.id, folder]));
  const pathOf = (id: string): string => {
    const folder = names.get(id);
    if (!folder) return "";
    return folder.parentId === undefined ? folder.name : `${pathOf(folder.parentId)}/${folder.name}`;
  };
  report.storedFolders = host.stored().folders.map((folder) => ({
    path: pathOf(folder.id),
    files: Object.values(host.stored().placement).filter((folderId) => folderId === folder.id).length,
  }));

  // 10. A full store refuses a new folder: the file stays attached, in no folder.
  const store = host.libraryFolders;
  if (!store) throw new Error("The host has no Library folders store.");
  const context = { agentIds: new Set([maker.id]), fileAgent: () => undefined };
  for (let count = host.stored().folders.length; count < LIBRARY_FOLDER_LIMITS.folders; count += 1) {
    await runCauseEffect(
      store.mutate({ type: "create", id: randomUUID(), agentId: maker.id, name: `Fill ${count}` }, context),
    );
  }
  const full = await one(
    "attach when the store is full",
    maker.id,
    await fileOf(maker.workspacePath, "full.txt"),
    "One more",
  );
  const fullFolder = full.attached?.folder;
  pass(
    "A full store keeps the attachment and gives the reason",
    full.success &&
      fullFolder !== undefined &&
      "placed" in fullFolder &&
      fullFolder.reason.includes(String(LIBRARY_FOLDER_LIMITS.folders)) &&
      storedFileIds().has(full.attached?.attachments[0]?.id ?? "") &&
      host.stored().folders.length === LIBRARY_FOLDER_LIMITS.folders,
    full.text,
  );
  const existing = await one(
    "attach to a folder of a full store",
    maker.id,
    await fileOf(maker.workspacePath, "fits.txt"),
    "Reports",
  );
  pass(
    "A full store still takes a file in a folder that the agent has",
    existing.attached?.folder !== undefined && "path" in existing.attached.folder && !existing.attached.folder.created,
    existing.text,
  );

  // 10b. The start of the app removes the entry of a file that went on a path that does not tell the
  // folders, such as the delete of a chat. The entries of the files that the host has stay.
  const reportsFolder = storedFolder(maker.id, "Reports");
  if (!reportsFolder) throw new Error("The agent has no Reports folder.");
  const goneFileId = randomUUID();
  await runCauseEffect(
    store.mutate(
      { type: "place", fileIds: [goneFileId], folderId: reportsFolder.id },
      { agentIds: new Set([maker.id]), fileAgent: (fileId) => (fileId === goneFileId ? maker.id : undefined) },
    ),
  );
  const keptBefore = Object.keys(host.stored().placement).filter((fileId) => fileId !== goneFileId);
  await runCauseEffect(
    store.reconcileFiles(new Set(host.mailbox.listStoredFiles().map((stored) => stored.attachment.id))),
  );
  const placementAfter = host.stored().placement;
  pass(
    "The start removes the entry of a file that the host no longer has, and keeps the others",
    keptBefore.length > 0 &&
      !(goneFileId in placementAfter) &&
      keptBefore.every((fileId) => placementAfter[fileId] !== undefined),
    JSON.stringify({ keptBefore: keptBefore.length, after: Object.keys(placementAfter).length }),
  );

  // 10c. The level limit does not depend on the sequence of the folders: Undo of a folder delete puts
  // the folder back before its parent, and a parent that went to level 5 meanwhile makes it level 6.
  const fills = host.stored().folders.filter((folder) => folder.name.startsWith("Fill "));
  for (const fill of fills.slice(0, 6))
    await runCauseEffect(store.mutate({ type: "delete", folderId: fill.id }, context));
  const make = async (name: string, parentId?: string) => {
    const id = randomUUID();
    await runCauseEffect(
      store.mutate({ type: "create", id, agentId: maker.id, name, ...(parentId ? { parentId } : {}) }, context),
    );
    return id;
  };
  const parent = await make("Undo parent");
  const child = await make("Undo child", parent);
  let chain = await make("Level 1");
  for (let level = 2; level < LIBRARY_FOLDER_LIMITS.levels; level += 1) chain = await make(`Level ${level}`, chain);
  const childEntry = {
    folder: store.getSnapshot().folders.find((folder) => folder.id === child),
    index: store.getSnapshot().folders.findIndex((folder) => folder.id === child),
  };
  if (!childEntry.folder) throw new Error("The child folder is missing.");
  await runCauseEffect(store.mutate({ type: "delete", folderId: child }, context));
  await runCauseEffect(
    store.mutate({ type: "move", folderId: parent, parentId: chain, beforeFolderId: null }, context),
  );
  await runCauseEffect(
    store.mutate(
      { type: "restore", folders: [{ folder: childEntry.folder, index: childEntry.index }], placement: {} },
      context,
    ),
  );
  const restoredFolders = store.getSnapshot().folders;
  const restoredChild = restoredFolders.find((folder) => folder.id === child);
  const depthOf = (id: string): number => libraryFolderPath(restoredFolders, id).length;
  pass(
    "Undo never puts a folder deeper than the level limit",
    restoredChild !== undefined &&
      restoredFolders.findIndex((folder) => folder.id === child) <
        restoredFolders.findIndex((folder) => folder.id === parent) &&
      depthOf(parent) === LIBRARY_FOLDER_LIMITS.levels &&
      restoredChild.parentId === undefined &&
      restoredFolders.every((folder) => depthOf(folder.id) <= LIBRARY_FOLDER_LIMITS.levels),
    JSON.stringify({ parent: depthOf(parent), child: depthOf(child), childParent: restoredChild?.parentId ?? null }),
  );

  // 11. A host with no Library folders store: the file is attached, and the result says so.
  const bare = await startHost(join(root, "user-data-bare"), false);
  hosts.push(bare);
  const solo = await bare.create("Solo");
  const soloPath = join(solo.workspacePath, "solo.txt");
  await writeFile(soloPath, "solo\n");
  const [unavailable] = await bare.call(
    "attach on a host with no folders",
    solo.id,
    "attach_files_to_response",
    { paths: [soloPath], folder: "Reports" },
    { direct: true },
  );
  const unavailableResult = unavailable?.success ? attachedSchema.parse(JSON.parse(unavailable.text)) : null;
  pass(
    "With no store the file is attached and the result says that folders are not available",
    unavailableResult?.folder !== undefined &&
      "placed" in unavailableResult.folder &&
      unavailableResult.folder.reason.includes("not available") &&
      bare.mailbox.listStoredFiles().some((file) => file.attachment.id === unavailableResult.attachments[0]?.id) &&
      !bare.hasFoldersFile(),
    unavailable?.text,
  );
  const [unavailableList] = await bare.call("list on a host with no folders", solo.id, "list_library_folders", {});
  pass(
    "With no store list_library_folders is a failed result",
    unavailableList?.success === false && unavailableList.text.includes("not available"),
    unavailableList?.text,
  );

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  for (const host of hosts) await host.stop();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
