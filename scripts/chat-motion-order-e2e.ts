import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ConversationMessage } from "@openbot/contracts/ipc";

const MOBILE_SRC = resolve(import.meta.dirname, "../apps/mobile/src");

function mobileUrl(path: string): string {
  return pathToFileURL(join(MOBILE_SRC, path)).href;
}

interface ChatMessage {
  id: string;
  kind: string;
  author?: "agent" | "user";
  streaming?: boolean;
  progress?: true;
}

interface ChatBubbleMessage extends ChatMessage {
  kind: "message";
  author: "agent" | "user";
  body: string;
  streaming: boolean;
  mine?: boolean;
  createdAt?: string;
}

interface PendingChatMessage {
  message: ChatBubbleMessage;
  baseline: ReadonlySet<string> | null;
  serverId: string | null;
}

interface ArrivalSnapshot {
  arriving: ReadonlySet<string>;
  entered: Set<string>;
}

interface TurnStepsSummary {
  turnId: string;
  steps: number;
  seconds: number | null;
}

const {
  ENTRANCE_FRESH_MS,
  entranceFresh,
  firstArrivals,
  nextArrivals,
}: {
  ENTRANCE_FRESH_MS: number;
  entranceFresh: (snapshot: ArrivalSnapshot, id: string, now: number) => boolean;
  firstArrivals: (agentId: string, messages: readonly ChatMessage[], enabled: boolean) => ArrivalSnapshot;
  nextArrivals: (
    snapshot: ArrivalSnapshot,
    agentId: string,
    messages: readonly ChatMessage[],
    enabled: boolean,
    now: number,
  ) => ArrivalSnapshot;
} = await import(mobileUrl("features/chat/components/use-message-arrivals.ts"));
const {
  presentChatMessages,
  projectChatMessages,
}: {
  presentChatMessages: (
    messages: ChatMessage[],
    pending: readonly PendingChatMessage[],
    aliases: ReadonlyMap<string, string>,
  ) => ChatMessage[];
  projectChatMessages: (messages: ConversationMessage[]) => ChatMessage[];
} = await import(mobileUrl("features/chat/model/chat-messages.ts"));
const {
  chatTurnSummaries,
}: {
  chatTurnSummaries: (
    messages: readonly ConversationMessage[],
    activeTurnId: string | null,
    lines: Record<string, readonly unknown[]>,
    previous?: ReadonlyMap<string, TurnStepsSummary>,
  ) => ReadonlyMap<string, TurnStepsSummary>;
} = await import(mobileUrl("features/chat/model/turn-thinking.ts"));

const OUT = resolve(import.meta.dirname, "../.openbot-build/chat-motion-order-e2e");
const AGENT = "agent-1";
const START = Date.parse("2026-11-27T10:00:00.000Z");

interface ShownRow {
  id: string;
  kind: string;
  author?: "agent" | "user";
  streaming?: boolean;
  line?: { steps: number; seconds: number | null };
  arriving: boolean;
  entrance: boolean;
}

interface Step {
  step: string;
  atMs: number;
  activeTurnId: string | null;
  rows: ShownRow[];
}

const steps: Step[] = [];

function at(offsetMs: number): string {
  return new Date(START + offsetMs).toISOString();
}

function message(fields: Partial<ConversationMessage> & Pick<ConversationMessage, "id" | "author" | "text">) {
  return { status: "completed", createdAt: at(0), ...fields } satisfies ConversationMessage;
}

const history: ConversationMessage[] = [
  message({ id: "u0", turnId: "t0", author: "user", source: "user", text: "Hello", createdAt: at(-60_000) }),
  message({
    id: "c0",
    turnId: "t0",
    author: "assistant",
    itemType: "commentary",
    text: "Looking at the request",
    createdAt: at(-58_000),
  }),
  message({ id: "a0", turnId: "t0", author: "assistant", text: "Hi there", createdAt: at(-55_000) }),
];
const historyIds: ReadonlySet<string> = new Set(projectChatMessages(history).map((row) => row.id));

const localRow: ChatBubbleMessage = {
  id: "outbox:local-1",
  kind: "message",
  author: "user",
  body: "Summarize the file",
  streaming: false,
  mine: true,
  createdAt: at(1_000),
};

let snapshot: ArrivalSnapshot | null = null;
let summaries: ReadonlyMap<string, TurnStepsSummary> | undefined;
const mounted = new Set<string>();

function present(host: ConversationMessage[], pending: PendingChatMessage[], aliases: ReadonlyMap<string, string>) {
  return presentChatMessages(projectChatMessages(host), pending, aliases);
}

function mount(id: string, now: number): boolean {
  if (mounted.has(id)) return false;
  mounted.add(id);
  if (!snapshot) return false;
  const entrance = entranceFresh(snapshot, id, now);
  if (entrance) snapshot.entered.add(id);
  return entrance;
}

function show(
  step: string,
  now: number,
  host: ConversationMessage[],
  pending: PendingChatMessage[],
  aliases: ReadonlyMap<string, string>,
  activeTurnId: string | null,
  options: { scrolledAway?: boolean } = {},
): Step {
  const rows = present(host, pending, aliases);
  snapshot = snapshot ? nextArrivals(snapshot, AGENT, rows, true, now) : firstArrivals(AGENT, rows, true);
  const arrivals = snapshot;
  summaries = chatTurnSummaries(host, activeTurnId, {}, summaries);
  if (options.scrolledAway) mounted.clear();
  const visible = rows.filter((row) => row.kind !== "thinking" || Boolean(summaries?.has(row.id)));
  const shown: ShownRow[] = options.scrolledAway
    ? []
    : visible.map((row) => {
        const entrance = mount(row.id, now);
        const line = summaries?.get(row.id);
        return {
          id: row.id,
          kind: row.kind,
          ...(row.kind === "message" ? { author: row.author, streaming: row.streaming } : {}),
          ...(line ? { line: { steps: line.steps, seconds: line.seconds } } : {}),
          arriving: arrivals.arriving.has(row.id),
          entrance: entrance && row.kind === "message" && (row.author === "user" || row.progress === true),
        };
      });
  const result = { step, atMs: now - START, activeTurnId, rows: shown };
  steps.push(result);
  return result;
}

function ids(step: Step): string[] {
  return step.rows.map((row) => row.id);
}

function row(step: Step, id: string): ShownRow {
  const found = step.rows.find((item) => item.id === id);
  assert.ok(found, `${step.step}: row ${id} is not shown`);
  return found;
}

function writeReport(passed: boolean, failure?: string): string {
  mkdirSync(OUT, { recursive: true });
  const reportPath = resolve(OUT, "report.json");
  writeFileSync(
    reportPath,
    `${JSON.stringify({ passed, ...(failure ? { failure } : {}), freshWindowMs: ENTRANCE_FRESH_MS, steps }, null, 2)}\n`,
  );
  return reportPath;
}

function run(): void {
  const noAliases: ReadonlyMap<string, string> = new Map();
  const aliases: ReadonlyMap<string, string> = new Map([["u1", localRow.id]]);

  const opened = show("open", START, history, [], noAliases, null);
  assert.deepEqual(ids(opened), ["u0", "a0"]);
  assert.ok(
    opened.rows.every((item) => !item.entrance),
    "history rows play no entrance",
  );

  const sent = show(
    "send",
    START + 1_000,
    history,
    [{ message: localRow, baseline: historyIds, serverId: null }],
    noAliases,
    null,
  );
  assert.equal(ids(sent).at(-1), localRow.id);
  assert.equal(row(sent, localRow.id).entrance, true, "the sent row plays its entrance once");

  const thought = message({
    id: "c1",
    turnId: "t1",
    author: "assistant",
    itemType: "commentary",
    text: "Reading the file",
    createdAt: at(1_400),
  });
  const streamed = (text: string) =>
    message({ id: "a1", turnId: "t1", author: "assistant", text, status: "streaming", createdAt: at(1_600) });

  const thinking = show(
    "thinking",
    START + 1_600,
    [...history, thought, streamed("The file")],
    [{ message: localRow, baseline: historyIds, serverId: "u1" }],
    aliases,
    "t1",
  );
  assert.ok(
    ids(thinking).indexOf(localRow.id) < ids(thinking).indexOf("a1"),
    "the sent row stays above an answer delta that comes before its host copy",
  );
  assert.deepEqual(row(thinking, "a1").line, { steps: 1, seconds: null }, "the running turn shows its line at once");

  const stream = show(
    "stream",
    START + 2_000,
    [...history, thought, streamed("The file lists three steps")],
    [{ message: localRow, baseline: historyIds, serverId: "u1" }],
    aliases,
    "t1",
  );
  assert.equal(row(stream, localRow.id).entrance, false);
  assert.deepEqual(row(stream, "a1").line, { steps: 1, seconds: null });

  const hostUser = message({
    id: "u1",
    turnId: "t1",
    author: "user",
    source: "user",
    text: localRow.body,
    createdAt: at(1_000),
  });
  const hostCopy = show(
    "host copy",
    START + 2_200,
    [...history, hostUser, thought, streamed("The file lists three steps and")],
    [{ message: localRow, baseline: historyIds, serverId: "u1" }],
    aliases,
    "t1",
  );
  assert.deepEqual(ids(hostCopy), ["u0", "a0", localRow.id, "a1"]);

  const ended = show(
    "turn end before the page",
    START + 2_600,
    [...history, hostUser, thought, streamed("The file lists three steps and a summary.")],
    [],
    aliases,
    null,
  );
  assert.equal(row(ended, "a1").line?.steps, 1, "the line stays on the same row");
  assert.equal(typeof row(ended, "a1").line?.seconds, "number", "the line shows the time without the page");

  const finalAnswer = message({
    id: "a1",
    turnId: "t1",
    author: "assistant",
    text: "The file lists three steps and a summary.",
    createdAt: at(1_600),
  });
  const reloaded = show("page reload", START + 3_000, [...history, hostUser, thought, finalAnswer], [], aliases, null);
  assert.deepEqual(ids(reloaded), ids(ended), "the page reload does not move a row");
  assert.deepEqual(row(reloaded, "a1").line, row(ended, "a1").line);

  show("scroll away", START + 3_200, [...history, hostUser, thought, finalAnswer], [], aliases, null, {
    scrolledAway: true,
  });
  const remounted = show("remount", START + 3_400, [...history, hostUser, thought, finalAnswer], [], aliases, null);
  assert.ok(
    remounted.rows.every((item) => !item.entrance),
    "a row that mounts again does not replay its entrance",
  );

  const later: ChatBubbleMessage = {
    ...localRow,
    id: "outbox:local-2",
    body: "And the next one",
    createdAt: at(8_000),
  };
  const laterBaseline: ReadonlySet<string> = new Set(
    projectChatMessages([...history, hostUser, thought, finalAnswer]).map((item) => item.id),
  );
  show(
    "send while scrolled away",
    START + 8_000,
    [...history, hostUser, thought, finalAnswer],
    [{ message: later, baseline: laterBaseline, serverId: null }],
    aliases,
    null,
    { scrolledAway: true },
  );
  const lateMount = show(
    "first mount after the fresh window",
    START + 8_000 + ENTRANCE_FRESH_MS + 500,
    [...history, hostUser, thought, finalAnswer],
    [{ message: later, baseline: laterBaseline, serverId: null }],
    aliases,
    null,
  );
  assert.equal(row(lateMount, later.id).arriving, true, "the row still counts as arriving for playback");
  assert.equal(row(lateMount, later.id).entrance, false, "an old arrival plays no entrance");

  for (const step of steps) {
    const order = ids(step);
    if (order.includes(localRow.id) && order.includes("a1"))
      assert.ok(order.indexOf(localRow.id) < order.indexOf("a1"), `${step.step}: the user row is above its answer`);
  }
}

try {
  run();
} catch (error) {
  const reportPath = writeReport(false, error instanceof Error ? error.message : String(error));
  process.stderr.write(`chat motion order failed, report at ${reportPath}\n`);
  throw error;
}
const reportPath = writeReport(true);
process.stdout.write(`chat motion order: ${steps.length} steps passed, report at ${reportPath}\n`);
