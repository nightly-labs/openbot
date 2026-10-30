// Measures the tokens of each turn that OpenBot starts, as the usage analytics record them. Runs the
// real agent service on a temporary profile with the real Claude CLI and the user's Claude login, on
// Claude Haiku. The agent does:
//   1. a main chat of `--turns=<n>` short turns (20 when absent), one after the other,
//   2. one routine run, in the ephemeral session of the routine,
//   3. three Discord messages in one conversation.
// Each turn records its uncached input, cache read, cache write and output tokens. The report shows if
// a long chat sends its history again uncached, and what a routine and a Discord turn cost.
// Costs about 25 Haiku turns. `bun run test:token-usage`; `--turns=<n>` sets the chat turns.
// Writes .openbot-build/token-usage-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/token-usage-e2e");
const MODEL = "claude-haiku-5-5";
const PROMPT = "Reply with the single word OK. Do not use any tool.";
const turnsArgument = process.argv.find((argument) => argument.startsWith("--turns="));
const CHAT_TURNS = turnsArgument ? Number(turnsArgument.slice("--turns=".length)) : 20;
assert.ok(Number.isInteger(CHAT_TURNS) && CHAT_TURNS >= 2, "--turns must be a whole number of 2 or more");

// The workspace home is temporary. `process.env.HOME` stays, so the Claude CLI uses the user's login.
const root = await mkdtemp(join(tmpdir(), "openbot-token-usage-"));
const userData = join(root, "user-data");
const home = join(root, "home");
mkdirSync(home, { recursive: true });

interface TurnReport {
  kind: "chat" | "routine" | "discord";
  index: number;
  /** The characters of the message text, not of the whole turn input. */
  messageCharacters: number;
  uncachedInput: number | null;
  cachedInput: number | null;
  cacheCreation: number | null;
  output: number | null;
  /** All the prompt tokens: uncached, cache read and cache write. */
  prompt: number | null;
}

const report: {
  model: string;
  chatTurns: number;
  turns: TurnReport[];
  summary?: Record<string, number | null>;
  passed: boolean;
  error?: string;
} = { model: MODEL, chatTurns: CHAT_TURNS, turns: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

/** Waits for a state of the service. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 180_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "claude",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "claude"),
});
/** The start of the usage records that `readTurn` reads. The database opens in `initialize`. */
let since = "";

/** Waits for the delivery to end, then for the usage of its turn. */
async function measure(
  agentId: string,
  deliveryId: string,
  kind: TurnReport["kind"],
  index: number,
  messageCharacters: number,
): Promise<TurnReport> {
  const delivery = await waitFor(`${kind} turn ${index} to end`, () => {
    const current = mailbox.getDelivery(deliveryId)?.delivery;
    return current && ["completed", "failed", "interrupted"].includes(current.status) ? current : null;
  });
  assert.equal(delivery.status, "completed", delivery.error ?? delivery.status);
  const turnId = delivery.turnId;
  assert.ok(turnId, `${kind} turn ${index} has no turn id`);
  const models = await waitFor(
    `the usage of ${kind} turn ${index}`,
    () => {
      const usage = database.usage.readTurn(agentId, turnId, since);
      return usage.length > 0 ? usage : null;
    },
    15_000,
  );
  const sum = (key: "uncachedInput" | "cachedInput" | "cacheCreation" | "output") =>
    models.reduce<number | null>((total, model) => {
      const value = model.tokens[key];
      return total === null || value === null ? null : total + value;
    }, 0);
  const uncachedInput = sum("uncachedInput");
  const cachedInput = sum("cachedInput");
  const cacheCreation = sum("cacheCreation");
  const prompt =
    uncachedInput === null || cachedInput === null || cacheCreation === null
      ? null
      : uncachedInput + cachedInput + cacheCreation;
  const turn = {
    kind,
    index,
    messageCharacters,
    uncachedInput,
    cachedInput,
    cacheCreation,
    output: sum("output"),
    prompt,
  };
  report.turns.push(turn);
  process.stdout.write(`${JSON.stringify(turn)}\n`);
  return turn;
}

function average(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === values.length && known.length > 0
    ? Math.round(known.reduce((total, value) => total + value, 0) / known.length)
    : null;
}

try {
  await runCauseEffect(agents.initialize());
  since = database.usage.collectionStartedAt();

  // 1. The main chat.
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Token usage",
      description: "Measures the tokens of each turn.",
      avatarSeed: "token-usage",
      avatarHue: null,
      provider: "claude",
      model: MODEL,
      initialMessage: `Turn 1. ${PROMPT}`,
    }),
  );
  // The first message is queued or already running: a real turn takes seconds.
  const first = await waitFor(
    "the first delivery",
    () => mailbox.queuedDeliveryIds(agent.id)[0] ?? mailbox.listRuntimeWork([agent.id], new Map())[0]?.id,
  );
  await measure(agent.id, first, "chat", 1, `Turn 1. ${PROMPT}`.length);
  for (let index = 2; index <= CHAT_TURNS; index++) {
    const text = `Turn ${index}. ${PROMPT}`;
    const receipt = await runCauseEffect(agents.sendMessage({ agentId: agent.id, text }));
    const deliveryId = receipt.deliveries[0]?.id;
    assert.ok(deliveryId, `no delivery for chat turn ${index}`);
    await measure(agent.id, deliveryId, "chat", index, text.length);
  }

  // 2. One routine run.
  const instruction = `Routine run. ${PROMPT}`;
  const routine = agents.createRoutine(
    {
      agentId: agent.id,
      name: "Token check",
      instruction,
      active: false,
      timezone: "UTC",
      schedule: { kind: "custom", expression: "0 0 1 1 *" },
    },
    { recordConversationEvent: false },
  );
  const run = await runCauseEffect(agents.testRoutine({ agentId: agent.id, routineId: routine.id }));
  assert.ok(run.deliveryId, "the routine run has no delivery");
  await measure(agent.id, run.deliveryId, "routine", 1, instruction.length);

  // 3. Three Discord messages in one conversation.
  const threads = agents.messaging;
  const connection = threads.store.ensureConnection("discord", "guild-1", "Test server");
  threads.store.updateConnection(connection.connectionId, { enabled: true });
  for (const [index, messageId] of ["101", "102", "103"].entries()) {
    const text = `Discord message ${index + 1}. ${PROMPT}`;
    const received = await runCauseEffect(
      threads.receive({
        connectionId: connection.connectionId,
        agentId: agent.id,
        platformChannelId: "channel-1",
        threadKey: "100",
        isDirect: false,
        title: "#general",
        text,
        sourcePaths: [],
        origin: { authorId: "user-1", authorName: "Ada", platformMessageId: messageId },
        idempotencyKey: `discord:${messageId}`,
      }),
    );
    assert.equal(received.status, "queued");
    if (received.status !== "queued") break;
    await measure(agent.id, received.deliveryId, "discord", index + 1, text.length);
  }

  const chat = report.turns.filter((turn) => turn.kind === "chat");
  const later = chat.slice(2);
  report.summary = {
    chatFirstPrompt: chat[0]?.prompt ?? null,
    chatSecondPrompt: chat[1]?.prompt ?? null,
    chatLastPrompt: chat.at(-1)?.prompt ?? null,
    chatAverageUncachedAfterTurn2: average(later.map((turn) => turn.uncachedInput)),
    chatAverageCacheWriteAfterTurn2: average(later.map((turn) => turn.cacheCreation)),
    chatAverageCacheReadAfterTurn2: average(later.map((turn) => turn.cachedInput)),
    routinePrompt: report.turns.find((turn) => turn.kind === "routine")?.prompt ?? null,
    discordAveragePrompt: average(report.turns.filter((turn) => turn.kind === "discord").map((turn) => turn.prompt)),
  };
  assert.ok(
    later.every((turn) => (turn.cachedInput ?? 0) > 0),
    "a later chat turn did not read the prompt cache",
  );
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(
    `${JSON.stringify({ summary: report.summary, passed: report.passed, error: report.error }, null, 2)}\n`,
  );
}
