// Fault-injection E2E for the amendment fallback (#9490 review). The real AgentService runs on a
// temporary profile with a fake Codex app-server. A prompt that starts with `TOOLCALL` makes the fake
// provider call one OpenBot tool through the real tool router, as a provider tool call does — this is
// injected behaviour for the test, not a real provider turn.
// `bun scripts/steer-amend-fallback-e2e.ts`. Writes .openbot-build/steer-amend-fallback-e2e/report.json.
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS, type QueueDelivery } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/steer-amend-fallback-e2e");
const root = process.env.STEER_E2E_CHILD_ROOT ?? (await mkdtemp(join(tmpdir(), "openbot-steer-amend-e2e-")));
if (process.env.STEER_E2E_CHILD_ROOT) mkdirSync(process.env.STEER_E2E_CHILD_ROOT, { recursive: true });
const home = join(root, "home");
const logPath = join(root, "protocol.jsonl");
const controlPath = join(root, "control.json");
const fakeCodex = join(root, "codex");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
process.env.OPENBOT_FAKE_CODEX_LOG = logPath;
process.env.OPENBOT_FAKE_CODEX_CONTROL = controlPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface Report {
  startedAt: string;
  delivery?: { status: string; sender: unknown; recipientAgentIds: string[] };
  routerCallWorked?: boolean;
  refusedSteer?: {
    expectsReply: boolean;
    status: string;
    steerFallback: string | null;
    refused: boolean;
    requestDeliveryId: string;
  };
  correctionAnswer?: {
    count: number;
    replyTo: string | null;
    correctionMessageId: string;
    text: string | null;
    requestTurn: string | null;
    correctionTurn: string | null;
  };
  case3?: {
    beforeRestart: { status: string; expectsReply: boolean };
    count: number;
    replyTo: string | null;
    correctionMessageId: string;
    status: string | null;
  };
  passedCase2?: boolean;
  passedCase3?: boolean;
  case4?: {
    storedBeforeRestart: boolean;
    count: number;
    replyTo: string | null;
    correctionMessageId: string;
    status: string | null;
    restored: boolean;
  };
  passedCase4?: boolean;
  passed?: boolean;
  failure?: string;
}
const report: Report = { startedAt: new Date().toISOString() };
const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
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

const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.160.1\\n");
  process.exit(0);
}
const log = (entry) => fs.appendFileSync(process.env.OPENBOT_FAKE_CODEX_LOG, JSON.stringify(entry) + "\\n");
const control = () => JSON.parse(fs.readFileSync(process.env.OPENBOT_FAKE_CODEX_CONTROL, "utf8"));
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
const prefix = "p" + process.pid + "-";
let buffer = "";
let threads = 0;
let turns = 0;
/** turnId -> { threadId, timer } of each turn that runs. */
const running = new Map();
const toolCalls = new Map();
/** The turn ids that refuseOnce already refused. */
const refused = new Set();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (turnId, status) => {
  const turn = running.get(turnId);
  if (!turn) return;
  running.delete(turnId);
  clearTimeout(turn.timer);
  log({ turnEnded: turnId, threadId: turn.threadId, status, token: turn.token ?? null });
  if (status === "completed") {
    const answer = turn.token ? "DONE " + turn.token : "Done.";
    const item = { type: "agentMessage", id: "message-" + turnId, text: answer, phase: "final_answer" };
    write({ method: "item/completed", params: { threadId: turn.threadId, turnId, item } });
  }
  write({ method: "turn/completed", params: { threadId: turn.threadId, turn: { id: turnId, status } } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: prefix + "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const { holdTurns, turnMs, startedFirst, clientTurnIds, refuseOnce } = control();
      const turnId = clientTurnIds && params.clientUserMessageId ? params.clientUserMessageId : prefix + "turn-" + (++turns);
      if (clientTurnIds && [...running.values()].some((turn) => turn.threadId === params.threadId))
        return write({ id: message.id, error: { code: -32600, message: "The thread already has an active turn." } });
      const started = { method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } };
      if (startedFirst) write(started);
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      if (!startedFirst) write(started);
      if (refuseOnce && !refused.has(turnId)) {
        refused.add(turnId);
        const refuse = () => {
          const error = { message: "Item with encrypted_content was not issued to this caller." };
          write({ method: "error", params: { threadId: params.threadId, turnId, error, willRetry: false } });
          finish(turnId, "failed");
        };
        running.set(turnId, { threadId: params.threadId, timer: setTimeout(refuse, 200) });
        return;
      }
      const inputText = Array.isArray(params.input)
        ? params.input.map((item) => (item && typeof item.text === "string" ? item.text : "")).join(String.fromCharCode(10))
        : typeof params.prompt === "string" ? params.prompt : "";
      const marker = inputText.indexOf("TOOLCALL ");
      const prompt = marker >= 0 ? inputText.slice(marker).trim() : inputText.trim();
      const hold = holdTurns || prompt.includes("HOLD");
      const token = inputText.includes("TOKEN:") ? inputText.split("TOKEN:")[1].trim().split(String.fromCharCode(32))[0] : null;
      const timer = hold ? undefined : setTimeout(() => finish(turnId, "completed"), turnMs);
      running.set(turnId, { threadId: params.threadId, timer, token });
      // Fault-injection hook: a prompt that starts with TOOLCALL names one OpenBot tool to call
      // through the real tool router, as a provider tool call does.
      if (prompt.startsWith("TOOLCALL ")) {
        const call = JSON.parse(prompt.slice("TOOLCALL ".length));
        toolCalls.set(call.callId, turnId);
        write({ id: "tool-" + call.callId, method: "item/tool/call", params: {
          threadId: params.threadId, turnId, callId: call.callId, namespace: "openbot",
          tool: call.tool, arguments: call.arguments,
        } });
      }
      return;
    }
    case "turn/steer": {
      const { hangSteer, refuseSteer } = control();
      if (hangSteer) {
        log({ event: "steer-hung", turnId: params.turnId ?? null });
        return;
      }
      if (refuseSteer) {
        log({ event: "steer-refused", turnId: params.turnId ?? null });
        return write({ id: message.id, error: { code: -32600, message: "The test refuses this steer." } });
      }
      log({ event: "steer-accepted", turnId: params.turnId ?? null });
      return write({ id: message.id, result: {} });
    }
    case "turn/interrupt": {
      if (!running.has(params.turnId)) return write({ id: message.id, error: { code: -32600, message: "no active turn to interrupt" } });
      write({ id: message.id, result: {} });
      return finish(params.turnId, "interrupted");
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
setInterval(() => {
  try {
    const { releaseHeldTurns } = control();
    if (!releaseHeldTurns) return;
    for (const [turnId, turn] of [...running]) if (!turn.timer) finish(turnId, "completed");
  } catch {
    // The control file is rewritten by the test; a partial read waits for the next tick.
  }
}, 150).unref();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.id && typeof message.id === "string" && message.id.startsWith("tool-") && !message.method) {
        log({ event: "tool-call-result", callId: message.id.slice(5), result: message.result ?? null, error: message.error ?? null });
        const turnId = toolCalls.get(message.id.slice(5));
        if (turnId) { toolCalls.delete(message.id.slice(5)); finish(turnId, "completed"); }
        continue;
      }
      log({ method: message.method ?? null, id: message.id ?? null, params: message.params ?? null });
      if (message.method && message.id !== undefined) answer(message);
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

interface Control {
  holdTurns: boolean;
  turnMs: number;
  refuseSteer?: boolean;
  releaseHeldTurns?: boolean;
  hangSteer?: boolean;
}
const control = (value: Control) => writeFile(controlPath, JSON.stringify(value));
await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
await control({ holdTurns: false, turnMs: 500 });

interface Instance {
  database: InstanceType<typeof OpenBotDatabase>;
  store: InstanceType<typeof AgentStore>;
  mailbox: InstanceType<typeof MailboxStore>;
  agents: InstanceType<typeof AgentService>;
}

/** Boots the service on the profile. A restart builds a new service and a new database handle. */
const boot = async (dir = root): Promise<Instance> => {
  const userData = join(dir, "user-data");
  const home = join(dir, "home");
  const database = new OpenBotDatabase(userData);
  const store = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
  const agents = new AgentService({
    store,
    mailbox,
    browser,
    preferredProvider: "codex",
    offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
    busyMessageMode: () => "queue",
  });
  await runCauseEffect(agents.initialize());
  return { database, store, mailbox, agents };
};

const stopInstance = async (instance: Instance) => {
  await runCauseEffect(instance.agents.stop()).catch(() => {});
  instance.database.close();
};

const waitFor = async <T>(what: string, read: () => T | null | undefined, timeoutMs = 25_000): Promise<T> => {
  const started = Date.now();
  let last: unknown = null;
  while (Date.now() - started < timeoutMs) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    last = value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${what}. Last value: ${JSON.stringify(last)}`);
};

/** How often the fake provider refused a steer, read from the protocol log it writes. */
const refuseCount = (): number => {
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.includes('"event":"steer-refused"')).length;
  } catch {
    return 0;
  }
};

const requireTrue = (value: unknown, label: string) => {
  if (value !== true) throw new Error(`Assertion failed: ${label}`);
};

/** `STEER_E2E_ONLY=2` runs only the cases whose number is listed, comma separated. */
const only = (process.env.STEER_E2E_ONLY ?? "").split(",").filter(Boolean);
const runCase = (number: number) => only.length === 0 || only.includes(String(number));
let failure: string | null = null;
let crashChild: ReturnType<typeof Bun.spawn> | null = null;
let crashInstance: Instance | null = null;
let instance = await boot();
let agents: Instance["agents"] = instance.agents;
let mailbox: Instance["mailbox"] = instance.mailbox;
let store: Instance["store"] = instance.store;

const createAgent = async (name: string, initialMessage = "Wait.") => {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Fault-injection agent for the amendment fallback.",
      avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
      avatarHue: null,
      initialMessage,
    }),
  );
  return agent.id;
};

/** Runs one tool call in the sender's own turn, as a provider tool call does. */
interface SendArguments {
  recipientAgentIds: string[];
  text: string;
  expectsReply?: boolean;
}

const callTool = async (agentId: string, arguments_: SendArguments) => {
  await runCauseEffect(
    agents.sendMessage({
      agentId,
      text: `TOOLCALL ${JSON.stringify({ callId: `call-${randomUUID()}`, tool: "send_message", arguments: arguments_ })}`,
    }),
  );
};

const byText = (agentId: string, needle: string) =>
  mailbox.listQueue(agentId).deliveries.find((row: QueueDelivery) => row.text.includes(needle));

const rowsWith = (agentId: string, needle: string) =>
  mailbox.listQueue(agentId).deliveries.filter((row: QueueDelivery) => row.text.includes(needle));

const senderIdle = async (agentId: string) => {
  await waitFor("the sender's turn to end", () => {
    const own = mailbox.listQueue(agentId).deliveries;
    return own.length > 0 && own.every((row: QueueDelivery) => row.status === "completed") ? true : undefined;
  });
};

/** The crash phase: drives the flow until the steer hangs, then waits to be killed. */
const isChild = process.env.STEER_E2E_CHILD === "1";
if (isChild) {
  await control({ holdTurns: false, refuseSteer: false, releaseHeldTurns: false, turnMs: 400, hangSteer: true });
  const childInstance = await boot();
  const childAgents = childInstance.agents;
  const childStore = childInstance.store;
  const childMailbox = childInstance.mailbox;
  const createChildAgent = async (name: string, initialMessage = "Wait.") =>
    (
      await runCauseEffect(
        childAgents.createAgent({
          name,
          description: "Crash phase for the nextQueued restore.",
          avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
          avatarHue: null,
          initialMessage,
        }),
      )
    ).id;
  const recipient = await createChildAgent("Crash recipient");
  await runCauseEffect(childStore.updateAgent({ agentId: recipient, busyMessageMode: "steer" }));
  const sender = await createChildAgent("Crash sender");
  const toolCall = async (arguments_: SendArguments) =>
    runCauseEffect(
      childAgents.sendMessage({
        agentId: sender,
        text: `TOOLCALL ${JSON.stringify({ callId: `call-${randomUUID()}`, tool: "send_message", arguments: arguments_ })}`,
      }),
    );
  await toolCall({ recipientAgentIds: [recipient], text: "REQUEST HOLD TOKEN:c1", expectsReply: true });
  const request = await waitFor("the crash request to reach the recipient", () =>
    childMailbox.listQueue(recipient).deliveries.find((row: QueueDelivery) => row.text.includes("TOKEN:c1")),
  );
  await waitFor("the crash request to run", () =>
    childMailbox.getDelivery(request.id)?.delivery.status === "running" ? true : undefined,
  );
  await waitFor("the crash sender to be idle", () => {
    const own = childMailbox.listQueue(sender).deliveries;
    return own.length > 0 && own.every((row: QueueDelivery) => row.status === "completed") ? true : undefined;
  });
  await runCauseEffect(childAgents.readConversation(recipient));
  // The steer never answers, so this call stays open: the amendment is already stored.
  void toolCall({ recipientAgentIds: [recipient], text: "CORRECTION TOKEN:c2" }).catch(() => {});
  // Kill at the instant the amendment is in the queue: this is the state a crash leaves before
  // the steer starts, so the restart has to restore the request through nextQueued.
  for (;;) {
    const row = childMailbox
      .listQueue(recipient)
      .deliveries.find((item: QueueDelivery) => item.text.includes("TOKEN:c2"));
    if (row && row.expectsReply === false && row.status === "queued") {
      process.stdout.write(`CHILD-READY ${JSON.stringify({ deliveryId: row.id, messageId: row.messageId, sender })}\n`);
      process.kill(process.pid, "SIGKILL");
    }
    await Bun.sleep(1);
  }
}

try {
  await control({ holdTurns: false, turnMs: 500 });

  // Case 1: a prompt that names a tool makes the fake provider call it through the real router.
  if (runCase(1)) {
    const recipient = await createAgent("Amender B");
    const sender1 = await createAgent(
      "Amender A",
      `TOOLCALL ${JSON.stringify({
        callId: `call-${randomUUID()}`,
        tool: "send_message",
        arguments: { recipientAgentIds: [recipient], text: `AMEND-PROBE-${Date.now()}`, expectsReply: true },
      })}`,
    );
    const queued = await waitFor("the router delivers to B", () => byText(recipient, "AMEND-PROBE"));
    report.delivery = { status: queued.status, sender: queued.sender, recipientAgentIds: [recipient] };
    report.routerCallWorked = sender1 !== recipient && queued.status === "queued";
    process.stdout.write(`CASE1 ${JSON.stringify(report.delivery)}\n`);
  }

  // Case 2: the provider refuses the steer, so the correction becomes a request again and answers
  // its sender from a turn of its own.
  if (runCase(2)) {
    await control({ holdTurns: false, refuseSteer: true, releaseHeldTurns: false, turnMs: 400 });
    const recipient2 = await createAgent("Steer recipient");
    await runCauseEffect(store.updateAgent({ agentId: recipient2, busyMessageMode: "steer" }));
    const sender2 = await createAgent("Steer sender");
    await callTool(sender2, {
      recipientAgentIds: [recipient2],
      text: "REQUEST HOLD TOKEN:req1",
      expectsReply: true,
    });
    const request = await waitFor("the request to reach the recipient", () => byText(recipient2, "TOKEN:req1"));
    await waitFor("the request to run at the recipient", () =>
      mailbox.getDelivery(request.id)?.delivery.status === "running" ? true : undefined,
    );
    await senderIdle(sender2);
    await runCauseEffect(agents.readConversation(recipient2));

    const refusalsBefore = refuseCount();
    await callTool(sender2, { recipientAgentIds: [recipient2], text: "CORRECTION TOKEN:req2" });
    const correction = await waitFor("the correction to reach the recipient", () => byText(recipient2, "TOKEN:req2"));
    const refusedSteer = {
      expectsReply: correction.expectsReply !== false,
      status: correction.status,
      steerFallback: correction.steerFallback ?? null,
      refused: refuseCount() > refusalsBefore,
    };

    await control({ holdTurns: false, refuseSteer: true, releaseHeldTurns: true, turnMs: 400 });
    const answer = await waitFor("the correction's answer at its sender", () => {
      const rows = rowsWith(sender2, "DONE req2");
      return rows.length > 0 ? rows[0] : undefined;
    });
    await waitFor(
      "the answer's turn to end",
      () => mailbox.getDelivery(answer.id)?.delivery.status === "completed" || undefined,
    );
    const answers = rowsWith(sender2, "DONE req2");
    const requestTurn = mailbox.getDelivery(request.id)?.delivery.turnId ?? null;
    const correctionTurn = mailbox.getDelivery(correction.id)?.delivery.turnId ?? null;
    report.refusedSteer = { ...refusedSteer, requestDeliveryId: request.id };
    report.correctionAnswer = {
      count: answers.length,
      replyTo: answers[0]?.replyToMessageId ?? null,
      correctionMessageId: correction.messageId,
      text: answers[0]?.text ?? null,
      requestTurn,
      correctionTurn,
    };
    requireTrue(refusedSteer.refused, "the provider refused the steer");
    requireTrue(refusedSteer.expectsReply, "the correction asks for its own answer again");
    requireTrue(refusedSteer.status === "queued", "the correction waits for the next turn");
    requireTrue(refusedSteer.steerFallback === null, "a send with no explanation marks no reason");
    requireTrue(answers.length === 1, "the correction is answered once");
    requireTrue(answers[0]?.replyToMessageId === correction.messageId, "the answer replies to the correction");
    requireTrue(Boolean(requestTurn) && Boolean(correctionTurn) && requestTurn !== correctionTurn, "own turn");
    report.passedCase2 = true;
    process.stdout.write(`CASE2 ${JSON.stringify({ refusedSteer, requestTurn, correctionTurn })}\n`);
  }

  // Case 3: the queued correction survives a restart, and its drain answers the original sender.
  if (runCase(3)) {
    await control({ holdTurns: false, refuseSteer: true, releaseHeldTurns: false, turnMs: 400 });
    const recipient3 = await createAgent("Restart recipient");
    await runCauseEffect(store.updateAgent({ agentId: recipient3, busyMessageMode: "steer" }));
    const sender3 = await createAgent("Restart sender");
    await callTool(sender3, {
      recipientAgentIds: [recipient3],
      text: "REQUEST HOLD TOKEN:r1",
      expectsReply: true,
    });
    await waitFor("the restart request to reach the recipient", () => byText(recipient3, "TOKEN:r1"));
    await waitFor("the restart request to run at the recipient", () =>
      mailbox.getDelivery(byText(recipient3, "TOKEN:r1")?.id ?? "")?.delivery.status === "running" ? true : undefined,
    );
    await senderIdle(sender3);
    await runCauseEffect(agents.readConversation(recipient3));
    const restartRefusals = refuseCount();
    await callTool(sender3, { recipientAgentIds: [recipient3], text: "CORRECTION TOKEN:r2" });
    const correction3 = await waitFor("the restart correction to reach the recipient", () =>
      byText(recipient3, "TOKEN:r2"),
    );
    requireTrue(refuseCount() > restartRefusals, "the restart case refused the steer");
    requireTrue(correction3.expectsReply !== false, "the restart correction asks for its own answer");
    requireTrue(correction3.status === "queued", "the restart correction waits after the refusal");
    const beforeRestart = { status: correction3.status, expectsReply: correction3.expectsReply !== false };

    await stopInstance(instance);
    instance = await boot();
    agents = instance.agents;
    mailbox = instance.mailbox;
    store = instance.store;
    await control({ holdTurns: false, refuseSteer: false, releaseHeldTurns: false, turnMs: 400 });

    const restartAnswer = await waitFor("the correction's answer after the restart", () => {
      const rows = rowsWith(sender3, "DONE r2");
      return rows.length > 0 ? rows[0] : undefined;
    });
    await waitFor(
      "the answer's turn to end after the restart",
      () => mailbox.getDelivery(restartAnswer.id)?.delivery.status === "completed" || undefined,
    );
    const restartAnswers = rowsWith(sender3, "DONE r2");
    report.case3 = {
      beforeRestart,
      count: restartAnswers.length,
      replyTo: restartAnswers[0]?.replyToMessageId ?? null,
      correctionMessageId: correction3.messageId,
      status: restartAnswers[0]?.status ?? null,
    };
    requireTrue(restartAnswers.length === 1, "the restart answers the correction once");
    requireTrue(
      restartAnswers[0]?.replyToMessageId === correction3.messageId,
      "the restart answer replies to the correction",
    );
    requireTrue(restartAnswers[0]?.status === "completed", "the restart answer finished");
    report.passedCase3 = true;
    process.stdout.write(`CASE3 ${JSON.stringify(report.case3)}\n`);
  }

  // Case 4: a correction stored as an amendment that no steer reached. The service is killed while
  // its steer waits, so the restart has to restore the request itself.
  if (runCase(4)) {
    const crashRoot = join(root, "crash");
    mkdirSync(crashRoot, { recursive: true });
    const child = Bun.spawn({
      cmd: [process.execPath, import.meta.path],
      env: { ...process.env, STEER_E2E_CHILD: "1", STEER_E2E_CHILD_ROOT: crashRoot, STEER_E2E_ONLY: "4" },
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    });
    crashChild = child;
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let ready: { deliveryId: string; messageId: string; sender: string } | null = null;
    let buffered = "";
    const deadline = Date.now() + 60_000;
    // One read stays pending across the waits: a new read per tick would leave the old ones open and
    // let a later line go to a promise nobody awaits.
    let pending = reader.read();
    while (!ready && Date.now() < deadline) {
      const chunk = await Promise.race([pending, Bun.sleep(250).then(() => "wait" as const)]);
      if (chunk === "wait") continue;
      pending = reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      const line = buffered.split("\n").find((item) => item.startsWith("CHILD-READY "));
      if (line) ready = JSON.parse(line.slice("CHILD-READY ".length));
    }
    if (!ready) throw new Error(`The crash phase did not reach its ready line: ${buffered.slice(-400)}`);
    const killed = ready;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await child.exited;
    await Bun.sleep(300);

    // The crash left the amendment as it was: no answer expected, the amendment marker still set.
    const crashDatabase = new OpenBotDatabase(join(crashRoot, "user-data"));
    await runCauseEffect(crashDatabase.initialize());
    const raw = crashDatabase.connection
      .prepare("SELECT message_json FROM projection_mailbox_messages")
      .all()
      .map((row: { message_json?: unknown }) => String(row.message_json ?? ""))
      .find((json: string) => json.includes(killed.messageId));
    crashDatabase.close();
    const storedAmendment =
      Boolean(raw?.includes('"expectsReply":false')) && Boolean(raw?.includes('"amendsRequest":true'));

    await writeFile(join(crashRoot, "control.json"), JSON.stringify({ holdTurns: false, turnMs: 400 }));
    crashInstance = await boot(crashRoot);
    const crashMailbox = crashInstance.mailbox;
    const answer = await waitFor("the answer after the crash restart", () => {
      const rows = crashMailbox
        .listQueue(killed.sender)
        .deliveries.filter((row: QueueDelivery) => row.text.includes("DONE c2"));
      return rows.length > 0 ? rows[0] : undefined;
    });
    await waitFor("the crash answer to finish", () =>
      crashMailbox.getDelivery(answer.id)?.delivery.status === "completed" ? true : undefined,
    );
    const answers = crashMailbox
      .listQueue(killed.sender)
      .deliveries.filter((row: QueueDelivery) => row.text.includes("DONE c2"));
    const restoredRow = crashMailbox
      .listQueue(
        killed.deliveryId ? (crashMailbox.getDelivery(killed.deliveryId)?.delivery.recipientAgentId ?? "") : "",
      )
      .deliveries.find((row: QueueDelivery) => row.id === killed.deliveryId);
    report.case4 = {
      storedBeforeRestart: storedAmendment,
      count: answers.length,
      replyTo: answers[0]?.replyToMessageId ?? null,
      correctionMessageId: killed.messageId,
      status: answers[0]?.status ?? null,
      restored: restoredRow?.expectsReply !== false,
    };
    requireTrue(storedAmendment, "the crash left a stored amendment");
    requireTrue(answers.length === 1, "the crash restart answers once");
    requireTrue(answers[0]?.replyToMessageId === killed.messageId, "the crash answer replies to the correction");
    requireTrue(answers[0]?.status === "completed", "the crash answer finished");
    requireTrue(restoredRow?.expectsReply !== false, "the restart restored the request meaning");
    report.passedCase4 = true;
    mkdirSync(OUT, { recursive: true });
    cpSync(join(crashRoot, "protocol.jsonl"), join(OUT, "case4-protocol.jsonl"));
    await stopInstance(crashInstance);
    crashInstance = null;
    await Bun.spawn({ cmd: ["pkill", "-f", crashRoot], stdout: "ignore", stderr: "ignore" }).exited;
    process.stdout.write(`CASE4 ${JSON.stringify(report.case4)}\n`);
  }

  const ran = (number: number) =>
    !runCase(number) ||
    Boolean(
      { 1: report.routerCallWorked, 2: report.passedCase2, 3: report.passedCase3, 4: report.passedCase4 }[number],
    );
  report.passed = ran(1) && ran(2) && ran(3) && ran(4);
  requireTrue(report.passed, "every case passed");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  report.failure = failure;
  process.stderr.write(`FAIL ${failure}\n`);
} finally {
  if (crashChild) {
    try {
      process.kill(-crashChild.pid, "SIGKILL");
    } catch {
      crashChild.kill("SIGKILL");
    }
    crashChild = null;
  }
  if (crashInstance) {
    await stopInstance(crashInstance).catch(() => {});
    crashInstance = null;
  }
  await stopInstance(instance).catch(() => {});
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`report: ${join(OUT, "report.json")}\n`);
  process.exit(failure === null && report.passed === true ? 0 : 1);
}
