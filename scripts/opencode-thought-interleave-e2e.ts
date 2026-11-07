// Runs turns on the real OpenCode driver against a fake `opencode acp` that streams thoughts between
// the sub-word tokens of one answer, as OpenCode does for such an endpoint (#3351). Checks that the
// answer stays one item with whole words, that a harness error report still ends the partial answer,
// so the retried answer replaces it (#1471), and that two reasoning parts of one message stay apart
// in a live turn and in a `session/load` replay (#5481).
// `bun run test:opencode-thought-interleave`. Writes .openbot-build/opencode-thought-interleave-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import type { ProviderHistoryFragment } from "../src/backend/provider-history";
import { installFakeAgent, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-thought-interleave-e2e");

interface CompletedItem {
  phase: string | null;
  text: string | null;
}

interface Report {
  passed: boolean;
  turns: Record<string, CompletedItem[]>;
  /** The texts of the items that a `session/load` replays. */
  replayed?: string[];
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-thought-interleave-e2e-"));
const report: Report = { passed: false, turns: {} };
const clients: AgentClient[] = [];

/** The completed agent items of one turn, in order. */
async function turnItems(client: AgentClient, thread: string, text: string): Promise<CompletedItem[]> {
  const items: CompletedItem[] = [];
  const listener = (notification: { method: string; params?: unknown }) => {
    if (notification.method !== "item/completed" || !isRecord(notification.params)) return;
    if (getString(notification.params, "threadId") !== thread || !isRecord(notification.params.item)) return;
    items.push({
      phase: getString(notification.params.item, "phase"),
      text: getString(notification.params.item, "text"),
    });
  };
  client.on("notification", listener);
  try {
    const turn = await runTurn(client, thread, { text });
    assert.equal(turn.error, null, `${text}: the turn failed`);
  } finally {
    client.off("notification", listener);
  }
  return items;
}

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const executable = join(root, "opencode", "bin", "opencode");
  await installFakeAgent(executable, "opencode-thought-interleave");
  const cli: AgentCliInfo = { executable, version: "2.1.4", source: "managed" };
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  const thread = await startThread(client, { cwd: workspace });

  const interleaved = await turnItems(client, thread, "interleave");
  report.turns.interleave = interleaved;
  assert.deepEqual(
    interleaved.filter((item) => item.phase === "final_answer").map((item) => item.text),
    ["Baca gambar. Gambar: tabel Rencana (prototype)."],
    "The answer is one item with whole words.",
  );
  assert.ok(
    interleaved.filter((item) => item.phase === "commentary").every((item) => /^(?:hmm)+$/u.test(item.text ?? "")),
    "Only the thoughts are commentary.",
  );

  const harness = await turnItems(client, thread, "harness");
  report.turns.harness = harness;
  assert.deepEqual(
    harness.filter((item) => item.phase === "final_answer").map((item) => item.text),
    ["Full answer."],
    "The retried answer replaces the partial answer.",
  );

  // The live delta of a new part carries the break too, so a client that streams the thought shows it.
  // The fake sends the second part as one chunk, so its break and its text arrive in one delta.
  const partDeltas: string[] = [];
  const onDelta = (notification: { method: string; params?: unknown }) => {
    if (notification.method !== "item/agentMessage/delta" || !isRecord(notification.params)) return;
    if (getString(notification.params, "threadId") !== thread) return;
    const delta = getString(notification.params, "delta");
    if (delta !== null) partDeltas.push(delta);
  };
  client.on("notification", onDelta);
  let parts: CompletedItem[];
  try {
    parts = await turnItems(client, thread, "parts");
  } finally {
    client.off("notification", onDelta);
  }
  report.turns.parts = parts;
  assert.ok(partDeltas.includes("\n\n**Checking notes**"), "The delta of the second part starts with the break.");
  assert.deepEqual(
    parts.filter((item) => item.phase === "commentary").map((item) => item.text),
    ["**Scanning files**\n\n**Checking notes**"],
    "Two reasoning parts of one message are two paragraphs.",
  );

  // A `session/load` of the same session replays the two parts, and they must stay apart there too.
  const replayed: ProviderHistoryFragment[] = [];
  assert.ok(client.readHistory, "The OpenCode driver reads history.");
  await runCauseEffect(
    client.readHistory({ threadId: "thread-to-load", cwd: workspace, items: "full" }, (fragment) =>
      Effect.sync(() => {
        replayed.push(fragment);
        return true;
      }),
    ),
  );
  report.replayed = replayed.flatMap((fragment) => fragment.items.map((item) => item.text ?? ""));
  assert.deepEqual(
    replayed
      .flatMap((fragment) => fragment.items)
      .filter((item) => item.phase === "commentary")
      .map((item) => item.text),
    ["**Scanning files**\n\n**Checking notes**"],
    "A replay keeps the two reasoning parts apart.",
  );

  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`PASS opencode-thought-interleave-e2e: ${join(OUT, "report.json")}\n`);
