import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcpAgentClient, type AcpHistoryPersistence } from "./acp-client";
import { runCauseEffect } from "./effect-boundary";
import {
  type AppServerNotification,
  decodeRecordResponse,
  decodeThreadResponse,
  decodeTurnResponse,
  type ThreadItem,
} from "./protocol";
import { providerCall } from "./provider-client-effects";
import type { ProviderHistoryFragment } from "./provider-history";

let root: string;
let client: AcpAgentClient;
let events: AppServerNotification[];
let saved: ProviderHistoryFragment[];

// The official 1.3.0 stream waits for STATE_FULLY_IDLE. This process leaves its prompt
// pending while a 120-second task is active, and ignores cancel as the reported failure does.
// session/resume replaces the harness in the same provider session.
const AGENT = `
const fs = require("node:fs");
const readline = require("node:readline");
const logPath = process.argv[2];
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + "\\n");
let pending = null;
let resumed = false;
let failedResume = false;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  const { id, method, params } = request;
  fs.appendFileSync(logPath, JSON.stringify({ method, params }) + "\\n");
  const reply = (result) => send({ id, result });
  const update = (update) => send({ method: "session/update", params: { sessionId: params.sessionId, update } });
  const text = (text) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
  if (method === "initialize") return reply({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } });
  if (method === "session/new") return reply({ sessionId: "timer-session" });
  if (method === "session/resume") {
    if (fs.existsSync(logPath + ".fail-once") && !failedResume) {
      failedResume = true;
      return send({ id, error: { code: -32603, message: "Session restore failed" } });
    }
    resumed = true;
    if (pending !== null) {
      send({ id: pending, result: { stopReason: "end_turn" } });
      pending = null;
    }
    return reply({});
  }
  if (method === "session/cancel") return;
  if (method === "session/prompt") {
    const input = params.prompt.map((part) => part.text || "").join("");
    if (input === "timer") {
      pending = id;
      update({ sessionUpdate: "tool_call", toolCallId: "timer", title: "schedule", status: "in_progress", rawInput: { seconds: 120 } });
      text("The 120-second timer has started.");
      update({ sessionUpdate: "usage_update", used: 100, size: 10000 });
      return;
    }
    if (input === "classify") {
      text("I will read the file.");
      update({ sessionUpdate: "tool_call", toolCallId: "read", title: "read_file", status: "completed" });
      text("The file is ready.");
      return reply({ stopReason: "end_turn" });
    }
    if (!resumed) return send({ id, error: { code: -32603, message: "A foreground turn is already active" } });
    text("Reply in the same session.");
    return reply({ stopReason: "end_turn" });
  }
  if (id !== undefined) reply({});
});
`;

function createClient(provider: "antigravity" | "opencode" = "antigravity"): AcpAgentClient {
  const history: AcpHistoryPersistence = {
    complete: () => Effect.succeed(true),
    read: (_request, consume) =>
      Effect.gen(function* () {
        for (const fragment of saved) if (!(yield* consume(fragment))) return;
      }),
    append: (_threadId, fragment) =>
      providerCall(async () => {
        saved.push(fragment);
        await writeFile(join(root, "history.json"), JSON.stringify(saved));
      }),
  };
  const current = new AcpAgentClient({ executable: process.execPath, version: "1.3.0" }, 5_000, {
    provider,
    argv: [join(root, "agent.cjs"), join(root, "requests.jsonl")],
    env: {},
    allowNoModels: true,
    signInMessage: "Authentication required",
    history,
  });
  current.on("notification", (event) => events.push(event));
  current.start();
  return current;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-antigravity-"));
  await writeFile(join(root, "agent.cjs"), AGENT);
  events = [];
  saved = [];
  client = createClient();
});

afterEach(async () => {
  await runCauseEffect(client.stop());
  await rm(root, { recursive: true, force: true });
});

async function start(text: string) {
  const { thread } = await runCauseEffect(client.request("thread/start", { cwd: root }, decodeThreadResponse));
  const { turn } = await runCauseEffect(
    client.request("turn/start", { threadId: thread.id, input: [{ type: "text", text }] }, decodeTurnResponse),
  );
  return { threadId: thread.id, turnId: turn.id };
}

const hasDelta = () => events.some((event) => event.method === "item/agentMessage/delta");
const completions = () => events.filter((event) => event.method === "turn/completed");

describe("Antigravity background task recovery", () => {
  it("streams the answer while a 120-second timer holds the prompt open", async () => {
    const ids = await start("timer");
    await vi.waitFor(() => expect(hasDelta()).toBe(true));
    expect(events).toContainEqual({
      method: "item/agentMessage/delta",
      params: { ...ids, itemId: `${ids.turnId}:assistant`, delta: "The 120-second timer has started." },
    });
    // Neither text nor usage proves that the provider has finished its turn.
    expect(completions()).toEqual([]);
    await runCauseEffect(client.request("turn/interrupt", ids, decodeRecordResponse));
    expect(completions()).toEqual([
      { method: "turn/completed", params: { threadId: ids.threadId, turn: { id: ids.turnId, status: "interrupted" } } },
    ]);
    expect(saved[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "timer", status: "interrupted", arguments: { seconds: 120 } }),
        expect.objectContaining({ phase: "final_answer", text: "The 120-second timer has started." }),
      ]),
    );

    await runCauseEffect(
      client.request(
        "turn/start",
        { threadId: ids.threadId, input: [{ type: "text", text: "next" }] },
        decodeTurnResponse,
      ),
    );
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect(saved[1]).toMatchObject({
      status: "completed",
      items: [expect.objectContaining({ text: "Reply in the same session." })],
    });
    const requests = (await readFile(join(root, "requests.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(requests).toContainEqual({ method: "session/cancel", params: { sessionId: ids.threadId } });
    expect(requests).toContainEqual(
      expect.objectContaining({
        method: "session/resume",
        params: expect.objectContaining({ sessionId: ids.threadId, cwd: root }),
      }),
    );

    await runCauseEffect(client.stop());
    expect(JSON.parse(await readFile(join(root, "history.json"), "utf8"))).toEqual(saved);
    client = createClient();
    const items: ThreadItem[] = [];
    await runCauseEffect(
      client.readHistory({ threadId: ids.threadId, items: "full" }, (fragment) =>
        Effect.sync(() => {
          items.push(...fragment.items);
          return true;
        }),
      ),
    );
    expect(items.find((item) => item.id === "timer")?.status).toBe("interrupted");
    expect(items.filter((item) => item.phase === "final_answer").map((item) => item.text)).toEqual([
      "The 120-second timer has started.",
      "Reply in the same session.",
    ]);
  });

  it("does not stop the current turn for an old Stop request", async () => {
    const ids = await start("timer");
    await vi.waitFor(() => expect(hasDelta()).toBe(true));
    await runCauseEffect(client.request("turn/interrupt", { ...ids, turnId: "old-turn" }, decodeRecordResponse));
    expect(completions()).toEqual([]);
    await runCauseEffect(client.request("turn/interrupt", ids, decodeRecordResponse));
    expect(completions()).toHaveLength(1);
  });

  it("keeps the same session available when its first recovery fails", async () => {
    const ids = await start("timer");
    await vi.waitFor(() => expect(hasDelta()).toBe(true));
    await runCauseEffect(client.request("turn/interrupt", ids, decodeRecordResponse));
    await writeFile(join(root, "requests.jsonl.fail-once"), "");
    const next = () =>
      runCauseEffect(
        client.request(
          "turn/start",
          { threadId: ids.threadId, input: [{ type: "text", text: "next" }] },
          decodeTurnResponse,
        ),
      );
    await expect(next()).rejects.toThrow("Session restore failed");
    expect(completions()).toHaveLength(1);
    await next();
    await vi.waitFor(() => expect(completions()).toHaveLength(2));
    expect(saved[1]?.items).toContainEqual(expect.objectContaining({ text: "Reply in the same session." }));
  });

  it("reclassifies streamed narration when a tool follows it", async () => {
    await start("classify");
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect(saved[0]?.items.filter((item) => item.type === "agentMessage")).toEqual([
      expect.objectContaining({ phase: "commentary", text: "I will read the file." }),
      expect.objectContaining({ phase: "final_answer", text: "The file is ready." }),
    ]);
  });

  it("keeps the existing text buffering for other ACP providers", async () => {
    await runCauseEffect(client.stop());
    client = createClient("opencode");
    await start("classify");
    await vi.waitFor(() => expect(completions()).toHaveLength(1));
    expect(hasDelta()).toBe(false);
    expect(saved[0]?.status).toBe("completed");
  });
});
