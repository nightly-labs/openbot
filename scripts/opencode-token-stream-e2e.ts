// Checks that an answer streamed in sub-word tokens through a custom OpenCode endpoint keeps its words
// whole (#3351). Runs the real OpenCode driver and CLI against a fake OpenAI-compatible server on
// loopback. Cases: plain tokens, tokens with an empty `reasoning_content` beside each one, tokens with
// reasoning between them, and a control where the endpoint itself sends the spaces.
// `bun scripts/opencode-token-stream-e2e.ts [<opencode binary>]`. Without an argument it uses
// `OPENBOT_OPENCODE_PATH`. Writes .openbot-build/opencode-token-stream-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-token-stream-e2e");
const binary = process.argv[2] ?? process.env.OPENBOT_OPENCODE_PATH;
if (!binary) throw new Error("Give the OpenCode binary as the first argument or in OPENBOT_OPENCODE_PATH.");

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-token-stream-"));
const home = join(root, "home");
mkdirSync(home, { recursive: true });
// Before the driver loads: OpenCode keeps its state under the home folder.
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = join(home, ".config");
process.env.XDG_DATA_HOME = join(home, ".local/share");
process.env.XDG_CACHE_HOME = join(home, ".cache");
process.env.XDG_STATE_HOME = join(home, ".local/state");

const { requireProviderDriver } = await import("../src/backend/provider-drivers");
const { runTurn, startThread, stopClients } = await import("./provider-fakes/host");
const { getString, isRecord } = await import("../src/backend/protocol");
type AgentClient = import("../src/backend/agent-client").AgentClient;

const MODEL = "token-model";
const PROVIDER = "token-endpoint";
/** The start of the reported message, cut as a sub-word tokenizer cuts it. */
const TOKENS = [
  "B",
  "aca",
  " gambar",
  ".",
  " G",
  "ambar",
  ":",
  " tabel",
  " R",
  "enc",
  "ana",
  " (",
  "prot",
  "otype",
  ").",
];
const ANSWER = TOKENS.join("");

type Delta = Record<string, string>;
const CASES: Record<string, Delta[]> = {
  plain: TOKENS.map((content) => ({ content })),
  "empty-reasoning": TOKENS.map((content) => ({ content, reasoning_content: "" })),
  "reasoning-between": TOKENS.flatMap((content, index): Delta[] =>
    index % 4 === 1 ? [{ reasoning_content: "hmm" }, { content }] : [{ content }],
  ),
  "endpoint-spaces": TOKENS.map((content, index) => ({ content: index === 0 ? content : ` ${content.trimStart()}` })),
};
/** What the control case sends: the space in "B aca" comes from the endpoint, and stays. */
const SPACED = (CASES["endpoint-spaces"] ?? []).map((delta) => delta.content).join("");

function stream(response: ServerResponse, deltas: readonly Delta[]): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = (delta: unknown, finish: string | null) =>
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  response.write(chunk({ role: "assistant", content: "" }, null));
  for (const delta of deltas) response.write(chunk(delta, null));
  response.write(chunk({}, "stop"));
  response.write("data: [DONE]\n\n");
  response.end();
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.on("data", (part) => {
    body += part;
  });
  request.on("end", () => {
    if (!request.url?.endsWith("/chat/completions")) return void response.writeHead(404).end();
    const name = Object.keys(CASES).find((key) => body.includes(`case:${key}`));
    // OpenCode's title request also holds the prompt, so it gets the stream of the same case.
    stream(response, name ? (CASES[name] ?? []) : [{ content: "Title" }]);
  });
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object", "the fake server has no port");

const context = {
  apiKey: () => null,
  customProviders: () => [
    {
      id: PROVIDER,
      name: "Token endpoint",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: "test-key",
      models: [{ id: MODEL, name: "Token model" }],
      headers: [],
    },
  ],
  mcpServers: () => [],
};

interface ItemEvent {
  method: string;
  id: string | null;
  phase: string | null;
  text: string | null;
}
interface CaseReport {
  name: string;
  events: ItemEvent[];
  answers: string[];
  answer: string;
  error: string | null;
}
const report: { binary: string; expected: string; cases: CaseReport[]; result?: "pass" | "fail"; error?: string } = {
  binary,
  expected: ANSWER,
  cases: [],
};
const clients: AgentClient[] = [];

try {
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const driver = requireProviderDriver("opencode");
  const cli = { executable: binary, version: "test", source: "system" as const };
  const client = driver.createClient(cli, 60_000, context, undefined);
  clients.push(client);
  client.start();
  for (const name of Object.keys(CASES)) {
    const thread = await startThread(client, { cwd: workspace, model: `${PROVIDER}/${MODEL}` });
    const events: ItemEvent[] = [];
    const listener = (notification: { method: string; params?: unknown }) => {
      if (!notification.method.startsWith("item/") || !isRecord(notification.params)) return;
      if (getString(notification.params, "threadId") !== thread) return;
      const item = isRecord(notification.params.item) ? notification.params.item : null;
      events.push({
        method: notification.method,
        id: item ? getString(item, "id") : getString(notification.params, "itemId"),
        phase: item ? getString(item, "phase") : null,
        text: item ? getString(item, "text") : getString(notification.params, "delta"),
      });
    };
    client.on("notification", listener);
    const turn = await runTurn(client, thread, { text: `case:${name}`, timeoutMs: 60_000 });
    client.off("notification", listener);
    const answers = events
      .filter((event) => event.method === "item/completed" && event.phase !== "commentary" && event.text)
      .map((event) => event.text ?? "");
    report.cases.push({ name, events, answers, answer: answers.join(""), error: turn.error });
    assert.equal(turn.error, null, `${name}: the turn failed`);
    if (name === "endpoint-spaces") {
      assert.deepEqual(answers, [SPACED], `${name}: the answer keeps the endpoint's own spaces`);
      continue;
    }
    assert.deepEqual(answers, [ANSWER], `${name}: the answer is one item with whole words`);
    if (name === "reasoning-between") {
      const thoughts = events.filter((event) => event.method === "item/completed" && event.phase === "commentary");
      assert.ok(thoughts.length > 0, `${name}: the reasoning stays a thought`);
      assert.ok(
        thoughts.every((event) => event.id?.includes(":thought")),
        `${name}: no answer text becomes commentary`,
      );
    }
  }
  report.result = "pass";
} catch (error) {
  report.result = "fail";
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await stopClients(clients);
  server.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`PASS opencode-token-stream-e2e: ${join(OUT, "report.json")}\n`);
