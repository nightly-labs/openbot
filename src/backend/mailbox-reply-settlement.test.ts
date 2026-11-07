// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "./effect-boundary";
import { MailboxStore } from "./mailbox-store";
import { OpenBotDatabase } from "./openbot-database";

const roots: string[] = [];
const databases: OpenBotDatabase[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openbot-replied-delivery-"));
  roots.push(root);
  const userData = join(root, "data");
  const shared = join(root, "shared");
  const database = new OpenBotDatabase(userData);
  databases.push(database);
  const mailbox = new MailboxStore(userData, shared, database);
  await runCauseEffect(mailbox.initialize());
  const request = await runCauseEffect(
    mailbox.enqueue({
      sender: { kind: "agent", agentId: "requester" },
      recipientAgentIds: ["worker"],
      text: "Do the task",
    }),
  );
  const deliveryId = request.deliveries[0]?.id;
  if (!deliveryId) throw new Error("Missing fixture delivery");
  await runCauseEffect(mailbox.markStarting(deliveryId));
  await runCauseEffect(mailbox.markRunning(deliveryId, "worker-turn"));
  const reply = (sender = "worker", recipients = ["requester"], expectsReply = false) =>
    runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: sender },
        recipientAgentIds: recipients,
        text: expectsReply ? "A question" : "The task is done",
        replyToMessageId: request.messageId,
        expectsReply,
      }),
    );
  return { mailbox, database, userData, shared, request, deliveryId, reply };
}

describe("committed agent answers", () => {
  it.each(["failed", "interrupted"] as const)(
    "keeps an answered request completed when its turn ends %s",
    async (status) => {
      const { mailbox, deliveryId, reply } = await fixture();
      const answer = await reply();
      await runCauseEffect(mailbox.markTerminal(deliveryId, status, "Selected model is at capacity"));
      expect(mailbox.getDelivery(deliveryId)?.delivery).toMatchObject({ status: "completed", error: null });
      expect(answer.deliveries).toHaveLength(1);
      expect(mailbox.getDelivery(answer.deliveries[0]?.id ?? "")?.delivery.status).toBe("queued");
    },
  );

  it("does not conceal an unanswered request failure", async () => {
    const { mailbox, deliveryId } = await fixture();
    await runCauseEffect(mailbox.markTerminal(deliveryId, "failed", "Selected model is at capacity"));
    expect(mailbox.getDelivery(deliveryId)?.delivery).toMatchObject({
      status: "failed",
      error: "Selected model is at capacity",
    });
  });

  it("keeps a product-generated failure note distinct from a teammate's answer", async () => {
    const { mailbox, database, deliveryId, userData, shared } = await fixture();
    await runCauseEffect(mailbox.markTerminal(deliveryId, "failed", "capacity"));
    expect(await runCauseEffect(mailbox.answerFailedRequest(deliveryId, () => false))).toBe("requester");
    expect(mailbox.getDelivery(deliveryId)?.delivery).toMatchObject({ status: "failed", error: "capacity" });
    const reopened = new MailboxStore(userData, shared, database);
    await runCauseEffect(reopened.initialize());
    expect(reopened.getDelivery(deliveryId)?.delivery).toMatchObject({ status: "failed", error: "capacity" });
  });

  it.each([
    ["worker", ["requester"], true],
    ["other-worker", ["requester"], false],
    ["worker", ["other-recipient"], false],
  ] as const)(
    "does not settle from a question, another worker, or an answer sent elsewhere (%s, %j, %s)",
    async (sender, recipients, question) => {
      const { mailbox, deliveryId, reply } = await fixture();
      await reply(sender, [...recipients], question);
      await runCauseEffect(mailbox.markTerminal(deliveryId, "failed", "still unfinished"));
      expect(mailbox.getDelivery(deliveryId)?.delivery.status).toBe("failed");
    },
  );

  it("settles a failed request only after a late answer commits", async () => {
    const { mailbox, deliveryId, reply } = await fixture();
    await runCauseEffect(mailbox.markTerminal(deliveryId, "failed", "capacity"));
    await reply();
    expect(mailbox.getDelivery(deliveryId)?.delivery).toMatchObject({ status: "completed", error: null });
  });

  it("keeps the failed request and no answer when the reply commit fails", async () => {
    const { mailbox, database, deliveryId, request, reply } = await fixture();
    await runCauseEffect(mailbox.markTerminal(deliveryId, "failed", "capacity"));
    vi.spyOn(database, "applyMailboxChanges").mockImplementationOnce(() => {
      throw new Error("fixture commit refused");
    });
    await expect(reply()).rejects.toThrow("fixture commit refused");
    expect(mailbox.getDelivery(deliveryId)?.delivery).toMatchObject({ status: "failed", error: "capacity" });
    expect(mailbox.hasReplyFrom("worker", request.messageId)).toBe(false);
  });

  it("repairs only the false terminal status on reload, retaining the original request and answer", async () => {
    const { mailbox, database, deliveryId, reply, userData, shared } = await fixture();
    await reply();
    await runCauseEffect(mailbox.markTerminal(deliveryId, "completed"));
    // Seed the released projection defect only in this disposable database.
    database.connection
      .prepare(`UPDATE projection_deliveries
      SET status='failed', error='old capacity error',
      delivery_json=json_set(delivery_json,'$.status','failed','$.error','old capacity error')
      WHERE delivery_id=?`)
      .run(deliveryId);
    const saved = database.readMailboxState();
    if (!isDynamicRecord(saved) || !Array.isArray(saved.deliveries)) throw new Error("Missing saved fixture state");
    const reopenedDatabase = new OpenBotDatabase(userData);
    databases.push(reopenedDatabase);
    const reopened = new MailboxStore(userData, shared, reopenedDatabase);
    await runCauseEffect(reopened.initialize());
    expect(reopened.getDelivery(deliveryId)?.delivery).toMatchObject({ status: "completed", error: null });
    const after = reopenedDatabase.readMailboxState();
    if (!isDynamicRecord(after) || !Array.isArray(after.deliveries)) throw new Error("Missing recovered fixture state");
    expect(after.messages).toEqual(saved.messages);
    const identities = (rows: unknown[]) =>
      rows.map((row) => {
        if (!isDynamicRecord(row)) throw new Error("Invalid fixture delivery");
        const { status: _status, error: _error, ...rest } = row;
        return rest;
      });
    expect(identities(after.deliveries)).toEqual(identities(saved.deliveries));
  });

  it("preserves an explicit cancellation even when a final answer arrives later", async () => {
    const { mailbox } = await fixture();
    const request = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "requester" },
        recipientAgentIds: ["worker"],
        text: "Cancelled task",
      }),
    );
    const id = request.deliveries[0]?.id;
    if (!id) throw new Error("Missing cancelled fixture delivery");
    await runCauseEffect(mailbox.cancel("worker", id));
    await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: "worker" },
        recipientAgentIds: ["requester"],
        text: "Late answer",
        replyToMessageId: request.messageId,
        expectsReply: false,
      }),
    );
    expect(mailbox.getDelivery(id)?.delivery.status).toBe("cancelled");
  });
});
