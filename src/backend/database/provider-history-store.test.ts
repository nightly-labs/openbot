// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProviderHistoryStore", () => {
  it("keeps paged items and import progress after retrying a completed fragment", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-provider-history-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.connection
      .prepare(
        `INSERT INTO projection_threads
           (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
         VALUES (?, ?, ?, NULL, ?, ?, 0)`,
      )
      .run("thread-1", "agent-1", "Agent", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");

    database.ensureProviderHistoryImport({
      sessionId: "session-1",
      threadId: "thread-1",
      provider: "acp",
      externalSessionId: "external-1",
    });
    database.stageProviderHistoryFragment({
      sessionId: "session-1",
      cursor: { page: 1 },
      fragment: {
        turnId: "turn-1",
        itemOffset: 0,
        items: [{ type: "userMessage", id: "item-1", content: [{ type: "text", text: "one" }] }],
        complete: false,
      },
    });
    database.stageProviderHistoryFragment({
      sessionId: "session-1",
      cursor: { page: 2 },
      fragment: {
        turnId: "turn-1",
        itemOffset: 1,
        items: [{ type: "agentMessage", id: "item-2", text: "two" }],
        complete: true,
        status: "completed",
      },
    });

    expect(database.stagedProviderHistoryItems({ sessionId: "session-1", turnId: "turn-1" })).toHaveLength(2);
    expect(database.stagedProviderHistoryTurns("session-1")).toMatchObject([
      { turnId: "turn-1", complete: true, imported: false },
    ]);
    expect(database.providerHistoryImport("session-1")).toMatchObject({ cursor: { page: 2 }, state: "active" });

    database.markProviderHistoryTurnImported("session-1", "turn-1");
    database.markProviderHistoryImportState("session-1", "complete");
    database.stageProviderHistoryFragment({
      sessionId: "session-1",
      cursor: { page: 2 },
      fragment: {
        turnId: "turn-1",
        itemOffset: 1,
        items: [{ type: "agentMessage", id: "item-2", text: "two" }],
        complete: true,
        status: "completed",
      },
    });
    expect(database.providerHistoryImport("session-1")).toMatchObject({ state: "complete" });
    expect(database.stagedProviderHistoryTurns("session-1")).toMatchObject([
      { turnId: "turn-1", complete: true, imported: true },
    ]);
    database.stageProviderHistoryFragment({
      sessionId: "session-1",
      cursor: { page: 3 },
      fragment: {
        turnId: "turn-1",
        itemOffset: 1,
        items: [{ type: "agentMessage", id: "item-2", text: "changed" }],
        complete: true,
        status: "completed",
      },
    });
    expect(database.providerHistoryImport("session-1")).toMatchObject({ state: "active" });
    expect(database.stagedProviderHistoryTurns("session-1")).toMatchObject([
      { turnId: "turn-1", complete: true, imported: false },
    ]);
    expect(database.stagedProviderHistoryItems({ sessionId: "session-1", turnId: "turn-1" })).toHaveLength(2);

    database.stageProviderHistoryFragment({
      sessionId: "session-1",
      fragment: {
        turnId: "turn-tool",
        items: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "read_file",
            toolKind: "read",
            status: "completed",
            arguments: { path: "README.md" },
            result: { text: "OpenBot" },
          },
        ],
        complete: true,
      },
    });
    expect(database.stagedProviderHistoryItems({ sessionId: "session-1", turnId: "turn-tool" })[0]?.item).toEqual(
      expect.objectContaining({
        name: "read_file",
        toolKind: "read",
        arguments: { path: "README.md" },
        result: { text: "OpenBot" },
      }),
    );
    database.close();
  });

  it("reads more than one bounded turn page in stable newest-first order", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-provider-history-pages-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    database.connection
      .prepare(
        `INSERT INTO projection_threads
           (thread_id, agent_id, title, active_turn_id, created_at, updated_at, last_event_sequence)
         VALUES (?, ?, ?, NULL, ?, ?, 0)`,
      )
      .run("thread-pages", "agent-1", "Agent", "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");
    database.ensureProviderHistoryImport({
      sessionId: "session-pages",
      threadId: "thread-pages",
      provider: "acp",
      externalSessionId: "external-pages",
    });
    const total = 505;
    for (let index = 0; index < total; index += 1) {
      database.stageProviderHistoryFragment({
        sessionId: "session-pages",
        fragment: {
          turnId: `turn-${String(index).padStart(4, "0")}`,
          startedAt: index,
          items: [],
          complete: true,
        },
      });
    }

    const ids: string[] = [];
    let after: { startedAt: number | null; turnId: string } | undefined;
    for (;;) {
      const page = database.stagedProviderHistoryTurnPage("session-pages", { after, limit: 50 });
      ids.push(...page.turns.map((turn) => turn.turnId));
      if (!page.nextCursor) break;
      after = page.nextCursor;
    }
    expect(ids).toHaveLength(total);
    expect(ids[0]).toBe("turn-0504");
    expect(ids.at(-1)).toBe("turn-0000");
    database.close();
  });
});
