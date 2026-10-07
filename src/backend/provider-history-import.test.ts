// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ThreadItem } from "./protocol";
import { providerFailure } from "./provider-client-effects";
import type { ProviderHistoryFragment, ReadProviderHistory } from "./provider-history";
import { importProviderHistory, type ProviderHistoryImportDatabase } from "./provider-history-import";

class MemoryHistoryDatabase implements ProviderHistoryImportDatabase {
  readonly connection = new DatabaseSync(":memory:");
  readonly fragments: ProviderHistoryFragment[] = [];
  readonly importedPages: Array<{ messages: number; complete: boolean }> = [];
  readonly staged = new Map<string, { itemIndex: number; item: ThreadItem }>();
  state: "pending" | "active" | "complete" | "failed" = "pending";
  imported = new Map<string, ConversationMessage>();

  constructor() {
    this.connection.exec(`
      CREATE TABLE projection_thread_messages (
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        turn_id TEXT,
        message_json TEXT NOT NULL
      )
    `);
    this.connection
      .prepare(
        "INSERT INTO projection_thread_messages(thread_id, message_id, turn_id, message_json) VALUES (?, ?, ?, ?)",
      )
      .run(
        "openbot-thread",
        "turn-1:assistant",
        "turn-1",
        JSON.stringify({
          id: "turn-1:assistant",
          turnId: "turn-1",
          author: "assistant",
          text: "part-0",
          createdAt: "2026-09-01T12:00:00.000Z",
          status: "completed",
          attachments: [
            {
              id: "kept",
              name: "notes.txt",
              size: 5,
              kind: "file",
              mimeType: "text/plain",
              previewKind: "text",
              previewUrl: null,
            },
          ],
        }),
      );
  }

  ensureProviderHistoryImport() {
    return { state: this.state };
  }

  stageProviderHistoryFragment(input: { fragment: ProviderHistoryFragment }): void {
    this.fragments.push(input.fragment);
    for (const [itemIndex, item] of input.fragment.items.entries())
      this.staged.set(item.id ?? `${item.type}:${itemIndex}`, { itemIndex, item });
  }

  stagedProviderHistoryItems(input: {
    afterIndex?: number;
    limit?: number;
  }): Array<{ itemIndex: number; item: ThreadItem }> {
    const after = input.afterIndex ?? -1;
    return [...this.staged.values()]
      .sort((a, b) => a.itemIndex - b.itemIndex)
      .filter(({ itemIndex }) => itemIndex > after)
      .slice(0, input.limit ?? 50);
  }

  markProviderHistoryImportState(_sessionId: string, state: typeof this.state): void {
    this.state = state;
  }

  importProviderHistoryMessages(input: { messages: readonly ConversationMessage[]; complete: boolean }): void {
    this.importedPages.push({ messages: input.messages.length, complete: input.complete });
    for (const message of input.messages) this.imported.set(message.id, message);
  }

  storeMessage(message: ConversationMessage): void {
    this.connection
      .prepare(
        "INSERT INTO projection_thread_messages(thread_id, message_id, turn_id, message_json) VALUES (?, ?, ?, ?)",
      )
      .run("openbot-thread", message.id, message.turnId ?? null, JSON.stringify(message));
  }

  close(): void {
    this.connection.close();
  }
}

describe("bounded provider history import", () => {
  it("reads a 51-item turn in bounded pages and checks Claude candidate IDs", async () => {
    const database = new MemoryHistoryDatabase();
    const items = Array.from({ length: 51 }, (_, index) => ({
      id: `part-${index}`,
      type: "agentMessage",
      text: `part-${index}`,
    }));
    const readHistory: ReadProviderHistory = (_request, consume) =>
      Effect.as(consume({ turnId: "turn-1", status: "completed", items, complete: true }), undefined);

    await Effect.runPromise(
      importProviderHistory({
        database,
        readHistory,
        sessionId: "session-1",
        provider: "claude",
        externalSessionId: "external-1",
        agentId: "chief",
        publicThreadId: "openbot-thread",
        findDelivery: () => null,
        findMessageDelivery: () => null,
      }),
    );

    expect(database.importedPages).toEqual([
      expect.objectContaining({ complete: false }),
      expect.objectContaining({ complete: true }),
    ]);
    expect(database.fragments[0]?.items).toHaveLength(51);
    expect(database.imported.get("turn-1:assistant")).toEqual(
      expect.objectContaining({ id: "turn-1:assistant", attachments: expect.any(Array) }),
    );
    database.close();
  });

  it("keeps live Claude narration from duplicating across bounded pages", async () => {
    const database = new MemoryHistoryDatabase();
    database.connection.prepare("UPDATE projection_thread_messages SET message_json = ? WHERE message_id = ?").run(
      JSON.stringify({
        id: "turn-1:assistant",
        turnId: "turn-1",
        author: "assistant",
        text: "Done.",
        itemType: "agentMessage",
        createdAt: "2026-09-01T12:00:00.000Z",
        status: "completed",
      }),
      "turn-1:assistant",
    );
    database.storeMessage({
      id: "turn-1:narration:0",
      turnId: "turn-1",
      author: "assistant",
      text: "Plan.",
      createdAt: "2026-09-01T12:00:00.000Z",
      status: "completed",
      itemType: "commentary",
    });
    const items = [
      { id: "provider-narration", type: "agentMessage", phase: "commentary", text: "Plan." },
      ...Array.from({ length: 49 }, (_, index) => ({
        id: `provider-note-${index}`,
        type: "agentMessage",
        phase: "commentary",
        text: `note-${index}`,
      })),
      { id: "provider-answer", type: "agentMessage", text: "Done." },
    ];
    const readHistory: ReadProviderHistory = (_request, consume) =>
      Effect.as(consume({ turnId: "turn-1", status: "completed", items, complete: true }), undefined);

    await Effect.runPromise(
      importProviderHistory({
        database,
        readHistory,
        sessionId: "session-narration",
        provider: "claude",
        externalSessionId: "external-1",
        agentId: "chief",
        publicThreadId: "openbot-thread",
        findDelivery: () => null,
        findMessageDelivery: () => null,
      }),
    );

    expect(database.imported.has("provider-narration")).toBe(false);
    expect(database.imported.has("turn-1:assistant")).toBe(true);
    expect(database.imported.has("provider-answer")).toBe(false);
    database.close();
  });

  it("keeps staged items retryable after an interrupted read", async () => {
    const database = new MemoryHistoryDatabase();
    let attempt = 0;
    const readHistory: ReadProviderHistory = (_request, consume) =>
      Effect.gen(function* () {
        attempt += 1;
        if (attempt === 1) {
          yield* consume({
            turnId: "turn-1",
            items: [{ id: "part-0", type: "agentMessage", text: "part-0" }],
            complete: false,
          });
          return yield* Effect.fail(providerFailure(new Error("interrupted")));
        }
        yield* consume({
          turnId: "turn-1",
          items: [{ id: "part-0", type: "agentMessage", text: "part-0" }],
          complete: true,
        });
      });

    await expect(
      Effect.runPromise(
        importProviderHistory({
          database,
          readHistory,
          sessionId: "session-1",
          provider: "codex",
          externalSessionId: "external-1",
          agentId: "chief",
          publicThreadId: "openbot-thread",
          findDelivery: () => null,
          findMessageDelivery: () => null,
        }),
      ),
    ).rejects.toBeDefined();
    expect(database.state).toBe("failed");

    await Effect.runPromise(
      importProviderHistory({
        database,
        readHistory,
        sessionId: "session-1",
        provider: "codex",
        externalSessionId: "external-1",
        agentId: "chief",
        publicThreadId: "openbot-thread",
        findDelivery: () => null,
        findMessageDelivery: () => null,
      }),
    );
    expect(database.state).toBe("complete");
    expect(database.importedPages.at(-1)).toEqual({ messages: 1, complete: true });
    database.close();
  });

  it("keeps ACP replay records on disk without normalizing them twice", async () => {
    const database = new MemoryHistoryDatabase();
    const readHistory: ReadProviderHistory = (_request, consume) =>
      database.state === "complete"
        ? Effect.void
        : Effect.as(
            consume({
              turnId: "provider-session:history:1",
              recordsOnly: true,
              items: [
                { id: "provider-user", type: "userMessage", content: [{ type: "text", text: "hello" }] },
                { id: "provider-answer", type: "agentMessage", text: "answer" },
                { id: "provider-tool", type: "toolCall", name: "read_file", status: "completed" },
              ],
              complete: true,
            }),
            undefined,
          );

    const input = {
      database,
      readHistory,
      sessionId: "session-acp",
      provider: "acp" as const,
      externalSessionId: "provider-session",
      agentId: "chief",
      publicThreadId: "openbot-thread",
      findDelivery: () => null,
      findMessageDelivery: () => null,
    };
    await Effect.runPromise(importProviderHistory(input));
    expect(database.state).toBe("complete");
    expect(database.fragments.at(-1)?.items).toHaveLength(3);
    expect(database.importedPages).toEqual([expect.objectContaining({ messages: 0, complete: true })]);

    await Effect.runPromise(importProviderHistory(input));
    expect(database.fragments).toHaveLength(1);
    expect(database.imported.size).toBe(0);
    database.close();
  });

  it("refreshes a completed Codex import on the next scan", async () => {
    const database = new MemoryHistoryDatabase();
    let scan = 0;
    const readHistory: ReadProviderHistory = (_request, consume) => {
      scan += 1;
      return Effect.as(
        consume({
          turnId: `codex-turn-${scan}`,
          items: [{ id: `answer-${scan}`, type: "agentMessage", text: `answer-${scan}` }],
          complete: true,
        }),
        undefined,
      );
    };
    const input = {
      database,
      readHistory,
      sessionId: "session-codex",
      provider: "codex" as const,
      externalSessionId: "codex-session",
      agentId: "chief",
      publicThreadId: "openbot-thread",
      findDelivery: () => null,
      findMessageDelivery: () => null,
    };

    await Effect.runPromise(importProviderHistory(input));
    await Effect.runPromise(importProviderHistory(input));
    expect(database.fragments.map((fragment) => fragment.turnId)).toEqual(["codex-turn-1", "codex-turn-2"]);
    expect(database.state).toBe("complete");
    database.close();
  });
});
