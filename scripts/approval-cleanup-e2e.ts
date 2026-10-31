// Runs the approval cleanup of the real `AttentionRegistry` end to end: an approval that the user
// never answers, a turn that ends, and the reply that the provider's app-server receives. No provider
// process and no account are used: the client records the reply it would get.
// `bun scripts/approval-cleanup-e2e.ts`. Writes .openbot-build/approval-cleanup-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentEvent, ConversationSnapshot } from "@openbot/contracts/ipc";
import { Effect, Fiber } from "effect";
import { AttentionRegistry } from "../src/backend/agent/attention-registry";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import type { AppServerRequest, RequestId } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/approval-cleanup-e2e");
const THREAD = "thread-1";
const TURN = "turn-1";

/** Records what OpenBot sends back to the provider. The process never starts. */
class RecordingClient extends CodexAppServerClient {
  readonly replies: Array<{ id: RequestId; result: unknown }> = [];

  override get running(): boolean {
    return true;
  }

  override respond(id: RequestId, result: unknown): void {
    this.replies.push({ id, result });
  }
}

const client = new RecordingClient("/nonexistent/codex");
const snapshot: ConversationSnapshot = {
  agentId: "agent-1",
  threadId: THREAD,
  activeTurnId: null,
  revision: 0,
  messages: [],
};
const events: AgentEvent[] = [];
const errors: string[] = [];
const registry = new AttentionRegistry({
  conversation: {
    agentForThread: (threadId) => (threadId === THREAD ? "agent-1" : undefined),
    publicThreadId: (_agentId, threadId) => threadId,
    ensureSnapshot: () => snapshot,
    emitConversation: () => {},
  },
  browser: { listTabs: () => [], beginTakeover: () => Effect.void, endTakeover: () => {} },
  hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {} },
  emit: (event) => events.push(event),
  emitError: (code) => {
    errors.push(code);
  },
  emitRuntimeSnapshot: () => {},
});

let nextRequest = 300;
const request = (method: string, params: unknown): AppServerRequest => ({ id: nextRequest++, method, params });
const resolvedEvents = (requestId: RequestId) =>
  events.filter(
    (event) => event.type === "agent-input-resolved" && "requestId" in event && event.requestId === requestId,
  );

/** The rejection text of a legacy approval reply, or undefined for another shape. */
function denialOf(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null || !("decision" in result)) return undefined;
  const { decision } = result;
  if (typeof decision !== "object" || decision === null || !("denied" in decision)) return undefined;
  const { denied } = decision;
  if (typeof denied !== "object" || denied === null || !("rejection" in denied)) return undefined;
  return typeof denied.rejection === "string" ? denied.rejection : undefined;
}

/** Awaits the state a forked operation reaches, rather than a delay. */
async function untilReady(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (check()) return;
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
  }
  throw new Error(`The registry never reached: ${what}`);
}

const steps: Array<{ step: string; result: unknown }> = [];
async function step(name: string, run: () => unknown): Promise<void> {
  try {
    steps.push({ step: name, result: (await run()) ?? "ok" });
  } catch (error) {
    steps.push({ step: name, result: { failed: error instanceof Error ? error.message : String(error) } });
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await mkdir(OUT, { recursive: true });

await step("a command approval the user never answers keeps the provider waiting", async () => {
  const approvalRequest = request("item/commandExecution/requestApproval", {
    threadId: THREAD,
    turnId: TURN,
    command: ["npm", "test"],
    cwd: "/work",
  });
  registry.surfaceApproval(client, approvalRequest, "command");
  assert.equal(registry.agentIdForRequest(approvalRequest.id), "agent-1", "the card did not open");
  assert.equal(client.replies.length, 0, "the provider was answered before the user decided");
  return { requestId: approvalRequest.id };
});

await step("the turn ends: the provider gets a decline, not silence", async () => {
  const before = client.replies.length;
  registry.clearForTurn(THREAD, TURN);
  assert.equal(client.replies.length, before + 1, "the provider was left waiting for an answer");
  const reply = client.replies.at(-1);
  assert.deepEqual(reply?.result, { decision: "decline" }, "the provider got another answer than a decline");
  return reply?.result;
});

let endedRequest: RequestId | null = null;

await step("the end of the turn removes the card once", async () => {
  endedRequest = nextRequest - 1;
  assert.equal(registry.agentIdForRequest(endedRequest), undefined, "the card stayed in the registry");
  assert.equal(resolvedEvents(endedRequest).length, 1, "the client did not learn that the card closed");
  return { requestId: endedRequest, resolves: resolvedEvents(endedRequest).length };
});

await step("a legacy approval of the same thread and turn is declined too", async () => {
  const legacy = request("execCommandApproval", {
    conversationId: THREAD,
    turnId: TURN,
    command: ["git", "push"],
    cwd: "/work",
  });
  registry.surfaceLegacyApproval(client, legacy);
  assert.equal(registry.agentIdForRequest(legacy.id), "agent-1", "the card did not open");
  registry.clearForTurn(THREAD, TURN);
  const reply = client.replies.at(-1);
  assert.equal(reply?.id, legacy.id, "the provider got no answer for the legacy approval");
  assert.equal(typeof denialOf(reply?.result), "string", "the legacy reply carries no denial");
  return reply?.result;
});

await step("a built-in tool approval ends with cancel and is not answered twice", async () => {
  const toolRequest = request("openbot/tool-approval", { threadId: THREAD, turnId: TURN });
  const repliesBefore = client.replies.length;
  const fiber = Effect.runFork(
    registry.awaitToolApproval(client, toolRequest, {
      requestId: toolRequest.id,
      agentId: "agent-1",
      threadId: THREAD,
      turnId: TURN,
      kind: "command",
      command: "git push",
      cwd: null,
      reason: null,
      grantRoot: null,
      permissions: null,
    }),
  );
  await untilReady(() => registry.agentIdForRequest(toolRequest.id) === "agent-1", "the tool approval card");
  registry.clearForTurn(THREAD, TURN);
  const decision = await Effect.runPromise(Fiber.join(fiber));
  assert.equal(decision, "cancel", "the tool that waits for the answer did not stop");
  assert.equal(client.replies.length, repliesBefore, "the built-in tool was also answered over the wire");
  return { decision, replies: client.replies.length - repliesBefore };
});

await step("an approval of another turn stays", async () => {
  const other = request("item/commandExecution/requestApproval", {
    threadId: THREAD,
    turnId: "turn-2",
    command: ["npm", "run", "build"],
    cwd: "/work",
  });
  registry.surfaceApproval(client, other, "command");
  registry.clearForTurn(THREAD, TURN);
  assert.equal(registry.agentIdForRequest(other.id), "agent-1", "the approval of another turn was closed");
  assert.equal(resolvedEvents(other.id).length, 0, "the client was told about a card that still waits");
  registry.clearForTurn(THREAD, "turn-2");
  assert.equal(resolvedEvents(other.id).length, 1, "the later turn did not close its own card");
  return { requestId: other.id };
});

assert.deepEqual(errors, [], "the registry reported an error");

const report = {
  outcome: "pass",
  thread: THREAD,
  turn: TURN,
  steps,
  replies: client.replies,
  resolved: events.filter((event) => event.type === "agent-input-resolved").length,
};
await writeFile(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`approval cleanup: ${steps.length} steps pass. Report: ${resolve(OUT, "report.json")}\n`);
