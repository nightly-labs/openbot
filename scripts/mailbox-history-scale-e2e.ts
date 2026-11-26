import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { MailboxProjectionState } from "../src/backend/database/mailbox-projection";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mailbox-history-scale-e2e");
const SIZES = (process.env.HISTORY_SIZES ?? "10000,70000").split(",").map(Number);
const AGENTS = 85;
const CYCLES = Number(process.env.HISTORY_CYCLES ?? 120);
const BASE = Date.parse("2026-10-01T00:00:00.000Z");
const OPEN_EVERY = 40;
const OPEN_SEED = 4_000;

type SeedDelivery = MailboxProjectionState["deliveries"][number] & { queueOrder: number };

const time = (offset: number) => new Date(BASE + offset * 1_000).toISOString();
const agentIds = Array.from({ length: AGENTS }, (_, index) => `agent-${index}`);
const user = { kind: "user" } as const;

type SeedMessage = MailboxProjectionState["messages"][number] & {
  recipient: string;
  senderTaskId?: string;
  expectsReply?: false;
};

function seedMessage(index: number, size: number): SeedMessage {
  const recipient = agentIds[index % AGENTS] ?? "";
  const senderAgent = agentIds[(index * 7 + 3) % AGENTS] ?? "";
  const id = `message-${index}`;
  const base = { id, text: `Message ${index}`, createdAt: time(index), attachments: [] };
  if (index % 50 === 7 && senderAgent !== recipient)
    return {
      ...base,
      recipient,
      sender: { kind: "agent", agentId: senderAgent },
      senderTaskId: `task-${senderAgent}-${index % 5}`,
      replyToMessageId: null,
    };
  const request = index % 50 === 8 ? seedMessage(index - 1, size) : undefined;
  const requester = request?.sender.agentId;
  if (request && requester && index < size - 1_000)
    return {
      ...base,
      recipient: requester,
      sender: { kind: "agent", agentId: request.recipient },
      replyToMessageId: request.id,
      expectsReply: false,
    };
  const fromAgent = index % 10 >= 6 && senderAgent !== recipient;
  const open = index >= size - OPEN_SEED ? index % OPEN_EVERY : -1;
  return {
    ...base,
    recipient,
    sender: fromAgent ? { kind: "agent", agentId: senderAgent } : { kind: "user" },
    replyToMessageId: fromAgent && index > AGENTS ? `message-${index - AGENTS}` : null,
    ...(open === 3 ? { taskId: `task-${index}` } : {}),
  };
}

function seedState(size: number): MailboxProjectionState {
  const messages: MailboxProjectionState["messages"] = [];
  const deliveries: SeedDelivery[] = [];
  const idempotency: Record<string, string> = {};
  for (let index = 0; index < size; index++) {
    const { recipient, ...message } = seedMessage(index, size);
    const open = index >= size - OPEN_SEED ? index % OPEN_EVERY : -1;
    messages.push(message);
    deliveries.push({
      id: `delivery-${index}`,
      messageId: message.id,
      recipientAgentId: recipient,
      status: open === 0 || open === 3 ? "queued" : open === 1 ? "running" : open === 2 ? "failed" : "completed",
      turnId: open === 0 || open === 3 ? null : `turn-${index}`,
      error: null,
      createdAt: time(index),
      queueOrder: index,
    });
    if (message.sender.kind === "agent") idempotency[`reply:${message.sender.agentId}:turn-${index}:0`] = message.id;
  }
  return { messages, deliveries, drafts: [], generatedAttachments: [], pausedAgentIds: [], idempotency, reactions: [] };
}

function median(samples: readonly number[]): number {
  const sorted = samples.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const RUN_TIME = /20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g;

class OutputDigest {
  readonly #hash = createHash("sha256");
  readonly #aliases = new Map<string, string>();
  readonly #seedTimes: ReadonlySet<string>;

  constructor(seedTimes: ReadonlySet<string>) {
    this.#seedTimes = seedTimes;
  }

  add(name: string, value: unknown): void {
    this.#write(name, this.#normalize(value));
  }

  addUnordered(name: string, value: unknown): void {
    if (typeof value !== "object" || value === null) {
      this.add(name, value);
      return;
    }
    for (const [key, field] of Object.entries(value))
      this.#write(
        `${name}.${key}`,
        Array.isArray(field)
          ? field
              .map((row) => this.#normalize(row))
              .sort()
              .join("\n")
          : this.#normalize(field),
      );
  }

  #normalize(value: unknown): string {
    return JSON.stringify(value ?? null)
      .replace(UUID, (id) => {
        const alias = this.#aliases.get(id) ?? `id-${this.#aliases.size}`;
        this.#aliases.set(id, alias);
        return alias;
      })
      .replace(RUN_TIME, (stamp) => (this.#seedTimes.has(stamp) ? stamp : "run-time"));
  }

  #write(name: string, text: string): void {
    this.#hash.update(`${name}\n${text}\n`);
    if (process.env.HISTORY_DUMP) appendFileSync(process.env.HISTORY_DUMP, `${name}\n${text}\n`);
  }

  value(): string {
    return this.#hash.digest("hex");
  }
}

async function timed<T>(
  samples: Map<string, number[]>,
  digest: OutputDigest,
  name: string,
  work: () => T | Promise<T>,
): Promise<T> {
  const started = performance.now();
  const result = await work();
  const list = samples.get(name) ?? [];
  list.push(performance.now() - started);
  samples.set(name, list);
  digest.add(name, result);
  return result;
}

type SizeResult = { medianMs: Record<string, number>; digest: string; sameAsNewStore: boolean };

function storeReads(mailbox: MailboxStore, failedTurns: ReadonlyMap<string, string>, fromCreatedAt: string) {
  return {
    queues: agentIds.map((agentId) => mailbox.listQueue(agentId)),
    queuedIds: agentIds.map((agentId) => mailbox.queuedDeliveryIds(agentId)),
    conversations: agentIds.map((agentId) => mailbox.conversationMessages(agentId, { fromCreatedAt })),
    activeQueues: mailbox.listActiveQueues(agentIds, failedTurns),
    runtimeWork: mailbox.listRuntimeWork(agentIds, failedTurns),
    unresolved: mailbox.unresolvedDeliveries(),
    unfinishedTasks: mailbox.unfinishedTaskDeliveries(),
    awaited: mailbox.awaitedThreadRequests(),
    positions: [...mailbox.queuedPositions()].sort(([left], [right]) => left.localeCompare(right)),
  };
}

async function runSize(size: number): Promise<SizeResult> {
  const root = await mkdtemp(join(tmpdir(), "openbot-history-scale-"));
  const database = new OpenBotDatabase(join(root, "state"));
  try {
    await runCauseEffect(database.initialize());
    database.replaceMailboxState("seed", seedState(size), "mailbox.seeded");
    const mailbox = new MailboxStore(join(root, "state"), join(root, "shared"), database);
    const startedAt = performance.now();
    await runCauseEffect(mailbox.initialize());
    const samples = new Map<string, number[]>([["initialize", [performance.now() - startedAt]]]);
    const failedTurns = new Map<string, string>();
    const digest = new OutputDigest(new Set(Array.from({ length: size }, (_, index) => time(index))));
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const agentId = agentIds[cycle % AGENTS] ?? "";
      const sender = agentIds[(cycle + 1) % AGENTS] ?? "";
      const receipt = await timed(samples, digest, "enqueue", () =>
        runCauseEffect(
          mailbox.enqueue({
            sender: { kind: "agent", agentId: sender },
            recipientAgentIds: [agentId],
            text: `Cycle ${cycle}`,
            senderTaskId: `task-cycle-${cycle % 5}`,
            expectsReply: true,
          }),
        ),
      );
      const deliveryId = receipt.deliveries[0]?.id ?? "";
      await timed(samples, digest, "listQueue", () => mailbox.listQueue(agentId));
      await timed(samples, digest, "nextQueued", () => mailbox.nextQueued(agentId));
      await timed(samples, digest, "markStarting", () => runCauseEffect(mailbox.markStarting(deliveryId)));
      await timed(samples, digest, "markRunning", () =>
        runCauseEffect(mailbox.markRunning(deliveryId, `turn-cycle-${cycle}`)),
      );
      await timed(samples, digest, "awaitedThreadRequests", () => mailbox.awaitedThreadRequests());
      await timed(samples, digest, "listActiveQueues", () => mailbox.listActiveQueues(agentIds, failedTurns));
      await timed(samples, digest, "unresolvedDeliveries", () => mailbox.unresolvedDeliveries());
      await timed(samples, digest, "unfinishedTaskDeliveries", () => mailbox.unfinishedTaskDeliveries());
      await timed(samples, digest, "listRuntimeWork", () => mailbox.listRuntimeWork(agentIds, failedTurns));
      await timed(samples, digest, "conversationMessagesRecent", () =>
        mailbox.conversationMessages(agentId, { fromCreatedAt: time(size - 500) }),
      );
      await timed(samples, digest, "setReaction", () =>
        runCauseEffect(mailbox.setReaction(agentId, receipt.messageId, user, "👍")),
      );
      await timed(samples, digest, "reply", () =>
        runCauseEffect(
          mailbox.enqueue({
            sender: { kind: "agent", agentId },
            recipientAgentIds: [sender],
            text: `Answer ${cycle}`,
            replyToMessageId: receipt.messageId,
            expectsReply: false,
          }),
        ),
      );
      await timed(samples, digest, "markTerminal", () => runCauseEffect(mailbox.markTerminal(deliveryId, "completed")));
      if (cycle % 3 === 0) {
        const retryTurnId = `turn-retry-${cycle}`;
        await timed(samples, digest, "requeueFinished", () =>
          runCauseEffect(mailbox.requeueRefused(deliveryId, undefined, true)),
        );
        await runCauseEffect(mailbox.markStarting(deliveryId));
        await runCauseEffect(mailbox.markRunning(deliveryId, retryTurnId));
        await timed(samples, digest, "markFailed", () =>
          runCauseEffect(mailbox.markTerminal(deliveryId, "failed", `Failure ${cycle}`)),
        );
        failedTurns.set(agentId, retryTurnId);
      } else if (cycle % 3 === 1) {
        const cancelled = await runCauseEffect(
          mailbox.enqueue({ sender: user, recipientAgentIds: [agentId], text: `Cancelled ${cycle}` }),
        );
        await timed(samples, digest, "cancel", () =>
          runCauseEffect(mailbox.cancel(agentId, cancelled.deliveries[0]?.id ?? "")),
        );
      }
      await timed(samples, digest, "conversationMessagesAfterChange", () =>
        mailbox.conversationMessages(agentId, { fromCreatedAt: time(size - 500) }),
      );
    }
    for (const agentId of agentIds) {
      digest.add("finalQueue", mailbox.listQueue(agentId));
      digest.add("finalConversation", mailbox.conversationMessages(agentId, { fromCreatedAt: time(size - 2_000) }));
    }
    digest.add("finalAwaited", mailbox.awaitedThreadRequests());
    digest.add("finalRuntimeWork", mailbox.listRuntimeWork(agentIds, failedTurns));
    digest.addUnordered("persisted", database.readMailboxState());
    const newStore = new MailboxStore(join(root, "state"), join(root, "shared"), database);
    await runCauseEffect(newStore.initialize());
    const fromCreatedAt = time(size - 2_000);
    return {
      medianMs: Object.fromEntries([...samples].map(([name, list]) => [name, median(list)])),
      digest: digest.value(),
      sameAsNewStore: isDeepStrictEqual(
        storeReads(mailbox, failedTurns, fromCreatedAt),
        storeReads(newStore, failedTurns, fromCreatedAt),
      ),
    };
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

const runs: Record<string, SizeResult> = {};
for (const size of SIZES) runs[size] = await runSize(size);
const results = Object.fromEntries(Object.entries(runs).map(([size, run]) => [size, run.medianMs]));
const digests = Object.fromEntries(Object.entries(runs).map(([size, run]) => [size, run.digest]));
const sameAsNewStore = Object.fromEntries(Object.entries(runs).map(([size, run]) => [size, run.sameAsNewStore]));
const passed = Object.values(sameAsNewStore).every(Boolean);
const [small, large] = SIZES;
const growth: Record<string, number> = {};
if (small !== undefined && large !== undefined)
  for (const [name, value] of Object.entries(results[large] ?? {}))
    growth[name] = Number((value / Math.max(results[small]?.[name] ?? 0, 0.001)).toFixed(2));
mkdirSync(OUT, { recursive: true });
const report = {
  sizes: SIZES,
  agents: AGENTS,
  cycles: CYCLES,
  passed,
  sameAsNewStore,
  digests,
  medianMs: results,
  growth,
};
writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!passed) process.exitCode = 1;
