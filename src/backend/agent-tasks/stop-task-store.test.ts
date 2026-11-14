// @vitest-environment node
// Real stores on a temporary profile: the guarantees `stop_task` relies on (ownership, an idempotent
// second stop, cancelling queued work, history kept). It does not fake a database.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { AgentThreadStore } from "../agent-threads/agent-thread-store";
import { runCauseEffect } from "../effect-boundary";
import { MailboxStore } from "../mailbox-store";
import { OpenBotDatabase } from "../openbot-database";
import { closeOwnTaskRecord, requireOwnTask } from "./agent-tasks";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function profile() {
  const root = await mkdtemp(join(tmpdir(), "openbot-stop-task-"));
  roots.push(root);
  const database = new OpenBotDatabase(root);
  await runCauseEffect(database.initialize());
  const store = new AgentThreadStore(database);
  const mailbox = new MailboxStore(root, root, database);
  return { store, mailbox };
}

describe("stop_task on real stores", () => {
  it("refuses another agent's task and leaves it untouched", async () => {
    const { store } = await profile();
    const mine = store.create({ agentId: "agent-a", origin: "agent", title: "a", titleSource: "agent" });
    const theirs = store.create({ agentId: "agent-b", origin: "agent", title: "b", titleSource: "agent" });

    expect(() => requireOwnTask(store, "agent-a", theirs.taskId)).toThrow();
    // The refused lookup changes nothing on either task.
    expect(store.task(theirs.taskId)?.closedAt).toBeNull();
    expect(store.task(mine.taskId)?.closedAt).toBeNull();
  });

  it("closes an own task once and keeps its history when stopped again", async () => {
    const { store } = await profile();
    const task = store.create({ agentId: "agent-a", origin: "agent", title: "nightly", titleSource: "agent" });

    expect(closeOwnTaskRecord(store, "agent-a", task.taskId)).toBe("closed");
    expect(store.task(task.taskId)?.closedAt).not.toBeNull();

    // A second stop is a no-op: no throw, still one record with its original thread.
    expect(closeOwnTaskRecord(store, "agent-a", task.taskId)).toBe("already-closed");
    const rows = store.list("agent-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.threadId).toBe(task.threadId);
    expect(rows[0]?.title).toBe("nightly");
  });

  it("cancels the queued work of the stopped task so nothing starts", async () => {
    const { mailbox } = await profile();
    const receipt = await Effect.runPromise(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "agent-b" },
        recipientAgentIds: ["agent-a"],
        text: "follow up",
        taskId: "task-1",
      }),
    );
    const deliveryId = receipt.deliveries[0]?.id ?? "";
    expect(deliveryId).not.toBe("");
    expect(mailbox.taskQueue("agent-a", "task-1")).toHaveLength(1);

    mailbox.cancelNow("agent-a", deliveryId);
    // Nothing of this task waits any more, and a second cancel proves it is no longer queued.
    expect(mailbox.taskQueue("agent-a", "task-1")).toHaveLength(0);
    expect(() => mailbox.cancelNow("agent-a", deliveryId)).toThrow();
  });

  it("keeps the task readable after it closed", async () => {
    const { store } = await profile();
    const task = store.create({ agentId: "agent-a", origin: "agent", title: "kept", titleSource: "agent" });
    closeOwnTaskRecord(store, "agent-a", task.taskId);

    expect(store.list("agent-a").map((row) => row.taskId)).toContain(task.taskId);
    expect(store.task(task.taskId)?.closedAt).not.toBeNull();
  });
});
