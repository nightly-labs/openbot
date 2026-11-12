// The agent side of a fake that speaks the Agent Client Protocol on stdio, for provider E2E tests.
// Each file in `agents/` is one fake: it gives a handler for each method it answers. This file reads
// the NDJSON requests, gives notifications to `onNotification`, and answers a method with no handler
// with `{}`.
// `installFakeAgent` in `host.ts` starts a fake with the Bun that runs the test.
import { appendFileSync } from "node:fs";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

/** The request fields that the fakes read. The values come from the client under test. */
export interface AcpParams {
  sessionId?: string;
  cwd?: string;
  additionalDirectories?: string[];
  mcpServers?: { name: string }[];
  prompt?: { type: string; text?: string }[];
  configId?: string;
  value?: string;
  /** `session/set_model`. */
  modelId?: string;
  /** `_x.ai/interject` of Grok. */
  text?: string;
  interjectionId?: string;
  content?: { type: string; text?: string; mimeType?: string }[];
  /** `initialize`. OpenCode reads the `_meta` key that asks for its subagents' sessions. */
  clientCapabilities?: { _meta?: { "opencode/child-session-updates"?: boolean } };
}

export interface AcpRequest {
  id: number | string;
  method: string;
  params: AcpParams;
}

export interface AcpError {
  code: number;
  message: string;
  data?: unknown;
}

export interface AcpPeer {
  reply(request: AcpRequest, result: unknown): void;
  fail(request: AcpRequest, error: AcpError): void;
  /** Sends one `agent_message_chunk` with this text for the session. */
  say(sessionId: string | undefined, text: string): void;
  /** Sends one `session/update` with this update for the session. */
  update(sessionId: string | undefined, update: SessionUpdate): void;
  /** Sends a request to the client. Resolves with its result, or with `{ error }` when it fails. */
  ask(method: string, params: unknown): Promise<unknown>;
}

export type AcpHandler = (request: AcpRequest, peer: AcpPeer) => void;

/** A value that a fake writes to its log. */
export type LogValue = string | number | boolean | null | undefined | readonly string[];

type OutgoingMessage =
  | { id: AcpRequest["id"]; result: unknown }
  | { id: AcpRequest["id"]; error: AcpError }
  | { id?: string; method: string; params: unknown };

interface IncomingMessage {
  id?: number | string;
  method?: unknown;
  params?: AcpParams;
  result?: unknown;
  error?: unknown;
}

const NL = "\n";

/** Appends one JSON line to the file that the test names in `FAKE_LOG`. */
export function logEntry(entry: Readonly<Record<string, LogValue>>): void {
  const path = process.env.FAKE_LOG;
  if (path) appendFileSync(path, `${JSON.stringify(entry)}${NL}`);
}

export function serveFakeAcpAgent(
  handlers: Readonly<Record<string, AcpHandler>>,
  options: {
    onRequest?: (request: AcpRequest) => void;
    /** A message with no id, such as `session/cancel`. */
    onNotification?: (method: string, params: AcpParams) => void;
  } = {},
): void {
  const write = (message: OutgoingMessage) =>
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}${NL}`);
  /** The requests to the client that wait for their answer, by id. */
  const asked = new Map<string, (result: unknown) => void>();
  const peer: AcpPeer = {
    reply: (request, result) => write({ id: request.id, result }),
    fail: (request, error) => write({ id: request.id, error }),
    say: (sessionId, text) =>
      peer.update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } }),
    update: (sessionId, update) => write({ method: "session/update", params: { sessionId, update } }),
    ask: (method, params) =>
      new Promise((answered) => {
        const id = `agent-${asked.size + 1}-${Date.now()}`;
        asked.set(id, answered);
        write({ id, method, params });
      }),
  };
  const handle = (message: IncomingMessage) => {
    if (typeof message.method !== "string") {
      const answered = typeof message.id === "string" ? asked.get(message.id) : undefined;
      if (typeof message.id === "string") asked.delete(message.id);
      answered?.(message.error === undefined ? message.result : { error: message.error });
      return;
    }
    if (message.id === undefined) {
      options.onNotification?.(message.method, message.params ?? {});
      return;
    }
    const request: AcpRequest = { id: message.id, method: message.method, params: message.params ?? {} };
    options.onRequest?.(request);
    const handler = handlers[request.method];
    if (handler) handler(request, peer);
    else peer.reply(request, {});
  };
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    for (let index = buffer.indexOf(NL); index >= 0; index = buffer.indexOf(NL)) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) handle(JSON.parse(line));
    }
  });
  // A real agent runs until the client stops it, also after stdin ends.
  setInterval(() => {}, 1000);
}
