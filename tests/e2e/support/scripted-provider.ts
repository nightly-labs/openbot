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
const record = z.record(z.string(), z.json());
const state = z.object({
  id: z.string(),
  cwd: z.string(),
  // Qualified names of the dynamic tools that thread/start gave the model. Codex keeps them with the session.
  tools: z.array(z.string()).default([]),
  // The expected result of each channel_assign, by the lead's channel task id.
  assignments: z.record(z.string(), z.string()).default({}),
  turns: z.array(z.object({ id: z.string(), status: z.string(), items: z.array(z.json()) })),
});
type Thread = z.infer<typeof state>;
const threads = new Map<string, Thread>();
// Provider launch configuration can contain credentials. Keep it out of saved thread fixtures.
const mcpByThread = new Map<string, Record<string, Json>>();
const mcpConfig = z.object({ mcp_servers: record.default({}) });
const dynamicTools = z
  .array(z.object({ name: z.string(), tools: z.array(z.object({ name: z.string() })) }))
  .default([]);
const pending = new Map<string, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
const interrupted = new Set<string>();
const holds = new Map<string, AbortController>();
const stateRoot = process.env.OPENBOT_E2E_PROTOCOL_STATE ?? "";
const send = (value: Json) => process.stdout.write(`${JSON.stringify(value)}\n`);
// Codex's user config layer, where OpenBot registers disabled placeholders for its MCP servers.
const userConfigPath = join(stateRoot, "codex-user-config.json");
const userLayer = z.object({ version: z.number().int(), config: record });
let userConfig: z.infer<typeof userLayer> = { version: 0, config: {} };

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function thread(id: string) {
  const cached = threads.get(id);
  if (cached) return cached;
  const path = join(stateRoot, `${basename(id)}.json`);
  if (!existsSync(path)) throw new RpcError(-32600, `thread not found: ${id}`);
  const loaded = state.parse(JSON.parse(readFileSync(path, "utf8")));
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
function savedValue(token: string, saved: Map<string, Json>): Json {
  const [key = "", ...path] = token.slice(8).split(".");
  let current = saved.get(key);
  for (const part of path) current = Array.isArray(current) ? current[Number(part)] : record.parse(current)[part];
  if (current === undefined) throw new Error(`Missing tool result ${token}`);
  return current;
}
function resolveArgs(value: Json, saved: Map<string, Json>): Json {
  if (typeof value === "string" && value.startsWith("$result:")) return savedValue(value, saved);
  if (Array.isArray(value)) return value.map((item) => resolveArgs(item, saved));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveArgs(item, saved)]));
  }
  return value;
}
function interpolate(text: string, saved: Map<string, Json>): string {
  return text.replace(/\$result:[\w-]+(?:\.[\w-]+)*/gu, (token) => {
    const value = savedValue(token, saved);
    return typeof value === "string" ? value : JSON.stringify(value);
  });
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
// Codex calls a tool it was given by name. Other catalog tools go through the visible bridge.
async function callTool(current: Thread, turnId: string, namespace: string, name: string, args: Json) {
  const qualified = `${namespace}.${name}`;
  const direct = current.tools.includes(qualified);
  if (!direct && !current.tools.includes("openbot.tool_call")) throw new Error(`Tool ${qualified} is not available.`);
  const target = direct
    ? { namespace, tool: name, arguments: args }
    : { namespace: "openbot", tool: "tool_call", arguments: { name: qualified, arguments: args } };
  return toolValue(
    await call("item/tool/call", { threadId: current.id, turnId, callId: randomUUID(), ...target }),
    qualified,
  );
}
function mcpServers(config: Record<string, Json>) {
  return record.parse(config.mcp_servers ?? {});
}
function saveUserConfig() {
  writeFileSync(userConfigPath, JSON.stringify(userConfig), { mode: 0o600 });
}
async function run(
  current: Thread,
  turn: Thread["turns"][number],
  text: string,
  uploads: { name: string; path: string }[],
) {
  const threadId = current.id;
  const turnId = turn.id;
  const base = { threadId, turnId };
  const itemId = randomUUID();
  try {
    const assignment = text.split("Current assignment:\n").at(-1) ?? text;
    const routingPrompt = text.startsWith("Select one responsible channel member.");
    // A refreshed provider session can include earlier chat messages before the current input.
    // A routing prompt quotes channel messages cut to a length limit, so it has no whole scenario.
    const marker = routingPrompt ? undefined : [...assignment.matchAll(/E2E_SCENARIO:([A-Za-z0-9+/=]+)/gu)].at(-1)?.[1];
    let scenario = marker
      ? scenarioSchema.parse(JSON.parse(Buffer.from(marker, "base64").toString("utf8")))
      : scenarioSchema.parse({ reply: "Task received." });
    if (routingPrompt) {
      const routing = z
        .object({ members: z.array(z.object({ agentId: z.string() })).min(1) })
        .parse(JSON.parse(text.split("\n").at(-1) ?? "{}"));
      scenario = scenarioSchema.parse({ reply: JSON.stringify({ agentId: routing.members[0]?.agentId }) });
    }
    const saved = new Map<string, Json>();
    const channel = text.split("\n").find((line) => line.startsWith('{"channel":'));
    const taskId = channel
      ? z
          .object({ task: z.object({ id: z.string() }) })
          .passthrough()
          .parse(JSON.parse(channel)).task.id
      : undefined;
    if (channel) saved.set("context", z.json().parse(JSON.parse(channel)));
    const expected = taskId === undefined ? undefined : current.assignments[taskId];
    if (
      expected !== undefined &&
      scenario.steps.some((step) => step.kind === "tool" && step.name === "channel_assign")
    ) {
      // The lead re-enters its task when the assigned result arrives.
      if (!text.includes(expected)) throw new Error("The lead resumed before the worker result arrived.");
      scenario = scenarioSchema.parse({
        steps: [{ kind: "tool", name: "channel_result", args: { text: "Group results received" } }],
        reply: "Group complete",
      });
    }
    for (const delta of scenario.stream)
      send({ method: "item/agentMessage/delta", params: { ...base, itemId, delta } });
    for (const step of scenario.steps) {
      if (interrupted.has(turnId)) return;
      if (step.kind === "tool") {
        const args = resolveArgs(step.args, saved);
        if (step.name === "channel_assign" && taskId !== undefined) {
          current.assignments[taskId] = z.object({ expectedResult: z.string() }).parse(args).expectedResult;
          save(threadId);
        }
        const value = await callTool(current, turnId, step.namespace, step.name, args);
        if (step.save) saved.set(step.save, value);
      } else if (step.kind === "mcp") {
        // Codex merges the user layer under the thread config. Thread fields win.
        const fromUser = record.optional().parse(mcpServers(userConfig.config)[step.server]);
        const fromThread = record.optional().parse(mcpByThread.get(threadId)?.[step.server]);
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
          .parse(fromUser || fromThread ? { ...fromUser, ...fromThread } : undefined);
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
        saved.set(
          "decision",
          await call("item/commandExecution/requestApproval", {
            ...base,
            itemId: randomUUID(),
            command: "printf release-test",
            cwd: current.cwd,
            reason: "Run the release test command.",
          }),
        );
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
    const reply = `${interpolate(scenario.reply, saved)}${saved.has("decision") ? ` ${JSON.stringify(saved.get("decision"))}` : ""}${saved.has("answer") ? ` ${JSON.stringify(saved.get("answer"))}` : ""}`;
    // Replies use the exact routing instructions supplied by the application. The last one is current.
    const recipient = [...text.matchAll(/Use recipientAgentIds \["([^"]+)"\], replyToMessageId "([^"]+)"/gu)].at(-1);
    if (recipient?.[1] && recipient[2]) {
      await callTool(current, turnId, "openbot", "send_message", {
        recipientAgentIds: [recipient[1]],
        replyToMessageId: recipient[2],
        expectsReply: false,
        text: `Status: done\nResult: ${reply}\nEvidence: release test`,
      });
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

async function handle(message: z.infer<typeof request>): Promise<Json | undefined> {
  if (!message.method) {
    const waiting = pending.get(String(message.id));
    pending.delete(String(message.id));
    if (message.error) waiting?.reject(new Error("OpenBot rejected the provider request."));
    else waiting?.resolve(message.result ?? null);
    return;
  }
  if (message.id === undefined) return;
  const p = message.params;
  switch (message.method) {
    case "initialize":
      return {};
    case "account/read":
      return { account: { type: "chatgpt", email: "release@example.com" } };
    case "account/rateLimits/read":
      return { rateLimits: null };
    case "model/list":
      return {
        data: [
          {
            model: "gpt-6-luna",
            displayName: "Release fixture",
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          },
          {
            model: "gpt-6-luna-alt",
            displayName: "Release fixture alt",
            defaultReasoningEffort: "low",
            supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          },
        ],
        nextCursor: null,
      };
    case "config/read":
      return p.includeLayers
        ? {
            config: userConfig.config,
            layers: [
              {
                name: { type: "user", file: userConfigPath },
                version: String(userConfig.version),
                config: userConfig.config,
              },
            ],
          }
        : { config: userConfig.config };
    case "config/batchWrite": {
      const write = z
        .object({
          edits: z.array(z.object({ keyPath: z.string(), value: z.json() })),
          filePath: z.string().nullish(),
          expectedVersion: z.string().nullish(),
        })
        .parse(p);
      if (write.filePath && write.filePath !== userConfigPath)
        throw new RpcError(-32600, "Only the user config file can be written.");
      if (write.expectedVersion && write.expectedVersion !== String(userConfig.version))
        throw new RpcError(-32600, "Configuration was modified since last read.");
      const servers = mcpServers(userConfig.config);
      for (const edit of write.edits) {
        const name = /^mcp_servers\.([^.]+)$/u.exec(edit.keyPath)?.[1];
        if (!name) throw new RpcError(-32600, `Unsupported fixture config key path: ${edit.keyPath}`);
        servers[name] = edit.value;
      }
      userConfig = { version: userConfig.version + 1, config: { ...userConfig.config, mcp_servers: servers } };
      saveUserConfig();
      return { status: "ok", version: String(userConfig.version), filePath: userConfigPath };
    }
    case "plugin/list":
      return { marketplaces: [] };
    case "thread/start": {
      const id = randomUUID();
      threads.set(id, {
        id,
        cwd: z.string().optional().parse(p.cwd) ?? stateRoot,
        tools: dynamicTools
          .parse(p.dynamicTools ?? [])
          .flatMap((namespace) => namespace.tools.map((tool) => `${namespace.name}.${tool.name}`)),
        assignments: {},
        turns: [],
      });
      mcpByThread.set(id, mcpConfig.parse(p.config ?? {}).mcp_servers);
      save(id);
      return { thread: thread(id) };
    }
    case "thread/resume": {
      const id = z.string().parse(p.threadId);
      const resumed = thread(id);
      // Codex ignores config on resume for a loaded thread and reads a cold thread's config from its
      // session file. This fixture keeps launch config out of its files, so a thread loaded after a
      // fixture restart takes the resume config instead.
      if (!mcpByThread.has(id)) mcpByThread.set(id, mcpConfig.parse(p.config ?? {}).mcp_servers);
      return { thread: resumed };
    }
    case "thread/read":
      return { thread: thread(z.string().parse(p.threadId)) };
    case "thread/unsubscribe":
      return { status: "Unsubscribed" };
    case "thread/turns/list":
      return { data: thread(z.string().parse(p.threadId)).turns.toReversed(), nextCursor: null };
    case "thread/items/list":
      return {
        data:
          thread(z.string().parse(p.threadId))
            .turns.find((turn) => turn.id === p.turnId)
            ?.items.map((item) => ({ turnId: p.turnId ?? null, item })) ?? [],
        nextCursor: null,
      };
    case "turn/start": {
      const threadId = z.string().parse(p.threadId);
      const current = thread(threadId);
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
      const turn = { id: randomUUID(), status: "inProgress", items: [] };
      current.turns.push(turn);
      save(threadId);
      send({ id: message.id, result: { turn } });
      send({ method: "turn/started", params: { threadId, turn } });
      const uploads = input.flatMap((item) =>
        item.type === "mention" && item.name && item.path ? [{ name: item.name, path: item.path }] : [],
      );
      await run(current, turn, input.map((item) => item.text ?? "").join("\n"), uploads);
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
      return {};
    }
    default:
      throw new RpcError(-32601, `Unsupported fixture request: ${message.method}`);
  }
}

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.156.0\n");
} else {
  if (!stateRoot) throw new Error("OPENBOT_E2E_PROTOCOL_STATE is required.");
  mkdirSync(stateRoot, { recursive: true });
  if (existsSync(userConfigPath)) userConfig = userLayer.parse(JSON.parse(readFileSync(userConfigPath, "utf8")));
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let id: string | number | undefined;
    void (async () => {
      const value = z.json().parse(JSON.parse(line));
      const head = request.pick({ id: true, method: true }).safeParse(value);
      if (head.success && head.data.method) id = head.data.id;
      const message = request.parse(value);
      const result = await handle(message);
      if (result !== undefined && id !== undefined) send({ id, result });
    })().catch((error: unknown) => {
      if (id === undefined) return;
      send({
        id,
        error: {
          code: error instanceof RpcError ? error.code : -32603,
          message: redactText(error instanceof Error ? error.message : "Scripted provider request failed."),
        },
      });
    });
  });
  // The app owns this process. A held turn must not outlive the app's end of the pipe.
  lines.on("close", () => process.exit(0));
}
