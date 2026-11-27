import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { brotliDecompressSync, gunzipSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { grokHomeDirectory } from "../src/backend/process-confinement";
import { isRecord } from "../src/backend/protocol";

const UPSTREAM = "https://cli-chat-proxy.grok.com/v1";

export type TomlValue = boolean | string;

export interface GrokRequest {
  kind: "main" | "title" | "summary";
  model: string;
  tools: string[];
  calls: string[];
  bodyBytes: number;
  input: number;
  cached: number;
  output: number;
  startedAt: number;
  endedAt: number;
}

const realHome = homedir();
const realGrokHome = grokHomeDirectory(process.env, realHome);

function copiedLogin(): string {
  const login = JSON.parse(readFileSync(join(realGrokHome, "auth.json"), "utf8"));
  if (!isRecord(login)) throw new Error("The Grok login file is not an object.");
  const copy = Object.fromEntries(
    Object.entries(login).map(([id, entry]) => {
      if (!isRecord(entry)) throw new Error("A Grok login entry is not an object.");
      const expires = typeof entry.expires_at === "string" ? Date.parse(entry.expires_at) : Number.NaN;
      if (!(expires > Date.now() + 10 * 60_000))
        throw new Error("The Grok login expires in less than 10 minutes. Run `grok` once to refresh it.");
      return [id, Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "refresh_token"))];
    }),
  );
  return `${JSON.stringify(copy, null, 2)}\n`;
}

function skillFiles(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return execFileSync("find", ["-L", folder, "-name", "SKILL.md", "-type", "f"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

export async function makeGrokHome(
  root: string,
  options: { config?: Record<string, TomlValue>; userSetup?: boolean } = {},
): Promise<string> {
  const grokHome = join(root, ".grok");
  mkdirSync(grokHome, { recursive: true });
  writeFileSync(join(grokHome, "auth.json"), copiedLogin(), { mode: 0o600 });
  let userConfig = "";
  if (options.userSetup) {
    const config = join(realGrokHome, "config.toml");
    if (existsSync(config)) userConfig = readFileSync(config, "utf8");
    for (const folder of [".claude/skills", ".agents/skills", ".codex/skills"])
      for (const file of skillFiles(join(realHome, folder))) {
        const target = join(root, folder, relative(join(realHome, folder), file));
        mkdirSync(dirname(target), { recursive: true });
        await copyFile(file, target);
      }
  }
  const entries = Object.entries(options.config ?? {});
  for (const table of new Set(entries.flatMap(([key]) => (key.includes(".") ? [key.split(".")[0]] : []))))
    if (new RegExp(`^\\s*\\[\\[?${table}[\\].]`, "m").test(userConfig))
      throw new Error(`The user's config.toml has a [${table}] table; dotted keys cannot add to it.`);
  const lines = entries.map(([key, value]) => `${key} = ${JSON.stringify(value)}\n`).join("");
  writeFileSync(join(grokHome, "config.toml"), lines + userConfig);
  return grokHome;
}

export function makeGitWorkspace(folder: string): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "notes.md"), "# Garden plan\n\nTomatoes by the wall.\n");
  writeFileSync(join(folder, "count.txt"), "42\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.name", "Bench");
  git("config", "user.email", "bench@example.invalid");
  git("add", ".");
  git("commit", "-q", "-m", "Start");
}

export function grokEnvironment(root: string, grokHome: string, proxyPort: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    GROK_HOME: grokHome,
    GROK_CLI_CHAT_PROXY_BASE_URL: `http://127.0.0.1:${proxyPort}/v1`,
    GROK_AUTH_EARLY_INVALIDATION_SECS: "0",
  };
  delete env.XAI_API_KEY;
  delete env.GROK_CODE_XAI_API_KEY;
  return env;
}

interface ResponsesUsage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
}

function streamUsage(text: string): ResponsesUsage | null {
  for (const line of text.split("\n").reverse()) {
    if (!line.startsWith("data:")) continue;
    try {
      const event = JSON.parse(line.slice(5));
      if (event.type === "response.completed" && event.response?.usage) return event.response.usage;
    } catch {}
  }
  return null;
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  return Buffer.concat(chunks);
}

const REQUEST_HOP_HEADERS = ["host", "content-length", "accept-encoding", "connection", "transfer-encoding"];
const RESPONSE_HOP_HEADERS = ["content-length", "connection", "transfer-encoding", "content-encoding"];

function decodedBody(body: Buffer, encoding: string | undefined): string {
  const decode: Record<string, (data: Buffer) => Buffer> = {
    gzip: gunzipSync,
    deflate: inflateSync,
    br: brotliDecompressSync,
    zstd: zstdDecompressSync,
  };
  const decoder = encoding ? decode[encoding.trim().toLowerCase()] : undefined;
  if (encoding && !decoder) throw new Error(`The proxy cannot read a request body with encoding ${encoding}.`);
  return (decoder ? decoder(body) : body).toString("utf8");
}

export interface GrokProxy {
  port: number;
  requests: GrokRequest[];
  idle(): Promise<void>;
  close(): void;
}

export async function startGrokProxy(): Promise<GrokProxy> {
  const requests: GrokRequest[] = [];
  let open = 0;
  let waiters: Array<() => void> = [];
  const settle = () => {
    open -= 1;
    if (open > 0) return;
    for (const waiter of waiters) waiter();
    waiters = [];
  };
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    open += 1;
    const startedAt = Date.now();
    void (async () => {
      const sent = await body(request);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers))
        if (typeof value === "string" && !REQUEST_HOP_HEADERS.includes(name)) headers.set(name, value);
      const upstream = await fetch(`${UPSTREAM}${(request.url ?? "/").replace(/^\/v1/u, "")}`, {
        method: request.method ?? "GET",
        headers,
        ...(sent.length > 0 ? { body: new Uint8Array(sent) } : {}),
      });
      const relayed: Record<string, string> = {};
      upstream.headers.forEach((value, name) => {
        if (!RESPONSE_HOP_HEADERS.includes(name)) relayed[name] = value;
      });
      response.writeHead(upstream.status, relayed);
      let text = "";
      const decoder = new TextDecoder();
      if (upstream.body)
        for await (const chunk of upstream.body) {
          response.write(chunk);
          text += decoder.decode(chunk, { stream: true });
        }
      response.end();
      if (request.method !== "POST" || !request.url?.endsWith("/responses")) return;
      const parsed: {
        model?: string;
        prompt_cache_key?: string;
        tool_choice?: { name?: string };
        tools?: Array<{ name?: string; type?: string }>;
        input?: Array<{ type?: string; name?: string }>;
      } = JSON.parse(decodedBody(sent, request.headers["content-encoding"]));
      const usage = streamUsage(text);
      requests.push({
        kind:
          parsed.tool_choice?.name === "session_title"
            ? "title"
            : parsed.prompt_cache_key?.startsWith("turn-summary")
              ? "summary"
              : "main",
        model: parsed.model ?? "",
        tools: (parsed.tools ?? []).flatMap((tool) => tool.name ?? tool.type ?? []).sort(),
        calls: (Array.isArray(parsed.input) ? parsed.input : []).flatMap((item) =>
          (item.type === "function_call" || item.type === "custom_tool_call") && item.name ? [item.name] : [],
        ),
        bodyBytes: sent.length,
        input: usage?.input_tokens ?? 0,
        cached: usage?.input_tokens_details?.cached_tokens ?? 0,
        output: usage?.output_tokens ?? 0,
        startedAt,
        endedAt: Date.now(),
      });
    })()
      .catch((error: unknown) => {
        if (!response.headersSent) response.writeHead(502);
        response.end(String(error));
      })
      .finally(settle);
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The proxy has no port.");
  return {
    port: address.port,
    requests,
    idle: () => (open === 0 ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve))),
    close: () => server.close(),
  };
}
