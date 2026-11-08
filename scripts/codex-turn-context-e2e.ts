// Runs the real `codex app-server` against a fake Responses server, to check that a Codex agent gets
// its saved memories, section-mates and saved-logins rule with the user turns, and that a memory
// change keeps the cached prompt prefix and the Codex session. A login saved after the session start
// comes with that change, so the turn after it must carry the saved-logins rule. A local server
// stands in for the model and records each request, so no account or key is used. The fake model
// reports no real token counts, so the report estimates them from the request text (4 characters a
// token). The cacheable part of a request is the part before its first difference from the request
// before it, with the same `prompt_cache_key`.
//
// Two variants, with the same agent, memories and turns:
// - `before`: the memories and the section-mates are in the developer instructions, as before this
//   change. Codex ignores the instructions of `thread/resume`, so a changed memory reaches the model
//   only in a new session.
// - `after`: they go with the turns. The changed memory goes as a small block in the resumed session.
// The `after` variant then restarts the app-server (no new blocks) and the client (one full block
// again), and reads the history back (no blocks in the user messages).
// `bun scripts/codex-turn-context-e2e.ts`. Writes .openbot-build/codex-turn-context-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentMemory, type AgentSummary, DEFAULT_AGENT_DEFAULTS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import {
  developerInstructions,
  isTurnContextBlock,
  memoryContext,
  type SectionTeammates,
} from "../src/backend/agent/developer-instructions";
import { CODEX_FEATURES_CONFIG } from "../src/backend/agent/thread-lifecycle";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { resolveCodexCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { decodeRecordResponse, getRecord, getString } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/codex-turn-context-e2e");
const NL = String.fromCharCode(10);
const DEADLINE_MS = 60_000;
const MEMORY_FULL = "<openbot_saved_memories>";
const MEMORY_UPDATE = "<openbot_saved_memories_update>";
const TEAMMATES = "<openbot_section_teammates>";
const SAVED_LOGINS = "<openbot_saved_logins>";
/** Text of the saved-logins rule only. */
const LOGIN_RULE = "before request_takeover for a signed-out site, call openbot_browser.list_logins";
const CHANGED_MARKER = "MARKER-CHANGED-MEMORY";

interface ResponsesRequest {
  instructions?: string;
  tools?: unknown[];
  input?: Array<{ role?: string; content?: Array<{ text?: string }> }>;
  prompt_cache_key?: string;
}

interface OutputItem {
  type: "message";
  role: "assistant";
  id: string;
  content: Array<{ type: "output_text"; text: string }>;
}

interface StreamEvent {
  type: string;
  output_index?: number;
  item?: OutputItem;
  response?: { id: string; status: string; output?: OutputItem[]; usage?: Record<string, number> };
}

interface Recorded {
  /** The prompt in model order: tools, instructions, then the conversation. */
  prompt: string;
  cacheKey: string | undefined;
  /** The text of each user message part. */
  userTexts: string[];
}

interface Step {
  step: string;
  threadId: string;
  newSession: boolean;
  promptBytes: number;
  estimatedInputTokens: number;
  estimatedCachedTokens: number;
  changedMemoryReachedModel: boolean;
  loginRuleReachedModel: boolean;
  savedLoginBlocks: number;
  fullMemoryBlocks: number;
  memoryUpdateBlocks: number;
  teammateBlocks: number;
}

function startFakeModel() {
  const requests: Recorded[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed: ResponsesRequest = JSON.parse(body || "{}");
      requests.push({
        prompt: JSON.stringify([parsed.tools ?? [], parsed.instructions ?? "", parsed.input ?? []]),
        cacheKey: parsed.prompt_cache_key,
        userTexts: (parsed.input ?? [])
          .filter((item) => item.role === "user")
          .flatMap((item) => (item.content ?? []).map((part) => part.text ?? "")),
      });
      const item: OutputItem = {
        type: "message",
        role: "assistant",
        id: "m",
        content: [{ type: "output_text", text: "done" }],
      };
      const send = (event: StreamEvent) =>
        response.write(`event: ${event.type}${NL}data: ${JSON.stringify(event)}${NL}${NL}`);
      response.writeHead(200, { "content-type": "text/event-stream" });
      send({ type: "response.created", response: { id: "r", status: "in_progress" } });
      send({ type: "response.output_item.done", output_index: 0, item });
      send({
        type: "response.completed",
        response: {
          id: "r",
          status: "completed",
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      });
      response.end();
    });
  });
  return listen(server).then((listening) => ({ requests, ...listening }));
}

async function listen(server: HttpServer) {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    port: address.port,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

function deadline(what: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`No answer for ${what} in ${DEADLINE_MS} ms.`)), DEADLINE_MS).unref();
  });
}

function sharedPrefix(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let index = 0;
  while (index < length && a.charCodeAt(index) === b.charCodeAt(index)) index += 1;
  return index;
}

function count(texts: string[], start: string): number {
  return texts.filter((text) => text.startsWith(`${start}${NL}`)).length;
}

const agent: AgentSummary = {
  id: "agent-1",
  name: "Tester",
  title: "Researcher",
  description: "Finds and checks facts.",
  notifications: false,
  provider: "codex",
  model: "fake-model",
  reasoningEffort: "medium",
  threadId: null,
  workspacePath: "/workspace",
  preview: "",
  updatedAt: null,
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarUrl: null,
};

function memory(index: number, text: string): AgentMemory {
  return {
    id: `memory-${index}`,
    agentId: agent.id,
    text,
    origin: "manual",
    sourceTurnId: null,
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
  };
}

const MEMORIES = Array.from({ length: 12 }, (_, index) =>
  memory(index, `Fact ${index}: the user prefers short answers about topic ${index}, with sources and dates.`),
);
const CHANGED_MEMORIES = [...MEMORIES, memory(99, `${CHANGED_MARKER}: the user moved the weekly review to Friday.`)];
const SECTION: SectionTeammates = {
  name: "Research",
  members: [
    { id: "agent-2", name: "Ada", title: "Writer" },
    { id: "agent-3", name: "Linus", title: "Reviewer" },
  ],
};

/** The params that `ThreadLifecycle.#instructions` gives, for these memories. */
function instructionParams(memories: AgentMemory[], inTurns: boolean, savedLogins = false) {
  const options = {
    computerUseInOwnChat: false,
    sideThread: false,
    passwordVault: savedLogins,
    storedMemoryCount: memories.length,
    memoriesInTurns: inTurns,
    teammatesInTurns: inTurns,
    savedLoginsInTurns: inTurns,
    sectionTeammates: SECTION,
    homeSkills: [],
  };
  const instructions = developerInstructions(
    agent,
    "/shared",
    memories,
    "/automation",
    DEFAULT_AGENT_DEFAULTS,
    options,
  );
  return inTurns
    ? {
        developerInstructions: instructions,
        memoryContext: memoryContext(memories, options),
        sectionTeammates: SECTION,
        savedLogins,
      }
    : { developerInstructions: instructions };
}

type FakeModel = Awaited<ReturnType<typeof startFakeModel>>;
type InstructionParams = ReturnType<typeof instructionParams>;

class Session {
  client: CodexAppServerClient;
  readonly steps: Step[] = [];
  #turnDone: (() => void) | null = null;
  #last: Recorded | null = null;
  #threadId = "";

  constructor(
    private readonly executable: string,
    private readonly home: string,
    private readonly model: FakeModel,
  ) {
    this.client = this.#newClient();
  }

  #newClient(): CodexAppServerClient {
    const client = new CodexAppServerClient(this.executable, 30_000, { CODEX_HOME: this.home, FAKE_KEY: "e2e" });
    client.on("notification", (notification) => {
      if (notification.method === "turn/completed") this.#turnDone?.();
    });
    return client;
  }

  async open(): Promise<void> {
    this.client.start();
    await runCauseEffect(
      this.client.request(
        "initialize",
        { clientInfo: { name: "openbot_e2e", title: "OpenBot E2E", version: "0.0.0" }, capabilities: {} },
        decodeRecordResponse,
      ),
    );
    this.client.notify("initialized");
  }

  /** Stops the app-server and starts it again, with the same client. */
  async restartAppServer(): Promise<void> {
    await runCauseEffect(this.client.stop());
    await this.open();
  }

  /** A new client, as after an OpenBot restart. */
  async restartClient(): Promise<void> {
    await runCauseEffect(this.client.stop());
    this.client = this.#newClient();
    await this.open();
  }

  async start(params: InstructionParams): Promise<void> {
    const started = await runCauseEffect(
      this.client.request(
        "thread/start",
        {
          cwd: this.home,
          approvalPolicy: "on-request",
          sandbox: "danger-full-access",
          model: "fake-model",
          config: CODEX_FEATURES_CONFIG,
          ...params,
        },
        decodeRecordResponse,
      ),
    );
    const threadId = getString(getRecord(started, "thread"), "id");
    assert(threadId, "thread/start returned no thread id");
    this.#threadId = threadId;
  }

  async resume(params: InstructionParams): Promise<void> {
    await runCauseEffect(
      this.client.request(
        "thread/resume",
        {
          threadId: this.#threadId,
          cwd: this.home,
          approvalPolicy: "on-request",
          sandbox: "danger-full-access",
          model: "fake-model",
          config: CODEX_FEATURES_CONFIG,
          ...params,
        },
        decodeRecordResponse,
      ),
    );
  }

  get threadId(): string {
    return this.#threadId;
  }

  async turn(step: string, text: string): Promise<Step> {
    const first = this.model.requests.length;
    const done = new Promise<void>((resolveTurn) => {
      this.#turnDone = resolveTurn;
    });
    await runCauseEffect(
      this.client.request(
        "turn/start",
        { threadId: this.#threadId, input: [{ type: "text", text }] },
        decodeRecordResponse,
      ),
    );
    await Promise.race([done, deadline(step)]);
    const requests = this.model.requests.slice(first);
    assert.equal(requests.length, 1, `${step}: Codex sent ${requests.length} model requests.`);
    const [request] = requests;
    assert(request);
    const previous = this.#last;
    const sameKey = previous !== null && previous.cacheKey === request.cacheKey;
    const cached = sameKey && previous ? sharedPrefix(previous.prompt, request.prompt) : 0;
    const result: Step = {
      step,
      threadId: this.#threadId,
      newSession: previous !== null && !sameKey,
      promptBytes: request.prompt.length,
      estimatedInputTokens: Math.ceil(request.prompt.length / 4),
      estimatedCachedTokens: Math.floor(cached / 4),
      changedMemoryReachedModel: request.prompt.includes(CHANGED_MARKER),
      loginRuleReachedModel: request.prompt.includes(LOGIN_RULE),
      savedLoginBlocks: count(request.userTexts, SAVED_LOGINS),
      fullMemoryBlocks: count(request.userTexts, MEMORY_FULL),
      memoryUpdateBlocks: count(request.userTexts, MEMORY_UPDATE),
      teammateBlocks: count(request.userTexts, TEAMMATES),
    };
    this.#last = request;
    this.steps.push(result);
    return result;
  }

  /** The user message texts of the thread, as the OpenBot history import reads them. */
  async historyUserTexts(): Promise<string[]> {
    const texts: string[] = [];
    await runCauseEffect(
      this.client.readHistory({ threadId: this.#threadId, items: "full" }, (fragment) =>
        Effect.sync(() => {
          for (const item of fragment.items)
            if (item.type === "userMessage")
              for (const part of item.content ?? []) if (part.type === "text" && part.text) texts.push(part.text);
          return true;
        }),
      ),
    );
    return texts;
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const cli = await runCauseEffect(resolveCodexCli());
const model = await startFakeModel();
const root = await mkdtemp(join(tmpdir(), "openbot-codex-turn-context-e2e-"));
const report: {
  passed: boolean;
  codexVersion: string;
  note: string;
  before?: Step[];
  after?: Step[];
  historyUserTexts?: string[];
  error?: string;
} = {
  passed: false,
  codexVersion: cli.version,
  note: "Token counts are estimates: prompt characters / 4. Cached = shared prefix with the previous request of the same prompt_cache_key.",
};
const sessions: Session[] = [];
try {
  for (const [index, name] of (["before", "after"] as const).entries()) {
    const home = join(root, String(index));
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, "config.toml"),
      [
        'model = "fake-model"',
        'model_provider = "fake"',
        "[model_providers.fake]",
        'name = "fake"',
        `base_url = "http://127.0.0.1:${model.port}/v1"`,
        'env_key = "FAKE_KEY"',
        'wire_api = "responses"',
        "",
      ].join(NL),
    );
    const session = new Session(cli.executable, home, model);
    sessions.push(session);
    const inTurns = name === "after";
    await session.open();
    await session.start(instructionParams(MEMORIES, inTurns));
    await session.turn("turn 1", "What is on my list today?");
    await session.turn("turn 2", "And tomorrow?");
    // A memory change unloads the session (`ConversationRuntime.unloadAgentThreads`), and the next
    // turn resumes it with the current instructions. The user saved a login in the Vault too, which
    // also resumes the session (`ThreadLifecycle.#turnContextChanged`).
    await session.resume(instructionParams(CHANGED_MEMORIES, inTurns, true));
    await session.turn("turn 3, after a memory change", "When is the weekly review?");
    if (name === "before") {
      // Codex ignored the new instructions; only a new session gives the model the changed memory.
      await session.start(instructionParams(CHANGED_MEMORIES, false, true));
      await session.turn("turn 4, in a new session", "When is the weekly review?");
      report.before = session.steps;
      continue;
    }
    await session.restartAppServer();
    await session.resume(instructionParams(CHANGED_MEMORIES, true, true));
    await session.turn("turn 4, after an app-server restart", "Thanks.");
    report.historyUserTexts = await session.historyUserTexts();
    await session.restartClient();
    await session.resume(instructionParams(CHANGED_MEMORIES, true, true));
    await session.turn("turn 5, after an OpenBot restart", "One more thing.");
    report.after = session.steps;
  }

  const before = report.before ?? [];
  const after = report.after ?? [];
  const [b1, b2, b3, b4] = before;
  const [a1, a2, a3, a4, a5] = after;
  assert(b1 && b2 && b3 && b4 && a1 && a2 && a3 && a4 && a5, "A step is missing.");
  assert.equal(b3.changedMemoryReachedModel, false, "Codex now reads the instructions of thread/resume.");
  assert.equal(b4.newSession, true, "The new session kept the prompt cache key.");
  assert.equal(b4.changedMemoryReachedModel, true);
  assert.equal(b3.loginRuleReachedModel, false, "Codex now reads the saved-logins rule of thread/resume.");
  assert.equal(b4.loginRuleReachedModel, true);

  assert.equal(a1.fullMemoryBlocks, 1, "The first turn has no full memory block.");
  assert.equal(a1.teammateBlocks, 1, "The first turn has no section-mates block.");
  assert.equal(a2.fullMemoryBlocks + a2.memoryUpdateBlocks + a2.teammateBlocks, 1 + 0 + 1, "Turn 2 added blocks.");
  assert.equal(a3.changedMemoryReachedModel, true, "The changed memory did not reach the model.");
  assert.equal(a3.newSession, false, "A memory change started a new session.");
  assert.equal(a3.memoryUpdateBlocks, 1, "The memory change sent no update block.");
  assert.equal(a3.teammateBlocks, 1, "The unchanged section-mates were sent again.");
  assert.equal(a1.loginRuleReachedModel, false, "The saved-logins rule went to a session with no saved login.");
  assert.equal(a2.savedLoginBlocks, 0, "Turn 2 sent a saved-logins block.");
  assert.equal(a3.loginRuleReachedModel, true, "A login saved after the session start did not reach the model.");
  assert.equal(a3.savedLoginBlocks, 1, "The saved login sent no saved-logins block, or more than one.");
  // All of turn 2 but the closing brackets of the prompt.
  assert.ok(a3.estimatedCachedTokens >= Math.floor((a2.promptBytes - 2) / 4), "Turn 3 lost the cached prefix.");
  assert.equal(a4.memoryUpdateBlocks + a4.fullMemoryBlocks + a4.teammateBlocks, 1 + 1 + 1, "Turn 4 added blocks.");
  assert.equal(a4.savedLoginBlocks, 1, "The app-server restart sent the saved-logins block again.");
  assert.equal(a4.newSession, false);
  assert.ok(
    a4.estimatedCachedTokens >= Math.floor((a3.promptBytes - 2) / 4),
    "The app-server restart lost the prefix.",
  );
  // A new client has no record of what the thread holds: one full block, the same as Claude.
  assert.equal(a5.fullMemoryBlocks, 2, "An OpenBot restart sent no full memory block, or more than one.");
  assert.equal(a5.teammateBlocks, 2, "An OpenBot restart sent no section-mates block, or more than one.");
  assert.equal(a5.savedLoginBlocks, 2, "An OpenBot restart sent no saved-logins block, or more than one.");
  assert.equal(a5.newSession, false);
  const history = report.historyUserTexts ?? [];
  assert.ok(history.length >= 4, "The history import read no user messages.");
  assert.ok(!history.some(isTurnContextBlock), "The history import shows a context block as user text.");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  for (const session of sessions) await runCauseEffect(session.client.stop()).catch(() => undefined);
  await model.close();
  await rm(root, { recursive: true, force: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}${NL}`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${join(OUT, "report.json")}${NL}`);
}
