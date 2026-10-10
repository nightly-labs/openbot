// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMemoryStore } from "./agent-memory-store";
import { AgentStore } from "./agent-store";
import { runCauseEffect } from "./effect-boundary";
import { OpenBotDatabase } from "./openbot-database";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AgentMemoryStore", () => {
  it("creates, updates, and merges exact duplicates", async () => {
    const { database, memories } = await setup();
    const created = memories.createManual("chief", "The user prefers concise status updates.");

    expect(memories.list("chief")).toEqual([created]);
    expect(memories.createManual("chief", "  The user prefers concise status updates.  ")).toEqual(created);
    expect(memories.list("chief")).toHaveLength(1);

    const updated = memories.updateManual("chief", created.id, "The user prefers one-line status updates.");
    expect(updated).toMatchObject({ id: created.id, origin: "manual", sourceTurnId: null });
    expect(memories.list("chief").map((memory) => memory.text)).toEqual(["The user prefers one-line status updates."]);
    database.close();
  });

  it("does not merge texts that differ after input trimming", async () => {
    const { database, memories } = await setup();
    memories.createManual("chief", "The user prefers concise status updates.");
    memories.createManual("chief", "The user prefers concise  status updates.");

    expect(memories.list("chief")).toHaveLength(2);
    database.close();
  });

  it("does not overwrite a manual edit with a stale automatic mutation", async () => {
    const { database, memories } = await setup();
    const created = memories.createManual("chief", "Use Bun for package scripts.");
    const expectedUpdatedAt = created.updatedAt;
    const edited = memories.updateManual("chief", created.id, "Use Bun 1.3 for package scripts.");

    expect(
      memories.saveAutomatic({
        agentId: "chief",
        memoryId: created.id,
        text: "Use npm for package scripts.",
        sourceTurnId: "turn-1",
        expectedUpdatedAt,
      }),
    ).toBeNull();
    expect(memories.get("chief", created.id)).toEqual(edited);
    database.close();
  });

  it("updates a corrected memory without creating a conflicting entry", async () => {
    const { database, memories } = await setup();
    const created = memories.createManual("chief", "The subscription costs $200.");
    const corrected = memories.saveAutomatic({
      agentId: "chief",
      memoryId: created.id,
      text: "The subscription costs $300.",
      sourceTurnId: "turn-correction",
      expectedUpdatedAt: created.updatedAt,
    });

    expect(corrected).toMatchObject({ id: created.id, text: "The subscription costs $300." });
    expect(memories.list("chief")).toHaveLength(1);
    database.close();
  });

  it("keeps memories after the database restarts", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-memory-restart-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    new AgentMemoryStore(database).createManual("chief", "Use metric units.");
    database.close();

    const reopened = new OpenBotDatabase(root);
    await runCauseEffect(reopened.initialize());
    expect(new AgentMemoryStore(reopened).list("chief").map((memory) => memory.text)).toEqual(["Use metric units."]);
    reopened.close();
  });

  it("enforces the per-agent memory limit", async () => {
    const { database, memories } = await setup();
    for (let index = 0; index < INPUT_LIMITS.agentMemories; index += 1) {
      memories.createManual("chief", `Stable memory ${index + 1}`);
    }

    expect(() => memories.createManual("chief", "One memory too many")).toThrow(
      `An agent can have up to ${INPUT_LIMITS.agentMemories} memories.`,
    );
    expect(memories.list("chief")).toHaveLength(INPUT_LIMITS.agentMemories);
    database.close();
  });

  it("reads the limit at each save, and keeps memories past a lowered limit", async () => {
    const { database } = await setup();
    let limit = 3;
    const memories = new AgentMemoryStore(database, () => limit);
    for (const text of ["One.", "Two.", "Three."]) memories.createManual("chief", text);
    expect(() => memories.createManual("chief", "Four.")).toThrow("An agent can have up to 3 memories.");

    limit = 4;
    memories.createManual("chief", "Four.");
    limit = 2;
    expect(memories.duplicate("chief", "copy")).toHaveLength(4);
    expect(memories.list("chief")).toHaveLength(4);
    expect(() => memories.createManual("chief", "Five.")).toThrow("An agent can have up to 2 memories.");
    database.close();
  });

  it("hard-deletes memory text from projections and the event log", async () => {
    const { database, memories } = await setup();
    const secretText = "A unique saved memory value";
    const created = memories.createManual("chief", secretText);

    expect(memories.delete("chief", created.id)).toBe(true);
    expect(memories.list("chief")).toEqual([]);
    const eventPayloads = database.connection
      .prepare("SELECT payload_json FROM orchestration_events WHERE aggregate_id = ?")
      .all(created.id);
    expect(JSON.stringify(eventPayloads)).not.toContain(secretText);
    database.close();
  });

  it("atomically clears one agent without retaining memory text", async () => {
    const { database, memories } = await setup();
    const first = memories.createManual("chief", "First private memory value");
    const second = memories.createManual("chief", "Second private memory value");
    const other = memories.createManual("research", "Research memory stays");

    expect(memories.clear("chief")).toBe(2);
    expect(memories.clear("chief")).toBe(0);
    expect(memories.list("chief")).toEqual([]);
    expect(memories.list("research")).toEqual([other]);

    for (const memory of [first, second]) {
      const eventPayloads = database.connection
        .prepare("SELECT payload_json FROM orchestration_events WHERE aggregate_id = ?")
        .all(memory.id);
      expect(JSON.stringify(eventPayloads)).not.toContain(memory.text);
      expect(eventPayloads).toHaveLength(1);
    }
    database.close();
  });

  it("preserves user choices and rejects stale or foreign selection changes", async () => {
    const { database, memories } = await setup();
    const memory = memories.createManual("chief", "A stable preference.");
    expect(memories.getSelection("chief", memory.id)).toMatchObject({ inclusion: "searchable", revision: 0 });
    memories.setInclusions("chief", [{ memoryId: memory.id, inclusion: "essential", expectedRevision: 0 }], "user");
    expect(() =>
      memories.setInclusions("chief", [{ memoryId: memory.id, inclusion: "searchable", expectedRevision: 1 }], "agent"),
    ).toThrow("user");
    expect(() =>
      memories.setInclusions(
        "research",
        [{ memoryId: memory.id, inclusion: "searchable", expectedRevision: 1 }],
        "user",
      ),
    ).toThrow();
    expect(
      memories.saveAutomatic({
        agentId: "chief",
        memoryId: memory.id,
        text: "A stale correction.",
        sourceTurnId: "turn",
        expectedUpdatedAt: memory.updatedAt,
        expectedSelectionRevision: 0,
      }),
    ).toBeNull();
    memories.setInclusions("chief", [{ memoryId: memory.id, inclusion: "automatic", expectedRevision: 1 }], "user");
    memories.setInclusions("chief", [{ memoryId: memory.id, inclusion: "searchable", expectedRevision: 2 }], "agent");
    expect(memories.getSelection("chief", memory.id)).toMatchObject({
      inclusion: "searchable",
      userControlled: false,
      revision: 3,
    });
    database.close();
  });

  it("checks the final selection budget without partial edits or lost text", async () => {
    const { database, memories } = await setup();
    const first = memories.createManual("chief", `one${"\u0001".repeat(497)}`);
    const second = memories.createManual("chief", `two${"\u0001".repeat(497)}`);
    const third = memories.createManual("chief", `end${"\u0001".repeat(497)}`);
    const short = memories.createManual("chief", "Short memory");
    memories.setInclusions(
      "chief",
      [first, second, short].map((memory) => ({ memoryId: memory.id, inclusion: "essential", expectedRevision: 0 })),
      "agent",
    );
    const before = memories.selectionState("chief");
    expect(() =>
      memories.setInclusions("chief", [{ memoryId: third.id, inclusion: "essential", expectedRevision: 0 }], "agent"),
    ).toThrow("prompt limit");
    expect(memories.selectionState("chief")).toEqual(before);
    expect(() => memories.updateManual("chief", short.id, `replacement${"\u0001".repeat(480)}`)).toThrow(
      "prompt limit",
    );
    expect(memories.get("chief", short.id)).toEqual(short);
    // Adding before removing is safe because the batch checks its final state.
    memories.setInclusions(
      "chief",
      [
        { memoryId: third.id, inclusion: "essential", expectedRevision: 0 },
        { memoryId: first.id, inclusion: "searchable", expectedRevision: 1 },
      ],
      "agent",
    );
    expect(memories.selectionState("chief").usedBytes).toBeLessThanOrEqual(8192);
    expect(memories.list("chief")).toHaveLength(4);
    database.close();
  });

  it("keeps explicit user choices and their budget when initializing an import", async () => {
    const { database, memories } = await setup();
    const entries = ["one", "two", "new", "end"].map((prefix) =>
      memories.createManual("chief", `${prefix}${"\u0001".repeat(497)}`),
    );
    const essential = entries[0];
    const searchable = entries[1];
    if (!essential || !searchable) throw new Error("Missing fixture memory.");
    memories.setInclusions(
      "chief",
      [
        { memoryId: essential.id, inclusion: "essential", expectedRevision: 0 },
        { memoryId: searchable.id, inclusion: "searchable", expectedRevision: 0 },
      ],
      "user",
    );
    memories.initializeSelection("chief");
    expect(memories.getSelection("chief", essential.id)).toMatchObject({
      inclusion: "essential",
      userControlled: true,
    });
    expect(memories.getSelection("chief", searchable.id)).toMatchObject({
      inclusion: "searchable",
      userControlled: true,
    });
    expect(memories.listSelections("chief").filter((entry) => entry.inclusion === "essential")).toHaveLength(2);
    expect(memories.selectionState("chief").usedBytes).toBeLessThanOrEqual(8192);
    database.close();
  });

  it("preserves selection when duplicate texts merge and refuses conflicting user choices", async () => {
    const { database, memories } = await setup();
    const essential = memories.createManual("chief", "An essential original.");
    const survivor = memories.createManual("chief", "The corrected fact already exists.");
    memories.setInclusions("chief", [{ memoryId: essential.id, inclusion: "essential", expectedRevision: 0 }], "user");
    expect(memories.updateManual("chief", essential.id, survivor.text).id).toBe(survivor.id);
    expect(memories.getSelection("chief", survivor.id)).toMatchObject({ inclusion: "essential", userControlled: true });
    const searchable = memories.createManual("chief", "Keep this searchable.");
    memories.setInclusions(
      "chief",
      [{ memoryId: searchable.id, inclusion: "searchable", expectedRevision: 0 }],
      "user",
    );
    const before = memories.list("chief");
    expect(() => memories.updateManual("chief", searchable.id, survivor.text)).toThrow();
    expect(memories.list("chief")).toEqual(before);
    database.close();
  });

  it("rolls back failed turn writes and copies selection without retaining forgotten text", async () => {
    const { database, memories } = await setup();
    const memory = memories.createManual("chief", "Never retain this unique fact after forget.");
    memories.setInclusions("chief", [{ memoryId: memory.id, inclusion: "essential", expectedRevision: 0 }], "user");
    const [copy] = memories.duplicate("chief", "copy");
    expect(copy).toBeDefined();
    expect(memories.listSelections("copy")[0]).toMatchObject({ inclusion: "essential", userControlled: true });
    expect(() =>
      memories.withMemoryTransaction(() => {
        memories.createManual("chief", "A failed turn must not retain this.");
        throw new Error("turn failed");
      }),
    ).toThrow("turn failed");
    expect(memories.list("chief")).toEqual([memory]);
    memories.clear("chief");
    memories.clear("copy");
    expect(
      JSON.stringify(database.connection.prepare("SELECT result_json FROM orchestration_command_receipts").all()),
    ).not.toContain(memory.text);
    expect(
      JSON.stringify(database.connection.prepare("SELECT payload_json FROM orchestration_events").all()),
    ).not.toContain(memory.text);
    expect(memories.listSelections("chief")).toEqual([]);
    expect(memories.search("chief", "unique").memories).toEqual([]);
    database.close();
  });

  it("bounds recall and maintenance pages, and keeps the index current and private", async () => {
    const { database } = await setup();
    const memories = new AgentMemoryStore(database, () => 512);
    const copper = memories.createManual("chief", "Copper copper wiring.");
    memories.createManual("chief", "Ruby jewelry.");
    memories.createManual("research", "Copper other agent private memory.");
    expect(memories.search("chief", '"copper" OR (ruby)*').memories.map((memory) => memory.id)).toContain(copper.id);
    expect(memories.search("chief", "copper ruby").memories).toHaveLength(2);
    expect(memories.search("chief", "private").memories).toEqual([]);
    expect(() => memories.search("chief", "***")).toThrow();
    const unicode = memories.createManual("chief", "Zażółć gęślą jaźń.");
    expect(memories.search("chief", "zażółć").memories[0]?.id).toBe(unicode.id);
    memories.updateManual("chief", copper.id, "Silver wiring.");
    expect(memories.search("chief", "copper").memories).toEqual([]);
    memories.delete("chief", copper.id);
    expect(memories.search("chief", "silver").memories).toEqual([]);
    for (let index = 0; index < 30; index += 1) memories.createManual("chief", `recall ${index} ${"界".repeat(490)}`);
    const search = memories.search("chief", "recall", 10);
    expect(Buffer.byteLength(JSON.stringify(search))).toBeLessThanOrEqual(8192);
    expect(search.memories.length).toBeGreaterThan(0);
    expect(search.hasMore).toBe(true);
    const seen: string[] = [];
    let after: string | null = null;
    do {
      const page = memories.listPage("chief", after);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(8192);
      seen.push(...page.memories.map((memory) => memory.id));
      after = page.nextCursor;
    } while (after);
    expect(seen).toEqual(
      memories
        .list("chief")
        .map((memory) => memory.id)
        .sort(),
    );
    memories.clear("chief");
    expect(memories.search("chief", "Ruby").memories).toEqual([]);
    database.close();
  });

  it("removes every memory and memory event when its agent is deleted", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-memory-delete-agent-"));
    roots.push(root);
    const agentStore = new AgentStore(join(root, "data"), join(root, "home"));
    await runCauseEffect(agentStore.initialize());
    const agent = await runCauseEffect(agentStore.getOrCreate("chief"));
    const memories = new AgentMemoryStore(agentStore.database);
    const created = memories.createManual(agent.id, "Remove this with the agent.");

    await runCauseEffect(agentStore.deleteAgent(agent.id));

    expect(memories.list(agent.id)).toEqual([]);
    expect(
      agentStore.database.connection
        .prepare("SELECT COUNT(*) AS count FROM orchestration_events WHERE aggregate_id = ?")
        .get(created.id),
    ).toMatchObject({ count: 0 });
    agentStore.database.close();
  });
});

async function setup(): Promise<{ database: OpenBotDatabase; memories: AgentMemoryStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-memory-store-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  return { database, memories: new AgentMemoryStore(database) };
}
