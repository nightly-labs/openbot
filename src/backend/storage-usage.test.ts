// @vitest-environment node

import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageUsage } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailboxStoredFile } from "./mailbox-store";
import { OpenBotDatabase } from "./openbot-database";
import { type StorageRoots, StorageUsageScanner, StorageUsageService, type StorageUsageSources } from "./storage-usage";

const roots: string[] = [];
const databases: OpenBotDatabase[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function file(path: string, bytes: number): Promise<string> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "x".repeat(bytes));
  return path;
}

function stored(id: string, path: string, patch: Partial<MailboxStoredFile> = {}): MailboxStoredFile {
  return {
    attachment: {
      id,
      name: `${id}.pdf`,
      size: 5,
      kind: "file",
      mimeType: "application/pdf",
      previewKind: "pdf",
      previewUrl: null,
    },
    path,
    source: "attachment",
    messageId: null,
    agentId: null,
    createdAt: null,
    ...patch,
  };
}

async function host() {
  const root = await mkdtemp(join(tmpdir(), "openbot-storage-usage-"));
  roots.push(root);
  const database = new OpenBotDatabase(join(root, "userData"));
  await database.initialize();
  databases.push(database);
  const db = database.connection;
  const thread = db.prepare(
    `INSERT INTO projection_threads (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
     VALUES (?, ?, ?, NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)`,
  );
  thread.run("thread-chief", "chief", "Quarterly report");
  thread.run("thread-writer", "writer", "Blog post");
  thread.run("thread-channel", "chief", "Channel context");
  db.prepare("INSERT INTO projection_channels (channel_id, channel_json) VALUES ('channel-1', '{}')").run();
  db.prepare(
    "INSERT INTO projection_channel_contexts (channel_id, agent_id, thread_id) VALUES ('channel-1', 'chief', 'thread-channel')",
  ).run();
  const message = db.prepare(
    `INSERT INTO projection_thread_messages
       (thread_id, message_id, turn_id, author, status, item_type, created_at, ordinal, message_json, last_event_sequence)
     VALUES (?, ?, NULL, 'user', 'complete', NULL, '2026-09-01T00:00:00.000Z', ?, ?, 1)`,
  );
  message.run("thread-chief", "message-1", 1, '{"text":"one"}');
  message.run("thread-chief", "message-2", 2, '{"text":"two"}');
  message.run("thread-writer", "message-3", 1, '{"text":"żółw"}');
  message.run("thread-channel", "message-4", 1, '{"text":"hidden"}');
  db.prepare(
    `INSERT INTO projection_attachments
       (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
     VALUES ('thread-chief:message-1:sent', 'thread-message', 'thread-chief:message-1', 'sent.pdf', '', '{}',
             '2026-09-02T00:00:00.000Z', 1)`,
  ).run();

  await file(join(root, "outside", "large.bin"), 1_000);
  await file(join(root, "workspaces", "chief", "notes.md"), 11);
  await symlink(join(root, "outside"), join(root, "workspaces", "chief", "linked"));
  await file(join(root, "workspaces", "writer", "draft.md"), 13);
  const sent = await file(join(root, "transfers", "sent.pdf"), 5);
  await file(join(root, "downloads", "page.html"), 7);
  await file(join(root, "remote-attachments", "copy.pdf"), 3);
  await file(join(root, "logs", "remote", "remote.log"), 4);
  await file(join(root, "logs", "remote", "remote.log.1"), 2);
  await file(join(root, "logs", "remote", "transfers", "journal.json"), 10);
  // A stored path that is a link counts as missing, so the scan never reports a file outside its roots.
  await mkdir(join(root, "transfers", "generated"), { recursive: true });
  await symlink(join(root, "outside", "large.bin"), join(root, "transfers", "generated", "drawn.png"));

  const storageRoots: StorageRoots = {
    database: database.path,
    downloads: join(root, "downloads"),
    caches: [join(root, "remote-attachments")],
    logs: [join(root, "logs", "remote")],
    runtimes: null,
    data: root,
  };
  const files = [
    stored("sent", sent, { messageId: "message-1", createdAt: "2026-09-02T00:00:00.000Z" }),
    stored("drawn", join(root, "transfers", "generated", "drawn.png"), { source: "generated", agentId: "writer" }),
  ];
  const sources: StorageUsageSources = {
    roots: storageRoots,
    database: () => db,
    mailbox: { listStoredFiles: () => files, deleteStoredFile: vi.fn(async () => undefined) },
    agents: () => [
      { id: "chief", workspacePath: join(root, "workspaces", "chief") },
      { id: "writer", workspacePath: join(root, "workspaces", "writer") },
    ],
  };
  return { root, sources };
}

const bytesOf = (usage: StorageUsage) => Object.fromEntries(usage.breakdown.map((row) => [row.category, row.bytes]));

describe("StorageUsageScanner", () => {
  it("measures every location, places a sent file in its chat, and does not follow a link", async () => {
    const { sources } = await host();
    const usage = await new StorageUsageScanner(sources).scan({ scope: "host" });

    expect(bytesOf(usage)).toMatchObject({
      workspaces: 24,
      attachments: 5,
      generated: 0,
      downloads: 7,
      caches: 3,
      runtimes: 0,
      logs: 6,
    });
    expect(bytesOf(usage).chats).toBeGreaterThan(0);
    expect(usage.breakdown.filter((row) => row.removable).map((row) => row.category)).toEqual(["caches", "logs"]);
    expect(usage.files).toEqual([
      expect.objectContaining({
        id: "sent",
        conversation: { id: "thread-chief", title: "Quarterly report" },
        messageId: "message-1",
        agentId: "chief",
        status: "available",
        deletable: true,
      }),
      expect.objectContaining({ id: "drawn", conversation: null, agentId: "writer", status: "missing" }),
    ]);
    // A channel context is internal and never shows as a chat.
    expect(usage.conversations.map((row) => [row.id, row.messageCount, row.fileCount])).toEqual([
      ["thread-chief", 2, 1],
      ["thread-writer", 1, 0],
    ]);
    expect(usage.agents.find((row) => row.agentId === "chief")).toMatchObject({ fileCount: 1, conversationCount: 1 });
    expect(usage.truncated).toBe(false);
  });

  it("cuts a scope to one agent or one chat", async () => {
    const { sources } = await host();
    const scanner = new StorageUsageScanner(sources);

    const writer = await scanner.scan({ scope: "agent", agentId: "writer" });
    expect(writer).toMatchObject({ scope: "agent", agentId: "writer", conversationId: null });
    expect(bytesOf(writer)).toMatchObject({ workspaces: 13, attachments: 0 });
    expect(writer.files.map((row) => row.id)).toEqual(["drawn"]);
    expect(writer.conversations.map((row) => row.id)).toEqual(["thread-writer"]);

    const chat = await scanner.scan({ scope: "conversation", conversationId: "thread-chief" });
    expect(chat.files.map((row) => row.id)).toEqual(["sent"]);
    expect(chat.conversations).toEqual([expect.objectContaining({ id: "thread-chief", fileCount: 1 })]);
    expect(bytesOf(chat).workspaces).toBeUndefined();

    await expect(scanner.scan({ scope: "agent", agentId: "gone" })).rejects.toThrow("The agent does not exist.");
  });

  it("counts a file shown in two agents' chats for both agents, as the agent scope does", async () => {
    const { sources } = await host();
    sources
      .database()
      .prepare(
        `INSERT INTO projection_attachments
           (attachment_id, owner_kind, owner_id, name, path, metadata_json, created_at, last_event_sequence)
         VALUES ('thread-writer:message-3:sent', 'thread-message', 'thread-writer:message-3', 'sent.pdf', '', '{}',
                 '2026-09-03T00:00:00.000Z', 1)`,
      )
      .run();
    const scanner = new StorageUsageScanner(sources);

    const usage = await scanner.scan({ scope: "host" });
    const writer = await scanner.scan({ scope: "agent", agentId: "writer" });
    const writerRow = usage.agents.find((row) => row.agentId === "writer");
    expect(usage.agents.find((row) => row.agentId === "chief")).toMatchObject({ fileCount: 1 });
    expect(writerRow).toMatchObject({ fileCount: 2 });
    expect(writer.files.map((row) => row.id).sort()).toEqual(["drawn", "sent"]);
    expect(writerRow?.bytes).toBe(writer.agents[0]?.bytes);
  });

  it("sends the largest files and marks the answer truncated past the limit", async () => {
    const { sources, root } = await host();
    const many = Array.from({ length: 2_001 }, (_, index) => stored(`file-${index}`, join(root, "none", `${index}`)));
    const usage = await new StorageUsageScanner({
      ...sources,
      mailbox: { ...sources.mailbox, listStoredFiles: () => many },
    }).scan({ scope: "host" });

    expect(usage.files).toHaveLength(2_000);
    expect(usage.truncated).toBe(true);
  });
});

describe("StorageUsageService", () => {
  it("shares one scan between two callers and drops the answer after a delete", async () => {
    const { sources } = await host();
    const scanner = new StorageUsageScanner(sources);
    const scan = vi.spyOn(scanner, "scan");
    const service = new StorageUsageService(scanner, sources);

    const [first, second] = await Promise.all([service.usage({ scope: "host" }), service.usage({ scope: "host" })]);
    expect(second).toBe(first);
    expect(await service.usage({ scope: "host" })).toBe(first);
    expect(scan).toHaveBeenCalledTimes(1);

    await service.deleteFile("sent");
    expect(sources.mailbox.deleteStoredFile).toHaveBeenCalledWith("sent");
    await service.usage({ scope: "host" });
    await service.usage({ scope: "host", force: true });
    expect(scan).toHaveBeenCalledTimes(3);
  });

  it("clears the rotated logs and the caches but keeps the transfer journal", async () => {
    const { sources, root } = await host();
    const service = new StorageUsageService(new StorageUsageScanner(sources), sources);

    await service.clear("logs");
    expect(await readdir(join(root, "logs", "remote"))).toEqual(["transfers"]);
    expect(await readdir(join(root, "logs", "remote", "transfers"))).toEqual(["journal.json"]);

    await service.clear("caches");
    expect(await readdir(join(root, "remote-attachments"))).toEqual([]);
    expect(await readdir(join(root, "downloads"))).toEqual(["page.html"]);
  });
});
