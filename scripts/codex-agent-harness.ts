import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { readCodexMcpConfig } from "../src/backend/agent/codex-mcp-config";
import { codexPromptSettings } from "../src/backend/agent/codex-prompt-settings";
import { generateTextWithoutTools } from "../src/backend/agent/profile-generation";
import { CODEX_FEATURES_CONFIG } from "../src/backend/agent/thread-lifecycle";
import { discoverTools, resolveDeferredTool, visibleDynamicTools } from "../src/backend/agent/tool-catalog";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import type { CodexCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { codexDisabledServers, toMcpShapeFailed } from "../src/backend/mcp-provider-shapes";
import { webSearchToolSchema } from "../src/backend/openbot-tools";
import {
  type DynamicToolCallParams,
  decodeRecordResponse,
  getRecord,
  getString,
  isRecord,
} from "../src/backend/protocol";

export const DEVELOPER_INSTRUCTIONS = "You are Ada, a careful assistant in an end-to-end benchmark.";

export interface RequestUsage {
  input: number;
  cachedInput: number;
  output: number;
}

export interface PromptContents {
  tools: string;
  context: string;
}

export interface ServerRequest {
  id: number | string;
  method: string;
  params: unknown;
}

function loginCopy(): string {
  const source = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json");
  const auth = JSON.parse(readFileSync(source, "utf8"));
  if (!isRecord(auth)) throw new Error(`${source} is not a Codex login.`);
  const tokens = getRecord(auth, "tokens");
  if (!tokens) return JSON.stringify(auth);
  const payload = getString(tokens, "access_token")?.split(".")[1];
  const expires = payload ? Number(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).exp) : 0;
  if (!(expires * 1000 > Date.now() + 15 * 60_000))
    throw new Error("The Codex access token expires in less than 15 minutes. Run `codex` once to refresh it.");
  return JSON.stringify({ ...auth, tokens: { ...tokens, refresh_token: "" } });
}

export async function makeCodexHome(path: string, configToml = ""): Promise<string> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "auth.json"), loginCopy(), { mode: 0o600 });
  await writeFile(join(path, "config.toml"), configToml);
  return path;
}

export async function makeGitWorkspace(workspace: string): Promise<(...args: string[]) => string> {
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "notes.md"), "# Garden plan\n\nTomatoes by the wall.\n");
  await writeFile(join(workspace, "count.txt"), "42\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: workspace, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "OpenBot Bench");
  git("config", "user.email", "bench@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("add", ".");
  git("commit", "-q", "-m", "Start");
  return git;
}

export function openbotConfig(read: DynamicRecord | null, promptSettings = true) {
  return {
    tools: { update_plan: { enabled: true } },
    ...CODEX_FEATURES_CONFIG,
    ...(promptSettings ? codexPromptSettings(read) : {}),
    project_doc_max_bytes: 65_536,
    mcp_optional_startup_grace_ms: 10_000,
    "features.code_mode.direct_only_tool_namespaces": [
      ...visibleDynamicTools("codex").map((namespace) => namespace.name),
      "image_gen",
    ],
  };
}

export interface CodexAgent {
  client: CodexAppServerClient;
  read: DynamicRecord | null;
  startThread(
    cwd: string,
    model: string,
    config: DynamicRecord,
    catalog?: AgentProviderId,
  ): Promise<{ id: string; path: string }>;
  runTurn(threadId: string, prompt: string, timeoutMs?: number): Promise<RequestUsage[]>;
  stop(): Promise<void>;
}

export async function startCodexAgent(
  cli: CodexCliInfo,
  home: string,
  cwd: string,
  onRequest?: (request: ServerRequest) => unknown,
): Promise<CodexAgent> {
  const client = new CodexAppServerClient(cli.executable, 120_000, { CODEX_HOME: home });
  const usage = new Map<string, RequestUsage[]>();
  const completed = new Map<string, (error?: string) => void>();
  client.on("notification", (notification) => {
    const params = isRecord(notification.params) ? notification.params : {};
    const threadId = getString(params, "threadId") ?? "";
    if (notification.method === "thread/tokenUsage/updated") {
      const last = getRecord(getRecord(params, "tokenUsage"), "last");
      usage.get(threadId)?.push({
        input: Number(last?.inputTokens ?? 0),
        cachedInput: Number(last?.cachedInputTokens ?? 0),
        output: Number(last?.outputTokens ?? 0),
      });
    }
    if (notification.method === "turn/completed") {
      const turn = getRecord(params, "turn");
      const error = getRecord(turn, "error");
      completed.get(threadId)?.(
        getString(turn, "status") === "failed" ? (getString(error, "message") ?? "failed") : undefined,
      );
    }
  });
  client.on("request", async (request) => {
    const answer = await onRequest?.(request);
    if (answer !== undefined) client.respond(request.id, answer);
    else if (request.method === "item/tool/call")
      client.respond(request.id, {
        contentItems: [{ type: "inputText", text: "Not available here." }],
        success: false,
      });
    else client.respond(request.id, { decision: "accept" });
  });
  client.start();
  const request = (method: string, params: unknown) =>
    runCauseEffect(client.request(method, params, decodeRecordResponse));
  await request("initialize", {
    clientInfo: { name: "openbot", title: "OpenBot", version: "0.0.0" },
    capabilities: { experimentalApi: true },
  });
  client.notify("initialized");
  await request("plugin/reconcile", { reason: "bench" }).catch(() => undefined);
  await request("skills/list", { cwds: [cwd], forceReload: true });
  const own = await runCauseEffect(
    codexDisabledServers(() => readCodexMcpConfig(client, () => ({})).pipe(toMcpShapeFailed)),
  );
  return {
    client,
    read: own.read,
    async startThread(threadCwd, model, config, catalog = "codex") {
      const started = await request("thread/start", {
        config,
        model,
        cwd: threadCwd,
        approvalPolicy: "on-request",
        sandbox: "danger-full-access",
        developerInstructions: DEVELOPER_INSTRUCTIONS,
        serviceName: "openbot",
        dynamicTools: visibleDynamicTools(catalog),
      });
      const thread = getRecord(started, "thread");
      const id = getString(thread, "id");
      const path = getString(thread, "path");
      if (!id || !path) throw new Error("thread/start returned no thread id or path.");
      usage.set(id, []);
      return { id, path };
    },
    async runTurn(threadId, prompt, timeoutMs = 180_000) {
      const list = usage.get(threadId) ?? [];
      const before = list.length;
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`The turn did not end in ${timeoutMs} ms.`)), timeoutMs);
        completed.set(threadId, (error) => {
          clearTimeout(timer);
          if (error) reject(new Error(error));
          else resolve();
        });
      });
      await request("turn/start", { threadId, input: [{ type: "text", text: prompt }] });
      await done;
      return list.slice(before);
    },
    async stop() {
      await runCauseEffect(client.stop());
    },
  };
}

export async function promptContents(rolloutPath: string): Promise<PromptContents> {
  const items = (await readFile(rolloutPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((line) => line.type === "response_item")
    .map((line) => line.payload);
  const firstPrompt = items.findIndex(
    (item) => item.type === "message" && item.role === "user" && !JSON.stringify(item.content).includes("<"),
  );
  const context = items.slice(0, firstPrompt < 0 ? undefined : firstPrompt).filter((item) => item.type === "message");
  return {
    tools: JSON.stringify(items.find((item) => item.type === "additional_tools")?.tools ?? []),
    context: context.map((item) => item.content.map((part: { text?: string }) => part.text ?? "").join("")).join("\n"),
  };
}

export function listsSkill(context: string, skill: string): boolean {
  return context
    .split("\n")
    .some((line) => line === `- ${skill}` || line.startsWith(`- ${skill}:`) || line.startsWith(`- ${skill} `));
}

export interface SideSearch {
  query: string;
  answer: string;
  requests: RequestUsage[];
  ms: number;
  error?: string;
}

export async function sideSearch(cli: CodexCliInfo, home: string, model: string, query: string): Promise<SideSearch> {
  const search: SideSearch = { query, answer: "", requests: [], ms: 0 };
  const client = new CodexAppServerClient(cli.executable, 120_000, { CODEX_HOME: home });
  const option = {
    provider: "codex" as const,
    id: model,
    name: model,
    description: "",
    defaultReasoningEffort: "low" as const,
    supportedReasoningEfforts: ["low" as const],
  };
  const started = Date.now();
  try {
    search.answer = await runCauseEffect(
      generateTextWithoutTools(
        client,
        option,
        query,
        () => false,
        (notification) => {
          if (notification.method !== "thread/tokenUsage/updated" || !isRecord(notification.params)) return;
          const last = getRecord(getRecord(notification.params, "tokenUsage"), "last");
          search.requests.push({
            input: Number(last?.inputTokens ?? 0),
            cachedInput: Number(last?.cachedInputTokens ?? 0),
            output: Number(last?.outputTokens ?? 0),
          });
        },
        "webSearch",
      ),
    );
  } catch (error) {
    search.error = error instanceof Error ? error.message : String(error);
  }
  search.ms = Date.now() - started;
  return search;
}

export function toolCallParams(params: DynamicRecord): DynamicToolCallParams {
  return {
    threadId: getString(params, "threadId") ?? "",
    turnId: getString(params, "turnId") ?? "",
    callId: getString(params, "callId") ?? "",
    namespace: "openbot",
    tool: getString(params, "tool") ?? "",
    arguments: params.arguments,
  };
}

export async function answerCatalogTool(
  call: DynamicToolCallParams,
  search: (query: string) => Promise<SideSearch>,
  catalog: AgentProviderId = "codex",
): Promise<{ text: string; success: boolean }> {
  if (call.tool === "tool_search") return { text: JSON.stringify(discoverTools(call, catalog)), success: true };
  const resolved = call.tool === "tool_call" ? resolveDeferredTool(call, catalog) : null;
  if (resolved?.tool !== "web_search") return { text: "Not available here.", success: false };
  const parsed = webSearchToolSchema.safeParse(resolved.arguments ?? {});
  if (!parsed.success) return { text: parsed.error.message, success: false };
  const result = await search(parsed.data.query);
  return result.error
    ? { text: "The web search did not finish.", success: false }
    : { text: result.answer, success: true };
}

export async function removeRun(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
