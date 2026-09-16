// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRoutineStore } from "../agent-routine-store";
import { AgentStore } from "../agent-store";
import { AgentWatcherStore } from "../agent-watcher-store";
import { OpenBotDatabase } from "../openbot-database";
import { RoutineTimer } from "../routine-timer";
import { ConversationRuntime } from "./conversation-runtime";
import { WatcherScheduler } from "./watcher-scheduler";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WatcherScheduler", () => {
  it("fires the linked routine once per new gmail message", async () => {
    const { database, scheduler, watcher, fireRoutine } = await setup({
      source: { kind: "gmail", query: "from:acme" },
      condition: {},
      facts: [
        { sourceId: "msg-1", text: "Invoice 1", summary: "Mail msg-1" },
        { sourceId: "msg-2", text: "Invoice 2", summary: "Mail msg-2" },
      ],
    });
    try {
      await scheduler.processDue(new Date("2026-09-01T00:20:00.000Z"));
      expect(fireRoutine).toHaveBeenCalledTimes(1);
      const store = new AgentWatcherStore(database);
      expect(store.listMatches("chief", watcher.id, 10)).toHaveLength(2);
      await scheduler.processDue(new Date("2026-09-01T00:40:00.000Z"));
      expect(fireRoutine).toHaveBeenCalledTimes(1);
    } finally {
      database.close();
    }
  });

  it("baselines first, then fires web watchers only when blocks change", async () => {
    let text = "A Light in the Attic is a poetry book for children. Price: £51.77. In stock and ready to ship.";
    const { database, scheduler, watcher, fireRoutine } = await setup({
      source: { kind: "web", url: "https://example.com/item" },
      condition: {},
      readPageText: async () => text,
    });
    try {
      await scheduler.processDue(new Date("2026-09-01T00:20:00.000Z"));
      expect(fireRoutine).not.toHaveBeenCalled();
      await scheduler.processDue(new Date("2026-09-01T01:20:00.000Z"));
      expect(fireRoutine).not.toHaveBeenCalled();
      text = "A Light in the Attic is a poetry book for children. Price: £43.21. In stock and ready to ship.";
      await scheduler.processDue(new Date("2026-09-01T02:20:00.000Z"));
      expect(fireRoutine).toHaveBeenCalledTimes(1);
      const store = new AgentWatcherStore(database);
      const matches = store.listMatches("chief", watcher.id, 10);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.diff ?? "").toContain("£43.21");
    } finally {
      database.close();
    }
  });

  it("ignores rank and count churn without firing", async () => {
    let text = "Hacker News today. Story one is live today. Story two is live today.";
    const { database, scheduler, fireRoutine } = await setup({
      source: { kind: "web", url: "https://example.com/news" },
      condition: {},
      readPageText: async () => text,
    });
    try {
      await scheduler.processDue(new Date("2026-09-01T00:20:00.000Z"));
      text =
        "Hacker News today. 2. Story two is live today 47 points 6 hours ago. 1. Story one is live today 121 points 4 hours ago.";
      await scheduler.processDue(new Date("2026-09-01T01:20:00.000Z"));
      expect(fireRoutine).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("skips facts that miss the condition and costs no routine run", async () => {
    const { database, scheduler, fireRoutine } = await setup({
      source: { kind: "gmail", query: "from:acme" },
      condition: { textContains: "acme" },
      facts: [{ sourceId: "msg-9", text: "Unrelated newsletter", summary: "Mail msg-9" }],
    });
    try {
      await scheduler.processDue(new Date("2026-09-01T00:20:00.000Z"));
      expect(fireRoutine).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("holds fire on thin app shells and marks the check weak", async () => {
    const { database, scheduler, watcher, fireRoutine } = await setup({
      source: { kind: "web", url: "https://example.com/app" },
      condition: {},
      fetchHtml: async () =>
        '<html><body><div id="root"></div><script>window.__NEXT_DATA__={}</script>Loading the application now</body></html>',
    });
    try {
      await scheduler.processDue(new Date("2026-09-01T00:20:00.000Z"));
      expect(fireRoutine).not.toHaveBeenCalled();
      const store = new AgentWatcherStore(database);
      const checked = store.get("chief", watcher.id);
      expect(checked?.health).toBe("weak");
      expect(checked?.lastMode).toBe("fetch");
    } finally {
      database.close();
    }
  });

  it("pauses and resumes a watcher through its tools", async () => {
    const { database, scheduler, watcher } = await setup({
      source: { kind: "web", url: "https://example.com/item" },
      condition: {},
      readPageText: async () => "A calm product page with a stable price list updated weekly for readers.",
    });
    try {
      const paused = await scheduler.handleTool(
        {
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-2",
          namespace: "openbot",
          tool: "pause_watcher",
          arguments: { watcherId: watcher.id },
        },
        "chief",
      );
      expect(paused?.success).toBe(true);
      const store = new AgentWatcherStore(database);
      expect(store.get("chief", watcher.id)?.active).toBe(false);
      expect(store.due(new Date("2026-09-01T01:00:00.000Z"))).toHaveLength(0);
      await scheduler.handleTool(
        {
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-3",
          namespace: "openbot",
          tool: "resume_watcher",
          arguments: { watcherId: watcher.id },
        },
        "chief",
      );
      expect(store.get("chief", watcher.id)?.active).toBe(true);
    } finally {
      database.close();
    }
  });

  it("posts pause and resume markers to the conversation", async () => {
    const { database, scheduler, watcher } = await setup({
      source: { kind: "web", url: "https://example.com/item" },
      condition: {},
    });
    try {
      const tool = (callId: string, tool: string) =>
        scheduler.handleTool(
          {
            threadId: "thread-1",
            turnId: "turn-1",
            callId,
            namespace: "openbot",
            tool,
            arguments: { watcherId: watcher.id },
          },
          "chief",
        );
      await tool("call-pause", "pause_watcher");
      await tool("call-resume", "resume_watcher");
      const itemTypes = database.connection
        .prepare("SELECT message_json FROM projection_thread_messages")
        .all()
        .map((row) => {
          if (!isDynamicRecord(row) || !isString(row.message_json)) throw new Error("Invalid message row.");
          const message = JSON.parse(row.message_json);
          if (!isDynamicRecord(message) || !isString(message.itemType)) throw new Error("Invalid message.");
          return message.itemType;
        })
        .filter((itemType) => itemType.startsWith("watcher-event:"));
      expect(itemTypes).toEqual([`watcher-event:paused:${watcher.id}`, `watcher-event:resumed:${watcher.id}`]);
    } finally {
      database.close();
    }
  });

  it("counts fetch errors without firing", async () => {
    const { database, scheduler, watcher, fireRoutine } = await setup({
      source: { kind: "web", url: "https://example.com/down" },
      condition: {},
      fetchHtml: async () => {
        throw new Error("connection reset");
      },
    });
    try {
      await scheduler.processDue(new Date("2026-09-01T00:20:00.000Z"));
      expect(fireRoutine).not.toHaveBeenCalled();
      const store = new AgentWatcherStore(database);
      expect(store.get("chief", watcher.id)?.errorCount).toBe(1);
    } finally {
      database.close();
    }
  });

  it("scopes web matching to the text anchor and passes match context", async () => {
    const filler = "Background story with many words here. ";
    let text = `Price block: £51.77 in stock now. ${filler.repeat(40)}`;
    const { database, scheduler, watcher, fireRoutine } = await setup({
      source: { kind: "web", url: "https://example.com/item" },
      condition: {},
      selector: { textAnchor: "Price block" },
      readPageText: async () => text,
    });
    try {
      await scheduler.processDue(new Date("2026-09-01T00:20:00.000Z"));
      expect(fireRoutine).not.toHaveBeenCalled();
      text = `Price block: £51.77 in stock now. ${filler.repeat(40)} Late breaking extra story arrives here today.`;
      await scheduler.processDue(new Date("2026-09-01T01:20:00.000Z"));
      expect(fireRoutine).not.toHaveBeenCalled();
      text = `Price block: £43.21 in stock now. ${filler.repeat(40)}`;
      await scheduler.processDue(new Date("2026-09-01T02:20:00.000Z"));
      expect(fireRoutine).toHaveBeenCalledTimes(1);
      const context = fireRoutine.mock.calls[0]?.[2] ?? "";
      expect(context).toContain("--- watcher match ---");
      expect(context).toContain("£43.21");
      const store = new AgentWatcherStore(database);
      expect(store.get("chief", watcher.id)?.health).toBe("ok");
    } finally {
      database.close();
    }
  });
});

async function setup(options: {
  source: { kind: "gmail"; query: string } | { kind: "web"; url: string };
  condition: { textContains?: string };
  selector?: { textAnchor?: string };
  facts?: Array<{ sourceId: string; text: string; summary: string }>;
  readPageText?: (url: string) => Promise<string | null>;
  fetchHtml?: (url: string) => Promise<string>;
}) {
  const root = await mkdtemp(join(tmpdir(), "openbot-watcher-scheduler-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  const agentStore = new AgentStore(join(root, "user-data"), join(root, "home"), database);
  await agentStore.initialize();
  await agentStore.getOrCreate("chief");
  const conversation = new ConversationRuntime(
    agentStore,
    () => undefined,
    () => agentStore.list(),
  );
  const routineId = new AgentRoutineStore(database).create({
    agentId: "chief",
    name: "Handle change",
    instruction: "Read watcher matches and act.",
    active: true,
    timezone: "UTC",
    schedule: { kind: "hourly", minute: 0 },
  }).id;
  const store = new AgentWatcherStore(database);
  const watcher = store.create(
    {
      agentId: "chief",
      routineId,
      name: "Test watch",
      active: true,
      intervalMinutes: 5,
      source: options.source,
      condition: options.condition,
      ...(options.selector === undefined ? {} : { selector: options.selector }),
    },
    new Date("2026-09-01T00:00:00.000Z"),
  );
  const events: AgentEvent[] = [];
  const fireRoutine = vi.fn(async (_agentId: string, _routineId: string, _context: string) => "run-1");
  const timer = new RoutineTimer(
    () => [],
    () => true,
    () => undefined,
  );
  const scheduler = new WatcherScheduler({
    database,
    timer,
    conversation,
    hooks: {
      emit: (event) => events.push(event),
      emitError: () => undefined,
      excludedAgents: () => new Set(),
      isRunning: () => true,
      fireRoutine,
      requireKnownAgent: () => undefined,
    },
    sources: {
      listGmail: options.facts
        ? async () => (options.facts ?? []).map((fact) => ({ ...fact, mode: "gmail" as const, shell: false }))
        : undefined,
      readPageText: options.readPageText,
      fetchHtml: options.fetchHtml,
    },
  });
  return { database, scheduler, watcher, fireRoutine, events, conversation };
}
