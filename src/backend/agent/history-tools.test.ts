// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "../agent-service";
import {
  callOpenBotTool,
  openBotToolPayload,
  startAgentTestFixture,
  startService,
  stopAgentTestFixture,
  waitForQueue,
} from "../agent-service-test-harness";
import { runCauseEffect } from "../effect-boundary";
import { getArray, getString, isRecord } from "../protocol";
import { HistoryTools } from "./history-tools";

// Failure modes: cross-thread/reset reads expose private text; truncation loses a request ending;
// an old cursor bypasses reset; secret fragments leave through truncated results.
let root: string;
let service: AgentService | null = null;
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  await stopAgentTestFixture(root, service);
  service = null;
});

async function start() {
  const fixture = await startService(root, { output: "Completed synthetic work" });
  service = fixture.service;
  await runCauseEffect(service.sendMessage({ agentId: "chief", text: "Find my earlier decision" }));
  await waitForQueue(service, "chief", (queue) => queue.deliveries[0]?.status === "completed");
  const session = fixture.store.activeProviderSession("chief");
  if (!session) throw new Error("Missing test session");
  return { ...fixture, session };
}

describe.sequential("scoped history tools", () => {
  it("retrieves a large omitted message through deferred calls without leaking secrets", async () => {
    const { service, store, client, session } = await start();
    const secret = "synthetic-secret-1234567890";
    registerSecretValue(secret);
    const snapshot = await runCauseEffect(service.readConversation("chief"));
    const message = {
      id: "large-request",
      turnId: "large-turn",
      author: "user" as const,
      status: "completed" as const,
      text: `BEGIN ${"x".repeat(50000)} ${secret} FINAL-DECISION`,
      createdAt: "2099-01-01T00:00:00.000Z",
    };
    store.database.persistConversationChanges({
      agentId: "chief",
      threadId: session.threadId,
      activeTurnId: null,
      changedMessages: [message],
      eventType: "test.history",
    });
    let offset = 0;
    let recovered = "";
    for (let calls = 0; calls < 20; calls += 1) {
      const response = await callOpenBotTool(client, session.externalSessionId, "tool_call", {
        name: "openbot.history_read",
        arguments: { messageId: message.id, offset, includeWorkSteps: true },
      });
      expect(response.result).toMatchObject({ success: true });
      expect(JSON.stringify(response.result).length).toBeLessThanOrEqual(16000);
      const row = getArray(openBotToolPayload(response.result), "messages")[0];
      recovered += getString(row, "text") ?? "";
      const next = isRecord(row) ? row.nextOffset : null;
      if (next === null) break;
      if (typeof next !== "number" || next <= offset) throw new Error("History read did not advance");
      offset = next;
    }
    expect(recovered).toContain("FINAL-DECISION");
    expect(recovered).not.toContain(secret);
    expect(snapshot.messages.length).toBeGreaterThan(0);
  });

  it("keeps chat readable with a corrupt capture and pages large escaped work steps", async () => {
    const { store, client, session } = await start();
    const row = store.database.readAgentHistory("chief", session.threadId, { author: "assistant", limit: 1 })
      .messages[0];
    if (!row?.message.turnId || !row.providerSessionId) throw new Error("Missing turn association");
    const directory = join(store.database.userDataPath, "provider-work-steps", "v2");
    await mkdir(directory, { recursive: true });
    const path = join(directory, createHash("sha256").update(session.id).digest("hex"));
    await writeFile(path, "{incomplete", { mode: 0o600 });
    const missing = await callOpenBotTool(client, session.externalSessionId, "history_read", {
      messageId: row.message.id,
      includeWorkSteps: true,
    });
    expect(missing.result).toMatchObject({ success: true });
    expect(JSON.stringify(openBotToolPayload(missing.result))).toContain("Captured work steps are unavailable");
    const steps = `${"\u0000".repeat(3900)}END_OF_CAPTURE`;
    await writeFile(path, JSON.stringify({ [row.message.turnId]: steps }), { mode: 0o600 });
    let offset = 0;
    let recovered = "";
    for (let count = 0; count < 20; count += 1) {
      const response = await callOpenBotTool(client, session.externalSessionId, "history_read", {
        messageId: row.message.id,
        includeWorkSteps: true,
        workStepsOffset: offset,
      });
      expect(response.result).toMatchObject({ success: true });
      expect(JSON.stringify(response.result).length).toBeLessThanOrEqual(16000);
      const entry = getArray(openBotToolPayload(response.result), "messages")[0];
      recovered += getString(entry, "workSteps") ?? "";
      const next = isRecord(entry) ? entry.nextWorkStepsOffset : null;
      if (next === null) break;
      if (typeof next !== "number" || next <= offset) throw new Error("Work-step read did not advance");
      offset = next;
    }
    expect(recovered).toBe(steps);
    store.database.connection
      .prepare("DELETE FROM projection_thread_messages WHERE thread_id = ? AND message_id = ?")
      .run(session.threadId, row.message.id);
    expect(
      (await callOpenBotTool(client, session.externalSessionId, "history_read", { messageId: row.message.id })).result,
    ).toMatchObject({ success: false });
  });

  it("does not read another provider's capture with matching native session and turn ids", async () => {
    const { store, client, session } = await start();
    const row = store.database.readAgentHistory("chief", session.threadId, { author: "assistant", limit: 1 })
      .messages[0];
    if (!row?.message.turnId) throw new Error("Missing test turn");
    store.database.connection
      .prepare(
        "INSERT INTO projection_threads SELECT 'capture-other-thread', agent_id, title, NULL, created_at, updated_at, last_event_sequence FROM projection_threads WHERE thread_id = ?",
      )
      .run(session.threadId);
    const other = store.database.bindProviderSession({
      threadId: "capture-other-thread",
      provider: "claude",
      externalSessionId: session.externalSessionId,
      model: "claude-sonnet-5",
      effort: "medium",
    });
    const directory = join(store.database.userDataPath, "provider-work-steps");
    await mkdir(join(directory, "v2"), { recursive: true });
    const foreign = JSON.stringify({ [row.message.turnId]: "PRIVATE_CAPTURE_FROM_OTHER_CONVERSATION" });
    await writeFile(join(directory, createHash("sha256").update(session.externalSessionId).digest("hex")), foreign, {
      mode: 0o600,
    });
    await writeFile(join(directory, "v2", createHash("sha256").update(other.id).digest("hex")), foreign, {
      mode: 0o600,
    });
    const response = await callOpenBotTool(client, session.externalSessionId, "history_read", {
      messageId: row.message.id,
      includeWorkSteps: true,
    });
    expect(response.result).toMatchObject({ success: true });
    expect(JSON.stringify(openBotToolPayload(response.result))).toContain("Captured work steps are unavailable");
    expect(JSON.stringify(response.result)).not.toContain("PRIVATE_CAPTURE");
  });

  it("rejects a reset that occurs during a capture read", async () => {
    const { store, session } = await start();
    const row = store.database.readAgentHistory("chief", session.threadId, { author: "assistant", limit: 1 })
      .messages[0];
    if (!row?.providerSessionId) throw new Error("Missing turn association");
    const history = new HistoryTools({
      store,
      redact: (text) => text,
      capturedSteps: () =>
        Effect.sync(() => {
          store.database.persistConversationChanges({
            agentId: "chief",
            threadId: session.threadId,
            activeTurnId: null,
            changedMessages: [
              {
                id: "concurrent-reset",
                author: "system",
                source: "system",
                status: "completed",
                itemType: "context-reset",
                text: "Reset",
                createdAt: "2099-01-01T00:00:00.000Z",
              },
            ],
            eventType: "test.reset",
          });
          return new Map();
        }),
    });
    await expect(
      runCauseEffect(
        history.call("chief", session.threadId, "history_read", { messageId: row.message.id, includeWorkSteps: true }),
      ),
    ).rejects.toThrow();
  });

  it("rejects cross-thread references and stale cursors after a reset", async () => {
    const { service, store, client, session } = await start();
    const before = await callOpenBotTool(client, session.externalSessionId, "history_read", { limit: 1 });
    const cursor = getString(openBotToolPayload(before.result), "nextCursor");
    expect(cursor).toBeTruthy();
    const snapshot = await runCauseEffect(service.readConversation("chief"));
    const previousMessage = snapshot.messages[0];
    if (!previousMessage || !cursor) throw new Error("Missing prior history");
    store.database.connection
      .prepare(
        "INSERT INTO projection_threads SELECT 'other-execution-thread', agent_id, title, NULL, created_at, updated_at, last_event_sequence FROM projection_threads WHERE thread_id = ?",
      )
      .run(session.threadId);
    store.database.persistConversation(
      {
        ...snapshot,
        threadId: "other-execution-thread",
        messages: [{ ...previousMessage, id: "other-message", text: "PRIVATE OTHER THREAD" }],
      },
      "test.other",
    );
    const forged = await callOpenBotTool(client, session.externalSessionId, "history_read", {
      messageId: "other-message",
    });
    expect(forged.result).toMatchObject({ success: false });
    const forgedCursor = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(cursor, "base64url").toString()),
        threadId: "other-execution-thread",
      }),
    ).toString("base64url");
    expect(
      (await callOpenBotTool(client, session.externalSessionId, "history_read", { before: forgedCursor })).result,
    ).toMatchObject({ success: false });
    await runCauseEffect(service.clearAgentContext("chief"));
    await runCauseEffect(service.sendMessage({ agentId: "chief", text: "New context" }));
    await waitForQueue(service, "chief", (queue) => queue.deliveries[1]?.status === "completed");
    const next = store.activeProviderSession("chief");
    if (!next) throw new Error("Missing new session");
    expect(
      (await callOpenBotTool(client, next.externalSessionId, "history_read", { before: cursor })).result,
    ).toMatchObject({ success: false });
    expect(
      (await callOpenBotTool(client, next.externalSessionId, "history_read", { messageId: previousMessage.id })).result,
    ).toMatchObject({ success: false });
    expect(
      (
        await callOpenBotTool(client, next.externalSessionId, "history_read", {
          messageId: "other-message",
          before: cursor,
        })
      ).result,
    ).toMatchObject({ success: false });
    const search = await callOpenBotTool(client, next.externalSessionId, "history_search", {
      query: "earlier decision",
    });
    expect(getArray(openBotToolPayload(search.result), "messages")).toEqual([]);
    expect(
      (await runCauseEffect(service.readConversation("chief"))).messages.some(
        (message) => message.id === previousMessage.id,
      ),
    ).toBe(true);
  });
});
