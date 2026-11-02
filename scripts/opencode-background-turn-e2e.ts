// Runs turns on the real OpenCode driver against a fake `opencode acp` that answers a finished
// background subagent in a turn it sends no update for, as OpenCode 2.2.0 does (#3406). Checks that
// the background turn shows as a turn of the agent's own, from `session/load`, with all its items;
// that text before a tool call stays thinking there too; that a message sent meanwhile waits for it;
// and that a stopped background turn does not come back.
// `bun run test:opencode-background-turn`. Writes .openbot-build/opencode-background-turn-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentClient, ProviderTurnActiveError } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type AppServerNotification, getRecord, getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-background-turn-e2e");
/** The background turn ends when its session stays unchanged for 15 s; this leaves room for that. */
const WAIT_MS = 60_000;

interface Event {
  method: string;
  turnId: string | null;
  unprompted: boolean;
  status: string | null;
  item: {
    id: string | null;
    type: string | null;
    phase: string | null;
    text: string | null;
    status: string | null;
  } | null;
}

interface Report {
  passed: boolean;
  events: Record<string, Event[]>;
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-background-turn-e2e-"));
const release = join(root, "release");
const log = join(root, "fake.jsonl");
const report: Report = { passed: false, events: {} };
const clients: AgentClient[] = [];

/** The notifications of one thread, and a wait for one that matches. */
function record(client: AgentClient, thread: string) {
  const events: Event[] = [];
  report.events[thread] = events;
  const waiters = new Set<() => void>();
  client.on("notification", (notification: AppServerNotification) => {
    const params = notification.params;
    if (getString(params, "threadId") !== thread) return;
    const turn = getRecord(params, "turn");
    const item = isRecord(params) && isRecord(params.item) ? params.item : null;
    events.push({
      method: notification.method,
      turnId: getString(params, "turnId") ?? getString(turn, "id"),
      unprompted: isRecord(params) && params.unprompted === true,
      status: getString(turn, "status"),
      item: item && {
        id: getString(item, "id"),
        type: getString(item, "type"),
        phase: getString(item, "phase"),
        text: getString(item, "text"),
        status: getString(item, "status"),
      },
    });
    for (const waiter of waiters) waiter();
  });
  const until = (label: string, find: (event: Event) => boolean): Promise<Event> =>
    new Promise((found, fail) => {
      const check = () => {
        const event = events.find(find);
        if (!event) return;
        waiters.delete(check);
        clearTimeout(timer);
        found(event);
      };
      const timer = setTimeout(() => {
        waiters.delete(check);
        fail(new Error(`Timed out waiting for ${label}.`));
      }, WAIT_MS);
      waiters.add(check);
      check();
    });
  /** The completed agent messages and tool calls of one turn, in order. */
  const items = (turnId: string) =>
    events
      .filter((event) => event.method === "item/completed" && event.turnId === turnId && event.item)
      .map((event) => event.item);
  return { events, until, items };
}

/** The turn that `runTurn` started: the last `turn/started` before its completion. */
function lastTurnId(events: readonly Event[]): string {
  const started = events.filter((event) => event.method === "turn/started").at(-1);
  assert.ok(started?.turnId, "A turn started.");
  return started.turnId;
}

function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (
    let current = error;
    current !== undefined && chain.length < 8;
    current = isRecord(current) ? current.cause : undefined
  )
    chain.push(current);
  return chain;
}

/** Waits until the fake has loaded the session again after the background turn's end. */
async function loadedAfterEnd(session: string): Promise<void> {
  for (;;) {
    const entries = await readJsonl<{ event: string; session: string }>(log);
    const ended = entries.findIndex((entry) => entry.event === "background-ended" && entry.session === session);
    if (ended >= 0 && entries.slice(ended).some((entry) => entry.event === "load" && entry.session === session)) return;
    await new Promise((next) => setTimeout(next, 200));
  }
}

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  await mkdir(release);
  const executable = join(root, "opencode", "bin", "opencode");
  await installFakeAgent(executable, "opencode-background-turn", { FAKE_RELEASE: release, FAKE_LOG: log });
  const cli: AgentCliInfo = { executable, version: "2.2.0", source: "managed" };
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();

  // Text before a tool call is thinking. The text of the last steps is one answer, in paragraphs.
  const first = await startThread(client, { cwd: workspace });
  const one = record(client, first);
  assert.equal((await runTurn(client, first, { text: "steps" })).status, "completed");
  const stepped = one.items(lastTurnId(one.events));
  assert.deepEqual(
    stepped.filter((item) => item?.type === "agentMessage").map((item) => [item?.phase, item?.text]),
    [
      ["commentary", "I will check the file."],
      ["final_answer", "The file is fine.\n\nNothing to change."],
    ],
    "The text before the tool call is thinking, and the answer keeps the text of both last steps.",
  );

  // A background subagent's turn shows from `session/load`, as a turn of the agent's own.
  assert.equal((await runTurn(client, first, { text: "background" })).status, "completed");
  const own = await one.until("the background turn", (event) => event.method === "turn/started" && event.unprompted);
  assert.ok(own.turnId);
  await one.until(
    "the background turn's open tool call",
    (event) => event.turnId === own.turnId && event.method === "item/started" && event.item?.id === "tool_bg_check",
  );
  // A message sent meanwhile does not join the agent's turn: the drain queues it again.
  const refused = await runTurn(client, first, { text: "ping", timeoutMs: WAIT_MS }).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(
    causes(refused).some((cause) => cause instanceof ProviderTurnActiveError),
    `A prompt during the agent's own turn fails with ProviderTurnActiveError: ${String(refused)}`,
  );
  await writeFile(join(release, first), "");
  const ended = await one.until(
    "the background turn's end",
    (event) => event.method === "turn/completed" && event.turnId === own.turnId,
  );
  assert.equal(ended.status, "completed");
  assert.deepEqual(
    one.items(own.turnId).map((item) => [item?.type, item?.phase ?? item?.status, item?.text ?? item?.id]),
    [
      ["agentMessage", "commentary", "The subagent is done."],
      ["agentMessage", "commentary", "Checking its file."],
      ["toolCall", "completed", "tool_bg_check"],
      ["agentMessage", "final_answer", "The background task finished: DONE."],
    ],
    "The background turn has its thought, its note, its tool call and its answer, each once.",
  );
  const after = await runTurn(client, first, { text: "ping" });
  assert.equal(after.status, "completed");
  assert.equal(after.reply, "pong");
  assert.equal(
    one.events.filter((event) => event.method === "turn/started" && event.unprompted).length,
    1,
    "The replay after the prompt finds nothing new.",
  );

  // A stopped background turn does not come back when the agent adds to it.
  const second = await startThread(client, { cwd: workspace });
  const two = record(client, second);
  assert.equal((await runTurn(client, second, { text: "background" })).status, "completed");
  const stopped = await two.until(
    "the second background turn",
    (event) => event.method === "turn/started" && event.unprompted,
  );
  await two.until(
    "the second background turn's open tool call",
    (event) => event.turnId === stopped.turnId && event.method === "item/started" && event.item?.id === "tool_bg_check",
  );
  await runCauseEffect(
    client.request("turn/interrupt", { threadId: second, turnId: stopped.turnId }, (value) => value),
  );
  const interrupted = await two.until(
    "the stopped background turn's end",
    (event) => event.method === "turn/completed" && event.turnId === stopped.turnId,
  );
  assert.equal(interrupted.status, "interrupted");
  await writeFile(join(release, second), "");
  await loadedAfterEnd(second);
  const pong = await runTurn(client, second, { text: "ping" });
  assert.equal(pong.reply, "pong");
  assert.equal(
    two.events.filter((event) => event.method === "turn/started" && event.unprompted).length,
    1,
    "The rest of the stopped turn does not start another turn.",
  );
  assert.ok(
    !two.events.some((event) => event.item?.text === "The background task finished: DONE."),
    "The rest of the stopped turn is not shown.",
  );
  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`PASS opencode-background-turn-e2e: ${join(OUT, "report.json")}\n`);
