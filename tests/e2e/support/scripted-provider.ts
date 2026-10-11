#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { watch } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { redactText } from "@openbot/logging";
import { z } from "zod";
import { scenarioSchema } from "./scenario";

// A real provider subprocess. Model decisions are scripted; tools use real app and MCP endpoints.
const request = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.json()).default({}),
  result: z.json().optional(),
  error: z.json().optional(),
});
type Json = z.infer<ReturnType<typeof z.json>>;
const state = z.object({
  id: z.string(),
  cwd: z.string(),
  assignedTasks: z.array(z.string()).default([]),
  turns: z.array(z.object({ id: z.string(), status: z.string(), items: z.array(z.json()) })),
});
const threads = new Map<string, z.infer<typeof state>>();
// Provider launch configuration can contain credentials. Keep it out of saved thread fixtures.
const mcpByThread = new Map<string, Record<string, Json>>();
const mcpConfig = z.object({ mcp_servers: z.record(z.string(), z.json()).default({}) });
const pending = new Map<string, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
const interrupted = new Set<string>();
const holds = new Map<string, AbortController>();
const stateRoot = process.env.OPENBOT_E2E_PROTOCOL_STATE ?? "";
const send = (value: Json) => process.stdout.write(`${JSON.stringify(value)}\n`);

function thread(id: string) {
  const cached = threads.get(id);
  if (cached) return cached;
  const loaded = state.parse(JSON.parse(readFileSync(join(stateRoot, `${basename(id)}.json`), "utf8")));
  threads.set(id, loaded);
  return loaded;
}
function save(id: string) {
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(join(stateRoot, `${basename(id)}.json`), JSON.stringify(thread(id)), { mode: 0o600 });
}
function call(method: string, params: Record<string, Json>): Promise<Json> {
  const id = randomUUID();
  return new Promise((resolveCall, reject) => {
    pending.set(id, { resolve: resolveCall, reject });
    send({ id, method, params });
  });
}
function resolveArgs(value: Json, saved: Map<string, Json>): Json {
  if (typeof value === "string" && value.startsWith("$result:")) {
    const [key = "", ...path] = value.slice(8).split(".");
    let current = saved.get(key);
    for (const part of path)
      current = Array.isArray(current) ? current[Number(part)] : z.record(z.string(), z.json()).parse(current)[part];
    if (current === undefined) throw new Error(`Missing tool result ${value}`);
    return current;
  }
  if (Array.isArray(value)) return value.map((item) => resolveArgs(item, saved));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveArgs(item, saved)]));
  }
  return value;
}
function toolValue(value: Json, name: string): Json {
  const result = z
    .object({ success: z.boolean(), contentItems: z.array(z.object({ text: z.string().optional() })) })
    .parse(value);
  const text = result.contentItems.flatMap((item) => (item.text ? [item.text] : [])).join("\n");
  if (!result.success) throw new Error(`Tool ${name} failed: ${text}`);
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    return text;
  }
}
async function run(threadId: string, turnId: string, text: string, uploads: { name: string; path: string }[]) {
  const current = thread(threadId);
  const base = { threadId, turnId };
  const itemId = randomUUID();
  const turn = current.turns.find((entry) => entry.id === turnId);
  if (!turn) throw new Error("Turn missing.");
  send({ method: "item/agentMessage/delta", params: { ...base, itemId, delta: "Working on the test task." } });
  try {
    const assignment = text.split("Current assignment:\n").at(-1) ?? text;
    // A refreshed provider session can include earlier chat messages before the current input.
    const marker = [...assignment.matchAll(/E2E_SCENARIO:([A-Za-z0-9+/=]+)/gu)].at(-1)?.[1];
    let scenario = marker
      ? scenarioSchema.parse(JSON.parse(Buffer.from(marker, "base64").toString("utf8")))
      : scenarioSchema.parse({ reply: "Task received." });
    if (text.startsWith("Select one responsible channel member.")) {
      const routing = z
        .object({ members: z.array(z.object({ agentId: z.string() })).min(1) })
        .parse(JSON.parse(text.split("\n").at(-1) ?? "{}"));
      scenario = scenarioSchema.parse({ reply: JSON.stringify({ agentId: routing.members[0]?.agentId }) });
    }
    const saved = new Map<string, Json>();
    const channel = text.split("\n").find((line) => line.startsWith('{"channel":'));
    if (channel) {
      const context = z
        .object({ task: z.object({ id: z.string() }) })
        .passthrough()
        .parse(JSON.parse(channel));
      saved.set("context", z.json().parse(JSON.parse(channel)));
      if (scenario.steps.some((step) => step.kind === "tool" && step.name === "channel_assign")) {
        if (current.assignedTasks.includes(context.task.id)) {
          scenario = scenarioSchema.parse({
            steps: [{ kind: "tool", name: "channel_result", args: { text: "Group results received" } }],
            reply: "Group complete",
          });
        } else {
          current.assignedTasks.push(context.task.id);
          save(threadId);
        }
      }
    }
    for (const step of scenario.steps) {
      if (interrupted.has(turnId)) return;
      if (step.kind === "tool") {
        const value = toolValue(
          await call("item/tool/call", {
            ...base,
            callId: randomUUID(),
            namespace: step.namespace,
            tool: step.name,
            arguments: resolveArgs(step.args, saved),
          }),
          step.name,
        );
        if (step.save) saved.set(step.save, value);
      } else if (step.kind === "mcp") {
        const config = z
          .object({
            enabled: z.boolean().default(true),
            url: z.string().optional(),
            http_headers: z.record(z.string(), z.string()).default({}),
            command: z.string().optional(),
            args: z.array(z.string()).default([]),
            env: z.record(z.string(), z.string()).default({}),
          })
          .optional()
          .parse(mcpByThread.get(threadId)?.[step.server]);
        if (!config?.enabled) saved.set(step.save, `MCP unavailable: ${step.value}`);
        else {
          const client = new Client({ name: "release-provider", version: "1.0.0" });
          try {
            const transport = config.url
              ? new StreamableHTTPClientTransport(new URL(config.url), {
                  requestInit: { headers: config.http_headers },
                })
              : new StdioClientTransport({
                  command: z.string().parse(config.command),
                  args: config.args,
                  env: config.env,
                  stderr: "ignore",
                });
            await client.connect(transport);
            const result = await client.callTool({ name: "record", arguments: { value: step.value } });
            const content = z
              .object({
                isError: z.boolean().optional(),
                content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
              })
              .parse(result);
            if (content.isError) throw new Error("The custom MCP tool failed.");
            saved.set(step.save, content.content.map((item) => item.text).join("\n"));
          } finally {
            await client.close();
          }
        }
      } else if (step.kind === "write") {
        const path = resolve(current.cwd, step.name);
        if (!path.startsWith(`${resolve(current.cwd)}${sep}`)) throw new Error("Fixture file leaves the workspace.");
        if (step.append) appendFileSync(path, Buffer.from(step.base64, "base64"));
        else writeFileSync(path, Buffer.from(step.base64, "base64"));
      } else if (step.kind === "read-upload") {
        const upload = uploads.find((item) => item.name === step.name);
        if (!upload) throw new Error(`The provider did not receive attachment ${step.name}.`);
        saved.set(step.save, readFileSync(upload.path, "utf8"));
      } else if (step.kind === "hold") {
        const path = join(stateRoot, basename(step.key));
        const abort = new AbortController();
        holds.set(turnId, abort);
        const events = watch(stateRoot, { signal: abort.signal });
        try {
          if (!existsSync(path))
            for await (const event of events) {
              if (event.filename === basename(path) && existsSync(path)) break;
            }
        } finally {
          abort.abort();
          holds.delete(turnId);
        }
      } else if (step.kind === "approval") {
        const value = await call("item/commandExecution/requestApproval", {
          ...base,
          itemId: randomUUID(),
          command: step.receipt ? `Write the test receipt ${step.receipt}` : "printf release-test",
          cwd: current.cwd,
          reason: "Run the release test command.",
        });
        saved.set("decision", value);
        const decision = z.object({ decision: z.string() }).parse(value);
        if (step.receipt && decision.decision === "accept") {
          // The fixture is the CLI executor. This real file effect happens only after the app's decision.
          appendFileSync(join(current.cwd, basename(step.receipt)), "approved\n");
        }
      } else if (step.kind === "question") {
        saved.set(
          "answer",
          await call("item/tool/requestUserInput", {
            ...base,
            itemId: randomUUID(),
            questions: [
              {
                id: "colour",
                header: "Colour",
                question: "Choose the report colour.",
                options: [
                  { label: "Blue", description: "Use blue." },
                  { label: "Green", description: "Use green." },
                ],
              },
            ],
          }),
        );
      } else if (step.kind === "fail") throw new Error(step.message);
      else if (step.kind === "crash") process.exit(73);
    }
    if (interrupted.has(turnId)) return;
    const reply = `${resolveArgs(scenario.reply, saved)}${saved.has("decision") ? ` ${JSON.stringify(saved.get("decision"))}` : ""}${saved.has("answer") ? ` ${JSON.stringify(saved.get("answer"))}` : ""}`;
    // Replies use the exact routing instructions supplied by the application.
    const recipient = /Use recipientAgentIds \["([^"]+)"\], replyToMessageId "([^"]+)"/u.exec(text);
    if (recipient?.[1] && recipient[2]) {
      toolValue(
        await call("item/tool/call", {
          ...base,
          callId: randomUUID(),
          namespace: "openbot",
          tool: "send_message",
          arguments: {
            recipientAgentIds: [recipient[1]],
            replyToMessageId: recipient[2],
            expectsReply: false,
            text: `Status: done\nResult: ${reply}\nEvidence: release test`,
          },
        }),
        "send_message",
      );
    }
    const item = { type: "agentMessage", id: itemId, text: reply, phase: "final_answer" };
    turn.items.push(item);
    turn.status = "completed";
    save(threadId);
    send({ method: "item/completed", params: { ...base, item } });
    send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
  } catch (error) {
    if (interrupted.has(turnId)) return;
    writeFileSync(join(stateRoot, "last-failure.txt"), redactText(error instanceof Error ? error.message : "Failed"), {
      mode: 0o600,
    });
    turn.status = "failed";
    save(threadId);
    send({
      method: "error",
      params: { ...base, message: error instanceof Error ? error.message : "Scripted provider failed." },
    });
    send({
      method: "turn/completed",
      params: {
        threadId,
        turn: {
          id: turnId,
          status: "failed",
          error: { message: error instanceof Error ? error.message : "Scripted provider failed." },
        },
      },
    });
  }
}

async function handle(raw: string) {
  const message = request.parse(JSON.parse(raw));
  if (!message.method) {
    const waiting = pending.get(String(message.id));
    pending.delete(String(message.id));
    if (message.error) waiting?.reject(new Error("OpenBot rejected the provider request."));
    else waiting?.resolve(message.result ?? null);
    return;
  }
  if (message.id === undefined) return;
  const p = message.params;
  let result: Json = {};
  switch (message.method) {
    case "initialize":
      break;
    case "account/read":
      result = { account: { type: "chatgpt", email: "release@example.com" } };
      break;
    case "account/rateLimits/read":
      result = { rateLimits: null };
      break;
    case "model/list":
      result = {
        data: [
          {
            model: "gpt-6-luna",
            displayName: "Release fixture",
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          },
        ],
        nextCursor: null,
      };
      break;
    case "config/read":
      result = { config: {} };
      break;
    case "plugin/list":
      result = { marketplaces: [] };
      break;
    case "thread/start": {
      const id = randomUUID();
      threads.set(id, {
        id,
        cwd: z.string().optional().parse(p.cwd) ?? stateRoot,
        assignedTasks: [],
        turns: [],
      });
      mcpByThread.set(id, mcpConfig.parse(p.config ?? {}).mcp_servers);
      save(id);
      result = { thread: thread(id) };
      break;
    }
    case "thread/resume":
      mcpByThread.set(z.string().parse(p.threadId), mcpConfig.parse(p.config ?? {}).mcp_servers);
      result = { thread: thread(z.string().parse(p.threadId)) };
      break;
    case "thread/read":
      result = { thread: thread(z.string().parse(p.threadId)) };
      break;
    case "thread/unsubscribe":
      result = { status: "Unsubscribed" };
      break;
    case "thread/turns/list":
      result = { data: thread(z.string().parse(p.threadId)).turns.toReversed(), nextCursor: null };
      break;
    case "thread/items/list":
      result = {
        data:
          thread(z.string().parse(p.threadId))
            .turns.find((turn) => turn.id === p.turnId)
            ?.items.map((item) => ({ turnId: p.turnId ?? null, item })) ?? [],
        nextCursor: null,
      };
      break;
    case "turn/start": {
      const threadId = z.string().parse(p.threadId);
      const id = randomUUID();
      const turn = { id, status: "inProgress", items: [] };
      thread(threadId).turns.push(turn);
      save(threadId);
      send({ id: message.id, result: { turn } });
      send({ method: "turn/started", params: { threadId, turn } });
      const input = z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            name: z.string().optional(),
            path: z.string().optional(),
          }),
        )
        .parse(p.input);
      const uploads = input.flatMap((item) =>
        item.type === "mention" && item.name && item.path ? [{ name: item.name, path: item.path }] : [],
      );
      await run(threadId, id, input.map((item) => item.text ?? "").join("\n"), uploads);
      return;
    }
    case "turn/interrupt": {
      const id = z.string().parse(p.turnId);
      interrupted.add(id);
      holds.get(id)?.abort();
      const threadId = z.string().parse(p.threadId);
      const turn = thread(threadId).turns.find((entry) => entry.id === id);
      if (turn) turn.status = "interrupted";
      save(threadId);
      send({ method: "turn/completed", params: { threadId, turn: { id, status: "interrupted" } } });
      break;
    }
    default:
      send({ id: message.id, error: { code: -32601, message: `Unsupported fixture request: ${message.method}` } });
      return;
  }
  send({ id: message.id, result });
}

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.156.0\n");
} else {
  if (!stateRoot) throw new Error("OPENBOT_E2E_PROTOCOL_STATE is required.");
  mkdirSync(stateRoot, { recursive: true });
  createInterface({ input: process.stdin }).on("line", (line) => {
    void handle(line).catch(() => {
      process.exitCode = 1;
      process.stdin.destroy();
    });
  });
}
