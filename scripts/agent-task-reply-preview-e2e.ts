// Checks that a reply of a task does not become the preview of the agent's row, and that a reply in
// the agent's own chat still does. A task's user message shows in the task's row, not in the agent's
// own chat (`sendMessage` skips the preview); the reply of that turn must follow the same rule, or
// the agent list names a message that the agent's own chat does not hold, on the phone and in the
// sidebar.
//
// Runs the real agent service on a temporary profile with one fake provider client, so the whole
// turn path runs (mailbox, drain, turn lifecycle, preview write) without a provider sign-in:
// `bun scripts/agent-task-reply-preview-e2e.ts`. Writes
// .openbot-build/agent-task-reply-preview-e2e/report.json.
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import type { AgentClient } from "../src/backend/agent-client";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { type AppServerNotification, getString, isRecord, type ResponseDecoder } from "../src/backend/protocol";
import { providerFailure, providerSync, requiredString } from "../src/backend/provider-client-effects";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-task-reply-preview-e2e");
/** Lower-case letters and digits only, so every encoding of it still contains it. */
const MARKER = `obe2e${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const CONTROL_MARKER = `obctl${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const OPENCODE_MODEL = "opencode/big-pickle";

interface ClientEvents {
  notification: [notification: AppServerNotification];
  exit: [error: Error];
}

/** The fake client answers every prompt with an echo of the prompt's last line. */
class FakeOpenCode extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "opencode";
  #running = false;
  #sessions = 0;

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
  }

  stop() {
    return Effect.sync(() => {
      this.#running = false;
    });
  }

  request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>) {
    switch (method) {
      case "initialize":
      case "turn/interrupt":
        return providerSync(() => decoder({}));
      case "account/read":
        return providerSync(() => decoder({ account: { type: "opencode" } }));
      case "account/rateLimits/read":
        return providerSync(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
      case "model/list":
        return providerSync(() => decoder({ data: [{ model: OPENCODE_MODEL, displayName: "Big Pickle" }] }));
      case "plugin/list":
        return providerSync(() => decoder({ marketplaces: [] }));
      case "thread/start":
        return providerSync(() => decoder({ thread: { id: `ses_e2e${++this.#sessions}` } }));
      case "thread/resume":
      case "thread/read":
        return providerSync(() => decoder({ thread: { id: requiredString(params, "threadId"), turns: [] } }));
      case "turn/start":
        return providerSync(() => {
          const threadId = requiredString(params, "threadId");
          const turnId = getString(params, "clientUserMessageId") ?? randomUUID();
          const prompt = (isRecord(params) && Array.isArray(params.input) ? params.input : [])
            .map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
            .join(" ");
          const lastLine =
            prompt
              .split("\n")
              .filter((line) => line.trim())
              .at(-1) ?? "";
          const reply = `Echo: ${lastLine.slice(-80)}`;
          this.emit("notification", {
            method: "turn/started",
            params: { threadId, turn: { id: turnId, status: "inProgress" } },
          });
          setTimeout(() => {
            const item = { type: "agentMessage", id: `${turnId}:assistant`, text: reply, phase: "final_answer" };
            this.emit("notification", { method: "item/completed", params: { threadId, turnId, item } });
            this.emit("notification", {
              method: "turn/completed",
              params: { threadId, turn: { id: turnId, status: "completed" } },
            });
          }, 25);
          return decoder({ turn: { id: turnId, status: "inProgress" } });
        });
      default:
        return Effect.fail(providerFailure(new Error(`The fake OpenCode does not implement ${method}.`)));
    }
  }

  notify(): void {}
  respond(): void {}
  respondError(): void {}
}

const root = await mkdtemp(join(tmpdir(), "openbot-task-reply-preview-"));
const userData = join(root, "user-data");
const home = join(root, "home");
mkdirSync(home, { recursive: true });
process.env.HOME = home;

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}
const report: { passed: boolean; checks: typeof checks; error?: string } = { passed: false, checks };

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

/** Waits for a state of the service. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "opencode",
  clientFactory: (provider) => {
    if (provider !== "opencode") throw new Error(`Not used: ${provider}`);
    return new FakeOpenCode();
  },
});

function agentNow(agentId: string): AgentSummary {
  const agent = store.list().find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} is gone.`);
  return agent;
}

function idle(agentId: string): boolean {
  return !agents
    .listQueue(agentId)
    .deliveries.some((delivery) => ["queued", "starting", "running"].includes(delivery.status));
}

async function createAgent(name: string, firstMessage: string) {
  const agent = await runCauseEffect(
    agents.createAgent({
      name,
      description: "Checks which message the row preview names.",
      avatarSeed: name.toLowerCase().replaceAll(" ", "-"),
      avatarHue: null,
      initialMessage: firstMessage,
      provider: "opencode",
      model: OPENCODE_MODEL,
    }),
  );
  await waitFor(`the first turn of ${name} to end`, () => idle(agent.id) && Boolean(agentNow(agent.id).threadId));
  return agent;
}

/** Sends one message to the agent's own chat and waits for its final state. */
async function send(agentId: string, text: string) {
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  if (!deliveryId) throw new Error("The message has no delivery.");
  return waitFor(`the message ${text.slice(0, 30)} to end`, () => {
    const status = mailbox.getDelivery(deliveryId)?.delivery.status;
    return status === "completed" || status === "failed" || status === "interrupted" ? status : null;
  });
}

try {
  await runCauseEffect(agents.initialize());

  const agent = await createAgent("Preview check", "First message.");
  const welcome = agentNow(agent.id).preview;
  check("1. the own-chat welcome lands in the row preview", welcome.includes("Echo:"), {
    preview: welcome.slice(0, 120),
  });

  // The task: its user message and the reply both name the marker, so every assertion reads the
  // exact reply text and the message author, never a marker search alone.
  const taskUserText = `Preview check ${MARKER}`;
  const expectedTaskReply = `Echo: ${taskUserText}`;
  const task = await runCauseEffect(
    agents.startTask({ agentId: agent.id, text: taskUserText, clientMessageId: randomUUID() }),
  );
  await waitFor("the task turn to end", () => {
    const row = agents.listTasks(agent.id).tasks.find((candidate) => candidate.id === task.id) ?? null;
    return row !== null && row.state !== "running" && row.state !== "queued" ? row : null;
  });

  const taskThread = agents.readTask(agent.id, task.id);
  const taskReply = taskThread.messages.find((message) => message.author === "assistant");
  check("2. the task thread holds the assistant reply", Boolean(taskReply), {
    authors: taskThread.messages.map((message) => message.author),
  });
  check("2. the task reply is the fake echo", taskReply?.text === expectedTaskReply, {
    reply: taskReply?.text.slice(0, 120) ?? null,
    expected: expectedTaskReply,
  });
  const ownChat = await runCauseEffect(agents.readConversationFor(agent.id, "local"));
  const userInOwnChat = ownChat.messages.some(
    (message) => message.author === "user" && message.text?.includes(taskUserText),
  );
  check("2. the task message is not in the agent's own chat", !userInOwnChat, {});

  const taskRow = agents.listTasks(agent.id).tasks.find((candidate) => candidate.id === task.id) ?? null;
  check("2. the task turn completed", taskRow?.outcome === "completed", { taskRow });
  const previewAfterTask = agentNow(agent.id).preview;
  check(
    "3. the row preview does not name the task reply",
    previewAfterTask !== expectedTaskReply && !previewAfterTask.includes(MARKER),
    { preview: previewAfterTask.slice(0, 160) },
  );

  // The control: a reply in the agent's own chat still updates the row preview.
  const controlText = `Control message ${CONTROL_MARKER}`;
  const expectedControlReply = `Echo: ${controlText}`;
  await send(agent.id, controlText);
  const previewAfterControl = agentNow(agent.id).preview;
  check("4. the own-chat reply updates the row preview", previewAfterControl === expectedControlReply, {
    preview: previewAfterControl.slice(0, 120),
    expected: expectedControlReply,
  });

  report.passed = checks.every((entry) => entry.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  for (const entry of checks) process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
