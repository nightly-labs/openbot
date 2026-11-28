import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type Routine, type RoutineRun, type RoutineSchedule } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-run-changes-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-routine-run-changes-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

const ONCE = { kind: "once", date: "2099-03-01", time: "06:30" } as const;
const ALLOWED_RULE = "The user lets this routine change routines";
const LOCKED_RULE = "Do not create, update, delete, or test routines during this run.";

interface FakeArguments {
  routineId?: string;
  name?: string;
  instruction?: string;
  active?: boolean;
  schedule?: RoutineSchedule;
}

interface FakeCall {
  tool: string;
  arguments: FakeArguments;
}

const calls = (...items: FakeCall[]) => `<<CALLS${JSON.stringify(items)}CALLS>>`;
const update = (routineId: string, fields: Omit<FakeArguments, "routineId">): FakeCall => ({
  tool: "update_routine",
  arguments: { routineId, ...fields },
});

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (turn) => {
  const item = { type: "agentMessage", id: "message-" + turn.turnId, text: "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId: turn.threadId, turnId: turn.turnId, item } });
  write({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turn.turnId, status: "completed" } } });
};
const callNext = (turn) => {
  const call = turn.calls.shift();
  if (!call) return setTimeout(() => finish(turn), 20);
  const id = "tool-" + turn.turnId + "-" + turn.calls.length;
  waiting.set(id, { turn, call });
  write({
    id,
    method: "item/tool/call",
    params: { threadId: turn.threadId, turnId: turn.turnId, callId: "call-" + id, namespace: "openbot", tool: call.tool, arguments: call.arguments },
  });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      const text = (params.input || []).map((item) => item.text || "").join("\\n");
      log({ method: "turn/start", turnId, text });
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const start = text.lastIndexOf("--- routine task ---");
      const named = /<<CALLS([\\s\\S]*?)CALLS>>/.exec(start >= 0 ? text.slice(start) : text);
      return callNext({ threadId: params.threadId, turnId, calls: named ? JSON.parse(named[1]) : [] });
    }
    case "turn/interrupt":
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
      else if (!message.method && waiting.has(message.id)) {
        const { turn, call } = waiting.get(message.id);
        waiting.delete(message.id);
        log({ method: "tool-result", turnId: turn.turnId, tool: call.tool, arguments: call.arguments, result: message.result ?? null });
        callNext(turn);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface LogEntry {
  method: string;
  turnId: string;
  text?: string;
  tool?: string;
  arguments?: FakeArguments;
  result?: { success: boolean; contentItems: { type: string; text: string }[] } | null;
}

interface ToolOutcome {
  tool: string;
  arguments: FakeArguments;
  success: boolean;
  text: string;
}

const report: {
  runs: Record<string, { status: string; prompt: string; tools: ToolOutcome[] }>;
  routines: Record<string, Pick<Routine, "active" | "name"> & { schedule: unknown; runsChangeRoutines?: boolean }>;
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { runs: {}, routines: {}, checks: [], passed: false };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
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
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function fakeEntries(): LogEntry[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pass(name: string, condition: boolean, detail?: unknown) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
});

const ended = (status: string | undefined) =>
  status === "completed" || status === "failed" || status === "interrupted" || status === "cancelled";

function routineOf(agentId: string, routineId: string): Routine {
  const routine = agents.listRoutines(agentId).find((entry) => entry.id === routineId);
  assert.ok(routine, `routine ${routineId} is missing`);
  return routine;
}

function remember(name: string, routine: Routine) {
  report.routines[name] = {
    name: routine.name,
    active: routine.active,
    schedule: routine.trigger.schedule,
    ...(routine.runsChangeRoutines === undefined ? {} : { runsChangeRoutines: routine.runsChangeRoutines }),
  };
}

async function runOnce(name: string, agentId: string, routineId: string) {
  const run: RoutineRun = await runCauseEffect(agents.testRoutine({ agentId, routineId }));
  const deliveryId = run.deliveryId;
  assert.ok(deliveryId, `${name}: no delivery`);
  const delivery = await waitFor(`${name} delivery`, () => {
    const found = mailbox.getDelivery(deliveryId)?.delivery;
    return ended(found?.status) ? found : null;
  });
  const turnId = delivery.turnId;
  assert.ok(turnId, `${name}: no turn`);
  const prompt = fakeEntries().find((entry) => entry.method === "turn/start" && entry.turnId === turnId)?.text ?? "";
  const tools = fakeEntries()
    .filter((entry) => entry.method === "tool-result" && entry.turnId === turnId)
    .map((entry) => ({
      tool: entry.tool ?? "",
      arguments: entry.arguments ?? {},
      success: entry.result?.success === true,
      text: entry.result?.contentItems.map((item) => item.text).join("\n") ?? "",
    }));
  report.runs[name] = { status: delivery.status, prompt, tools };
  return { prompt, tools };
}

try {
  await runCauseEffect(agents.initialize());
  const created = await runCauseEffect(
    agents.createAgent({
      name: "Triage",
      description: "Sorts mail and plans the archive.",
      avatarSeed: "triage",
      avatarHue: null,
      initialMessage: "Hello.",
    }),
  );
  const agentId = created.id;
  await waitFor("the agent thread", () => store.list().find((entry) => entry.id === agentId)?.threadId);
  await waitFor("the first turn", () => agents.listQueue(agentId).deliveries.every((item) => ended(item.status)));

  const routine = (name: string, instruction: string) =>
    agents.createRoutine({
      agentId,
      name,
      instruction,
      active: false,
      timezone: "Europe/Berlin",
      schedule: { kind: "daily", time: "09:00" },
    });
  const archive = routine("Archive", "Archive the queued mail.");
  const locked = routine("Locked triage", "placeholder");
  const triage = routine("Mail triage", "placeholder");
  agents.updateRoutine({
    agentId,
    routineId: locked.id,
    instruction: `Sort the mail. ${calls(
      update(archive.id, { schedule: ONCE, active: true }),
      { tool: "create_routine", arguments: { name: "Extra", instruction: "Extra.", schedule: ONCE } },
      update(locked.id, { active: false }),
    )}`,
  });
  agents.updateRoutine({
    agentId,
    routineId: triage.id,
    instruction: `Sort the mail. ${calls(
      update(archive.id, { schedule: ONCE, active: true }),
      update(archive.id, { name: "Renamed archive" }),
      update(triage.id, { schedule: { kind: "daily", time: "10:15" } }),
      { tool: "delete_routine", arguments: { routineId: archive.id } },
      { tool: "test_routine", arguments: { routineId: archive.id } },
    )}`,
  });

  pass(
    "A new routine has the run changes setting off",
    [archive, locked, triage].every((entry) => routineOf(agentId, entry.id).runsChangeRoutines === false),
  );

  const lockedRun = await runOnce("Locked triage", agentId, locked.id);
  const [lockedUpdate, lockedCreate, lockedPause] = lockedRun.tools;
  remember("Archive after the locked run", routineOf(agentId, archive.id));
  pass(
    "Without the setting, the run prompt forbids routine changes",
    lockedRun.prompt.includes(LOCKED_RULE) && !lockedRun.prompt.includes(ALLOWED_RULE),
  );
  pass(
    "Without the setting, a run cannot change another routine, and the refusal names the switch",
    lockedUpdate?.success === false &&
      lockedUpdate.text.includes("Runs can change routines") &&
      routineOf(agentId, archive.id).active === false &&
      routineOf(agentId, archive.id).trigger.schedule.kind === "daily",
    lockedUpdate,
  );
  pass(
    "A run cannot create a routine",
    lockedCreate?.success === false && !agents.listRoutines(agentId).some((entry) => entry.name === "Extra"),
    lockedCreate,
  );
  pass("A run can still pause its own routine without the setting", lockedPause?.success === true, lockedPause);

  const grant = agents.updateRoutine({ agentId, routineId: triage.id, runsChangeRoutines: true });
  pass("A person turns the setting on for one routine", grant.runsChangeRoutines === true);

  const triageRun = await runOnce("Mail triage", agentId, triage.id);
  const [archiveMove, rename, ownMove, remove, test] = triageRun.tools;
  const archived = routineOf(agentId, archive.id);
  remember("Archive after the allowed run", archived);
  remember("Mail triage after its run", routineOf(agentId, triage.id));
  pass(
    "With the setting, the run prompt allows schedule and active changes only",
    triageRun.prompt.includes(ALLOWED_RULE) && !triageRun.prompt.includes(LOCKED_RULE),
  );
  pass(
    "With the setting, a run gives another routine its next once run and turns it on",
    archiveMove?.success === true &&
      archived.active === true &&
      JSON.stringify(archived.trigger.schedule) === JSON.stringify(ONCE),
    { archiveMove, archived },
  );
  pass(
    "With the setting, a run cannot change other fields of a routine",
    rename?.success === false && rename.text.includes("only the schedule and active") && archived.name === "Archive",
    rename,
  );
  pass(
    "With the setting, a run can move its own next run",
    ownMove?.success === true &&
      JSON.stringify(routineOf(agentId, triage.id).trigger.schedule) ===
        JSON.stringify({ kind: "daily", time: "10:15" }),
    ownMove,
  );
  pass(
    "With the setting, a run still cannot delete or test a routine",
    remove?.success === false &&
      test?.success === false &&
      agents.listRoutines(agentId).some((e) => e.id === archive.id),
    { remove, test },
  );
  pass(
    "The other routine keeps the setting off",
    routineOf(agentId, archive.id).runsChangeRoutines === false &&
      routineOf(agentId, locked.id).runsChangeRoutines === false,
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
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
