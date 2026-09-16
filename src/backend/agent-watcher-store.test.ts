// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRoutineStore } from "./agent-routine-store";
import { AgentWatcherStore } from "./agent-watcher-store";
import { OpenBotDatabase } from "./openbot-database";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AgentWatcherStore", () => {
  it("creates, lists, updates, and deletes a watcher", async () => {
    const { database, watchers } = await setup();
    try {
      const watcher = watchers.create({
        agentId: "chief",
        routineId: routineIdFor(database, "chief"),
        name: "Price watch",
        active: true,
        intervalMinutes: 15,
        source: { kind: "web", url: "https://example.com/item" },
        selector: { css: ".price", textAnchor: "Price" },
        condition: { textContains: "price" },
      });
      expect(watchers.list("chief")).toHaveLength(1);
      const updated = watchers.update({ agentId: "chief", watcherId: watcher.id, intervalMinutes: 30 });
      expect(updated.intervalMinutes).toBe(30);
      watchers.delete("chief", watcher.id);
      expect(watchers.list("chief")).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("dedupes matches by source id", async () => {
    const { database, watchers } = await setup();
    try {
      const watcher = watchers.create({
        agentId: "chief",
        routineId: routineIdFor(database, "chief"),
        name: "Inbox watch",
        active: true,
        intervalMinutes: 5,
        source: { kind: "gmail", query: "from:acme" },
      });
      const first = watchers.recordMatch(watcher, "msg-1", "Mail", "Hello");
      const second = watchers.recordMatch(watcher, "msg-1", "Mail", "Hello");
      expect(first?.sourceId).toBe("msg-1");
      expect(second).toBeNull();
      expect(watchers.listMatches("chief", watcher.id, 10)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("quarantines after repeated check errors", async () => {
    const { database, watchers } = await setup();
    try {
      let watcher = watchers.create({
        agentId: "chief",
        routineId: routineIdFor(database, "chief"),
        name: "Flaky watch",
        active: true,
        intervalMinutes: 5,
        source: { kind: "web", url: "https://example.com/flaky" },
      });
      for (let index = 0; index < 5; index += 1) {
        watcher = watchers.recordCheck(watcher, { stateHash: null, error: "boom" });
      }
      expect(watcher.health).toBe("quarantined");
      expect(watcher.errorCount).toBe(5);
    } finally {
      database.close();
    }
  });
});

async function setup(): Promise<{ database: OpenBotDatabase; watchers: AgentWatcherStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-watcher-store-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await database.initialize();
  return { database, watchers: new AgentWatcherStore(database) };
}

function routineIdFor(database: OpenBotDatabase, agentId: string): string {
  return new AgentRoutineStore(database).create({
    agentId,
    name: "Handle change",
    instruction: "Read watcher matches and act.",
    active: true,
    timezone: "UTC",
    schedule: { kind: "hourly", minute: 0 },
  }).id;
}
