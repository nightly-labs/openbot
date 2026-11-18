// Shared by the OpenCode prompt bench, the OpenCode agent smoke and the OpenCode tool-trim e2e: the real `opencode` provider
// driver and the real OpenCode binary, against a fake OpenAI-compatible model on loopback. OpenCode
// runs in a temporary HOME and XDG folders, so it never reads the developer's own config, keys or
// sessions, and it gets its own service port, so it does not meet a running OpenBot's.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentClient } from "../src/backend/agent-client";
import { type AgentCliInfo, resolveOpencodeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { CustomProviderConfig } from "../src/backend/opencode-config";
import { getArray, getString, isRecord } from "../src/backend/protocol";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { stopClients } from "./provider-fakes/host";

const NL = "\n";
const run = promisify(execFile);
const ENDPOINT = "spark";
const MODEL = "agent-model";
export const OPENCODE_MODEL = `${ENDPOINT}/${MODEL}`;

/** One chat request that OpenCode sent to the fake model. */
export interface ModelRequest {
  /** The parsed request body. */
  body: unknown;
  /** The `role` of each message. */
  roles: string[];
  /** The text of the system messages. */
  system: string;
  /** The names of the function tools. */
  tools: string[];
  /** The text of the last user message. */
  lastUser: string;
  /** The number of tool results in the conversation. */
  toolResults: number;
}

/** A JSON value, such as a config file or the arguments of a tool call. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/** What the fake model answers: text, or one tool call. */
export type ModelAnswer = { text: string } | { tool: string; arguments: { readonly [key: string]: Json } };

export type ModelScript = (request: ModelRequest) => ModelAnswer;

export interface OpenCodeHarness {
  readonly root: string;
  readonly workspace: string;
  readonly cli: AgentCliInfo;
  /** Every request, in order. */
  readonly requests: ModelRequest[];
  /** Replaces the answer of each later request. */
  script: ModelScript;
  /** Writes the global `opencode.json` that the next process reads. */
  writeGlobalConfig(config: { readonly [key: string]: Json }): Promise<void>;
  /** A new OpenCode agent client, which `stop` stops. */
  createClient(): AgentClient;
  stop(): Promise<void>;
}

function messageText(message: unknown): string {
  if (!isRecord(message)) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  return JSON.stringify(content ?? "");
}

function readModelRequest(value: unknown): ModelRequest {
  const messages = getArray(value, "messages");
  const users = messages.filter((message) => getString(message, "role") === "user");
  return {
    body: value,
    roles: messages.map((message) => getString(message, "role") ?? ""),
    system: messages
      .filter((message) => getString(message, "role") === "system")
      .map(messageText)
      .join(NL),
    tools: getArray(value, "tools").map((tool) => (isRecord(tool) ? (getString(tool.function, "name") ?? "") : "")),
    lastUser: messageText(users.at(-1)),
    toolResults: messages.filter((message) => getString(message, "role") === "tool").length,
  };
}

function chunk(delta: { readonly [key: string]: Json }, finish: string | null): string {
  const value = {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(value)}${NL}${NL}`;
}

async function readBody(request: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

async function freePort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((listening) => probe.listen(0, "127.0.0.1", listening));
  const address = probe.address();
  await new Promise<void>((closed) => probe.close(() => closed()));
  if (!address || typeof address === "string") throw new Error("The port probe has no port.");
  return address.port;
}

/**
 * Starts the fake model and points OpenCode at temporary folders. `OPENCODE_CLI` names the binary;
 * without it, the managed OpenCode install is used.
 */
export async function startOpenCodeHarness(name: string): Promise<OpenCodeHarness> {
  const root = await mkdtemp(join(tmpdir(), `openbot-${name}-`));
  const requests: ModelRequest[] = [];
  const clients: AgentClient[] = [];
  let calls = 0;
  let script: ModelScript = () => ({ text: "OK" });
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const modelRequest = readModelRequest(await readBody(request));
      requests.push(modelRequest);
      const answer = script(modelRequest);
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      if ("text" in answer) {
        response.write(chunk({ role: "assistant", content: answer.text }, null));
        response.write(chunk({}, "stop"));
      } else {
        calls += 1;
        const call = {
          index: 0,
          id: `call-${calls}`,
          type: "function",
          function: { name: answer.tool, arguments: JSON.stringify(answer.arguments) },
        };
        response.write(chunk({ role: "assistant", tool_calls: [call] }, null));
        response.write(chunk({}, "tool_calls"));
      }
      response.end(`data: [DONE]${NL}${NL}`);
    })().catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake model has no port.");

  for (const [variable, folder] of [
    ["HOME", "home"],
    ["XDG_CONFIG_HOME", "config"],
    ["XDG_DATA_HOME", "data"],
    ["XDG_STATE_HOME", "state"],
    ["XDG_CACHE_HOME", "cache"],
  ] as const) {
    process.env[variable] = join(root, folder);
    await mkdir(join(root, folder), { recursive: true });
  }
  // A config file or folder of the developer would add their rules, and the driver would add none.
  delete process.env.OPENCODE_CONFIG;
  delete process.env.OPENCODE_CONFIG_DIR;
  await mkdir(join(root, "config", "opencode"), { recursive: true });
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });

  const endpoint: CustomProviderConfig = {
    id: ENDPOINT,
    name: "Spark",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: null,
    headers: [],
    models: [{ id: MODEL, name: "Agent model" }],
  };
  const cli = await runCauseEffect(resolveOpencodeCli({ bundledExecutable: process.env.OPENCODE_CLI }));
  await run(cli.executable, ["service", "set", "port", String(await freePort())], { env: process.env });

  return {
    root,
    workspace,
    cli,
    requests,
    get script() {
      return script;
    },
    set script(next: ModelScript) {
      script = next;
    },
    async writeGlobalConfig(config: { readonly [key: string]: Json }) {
      const value = { $schema: "https://opencode.ai/config.json", ...config };
      await writeFile(join(root, "config", "opencode", "opencode.json"), `${JSON.stringify(value)}${NL}`);
    },
    createClient() {
      const client = requireProviderDriver("opencode").createClient(cli, 60_000, {
        apiKey: () => null,
        customProviders: () => [endpoint],
        mcpServers: () => [],
        providerStateDirectory: join(root, "provider-state"),
      });
      clients.push(client);
      return client;
    },
    async stop() {
      await stopClients(clients);
      await run(cli.executable, ["service", "stop"], { env: process.env }).catch(() => undefined);
      server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** The OpenBot tools in the Code Mode catalog, and the namespace header, such as `16 tools, 14 shown`. */
export function codeModeCatalog(system: string): { openbot: string[]; opencode: string[]; header: string | null } {
  const names = (namespace: string) => [
    ...new Set(
      [...system.matchAll(new RegExp(`tools\\.${namespace}\\.([a-z_]+)\\(`, "gu"))].map((match) => match[1] ?? ""),
    ),
  ];
  return {
    openbot: names("openbot").sort(),
    opencode: names("opencode").sort(),
    header: system.match(/- openbot \(([^)]*)\)/u)?.[1] ?? null,
  };
}

/** The skill ids that the system prompt lists. */
export function listedSkills(system: string): string[] {
  return [...system.matchAll(/<id>([^<]+)<\/id>/gu)].map((match) => match[1] ?? "").sort();
}
