// Runs OpenBot's own provider driver against each recorded transcript of a real CLI in
// `scripts/provider-fakes/transcripts/`, replayed by `agents/replay.ts`. A fake that we write
// ourselves agrees with the driver by construction; a recording shows what the released CLI really
// sends. Checks that a thread starts and a turn completes with the recorded answer, and that the
// driver sends the requests that it sent to the real CLI, in the same order: a driver change that
// sends a request the CLI never answered, or skips one, fails here before it reaches users.
//
// A deliberate driver change records the transcript again: `record-provider-transcript.ts`.
// `bun run test:provider-transcript-replay`. Writes .openbot-build/provider-transcript-replay-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentClient } from "../src/backend/agent-client";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";
import type { TranscriptLine } from "./provider-fakes/transcript-proxy";
import { REDACTED } from "./provider-fakes/transcript-redaction";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-transcript-replay-e2e");
const TRANSCRIPTS = resolve(import.meta.dirname, "provider-fakes/transcripts");

interface Header {
  provider: string;
  version: string;
  model: string;
}

interface LogEntry {
  event: "request" | "unmatched";
  method: string;
}

interface Result {
  transcript: string;
  provider: string;
  version: string;
  requests: number;
  reply: string;
}

const report: { passed: boolean; results: Result[]; error?: string } = { passed: false, results: [] };
const root = await mkdtemp(join(tmpdir(), "openbot-transcript-replay-e2e-"));
const clients: AgentClient[] = [];

try {
  const files = (await readdir(TRANSCRIPTS)).filter((file) => file.endsWith(".jsonl")).sort();
  assert.ok(files.length > 0, "At least one transcript is recorded.");
  for (const file of files) {
    const path = join(TRANSCRIPTS, file);
    const [first = "", ...rest] = (await readFile(path, "utf8")).split("\n").filter(Boolean);
    const header: Header = JSON.parse(first);
    const provider = header.provider;
    assert.ok(isAgentProvider(provider), `${file} names a built-in provider.`);
    const recorded = rest
      .map((line): TranscriptLine => JSON.parse(line))
      .flatMap((line) => {
        const { message } = line;
        const method = message !== null && typeof message === "object" && "method" in message ? message.method : null;
        const isRequest = line.from === "client" && message !== null && typeof message === "object" && "id" in message;
        return isRequest && typeof method === "string" ? [method] : [];
      });

    const name = file.replace(/\.jsonl$/, "");
    const executable = join(root, name, "bin", provider);
    const workspace = join(root, name, "workspace");
    const log = join(root, name, "replay.jsonl");
    await mkdir(workspace, { recursive: true });
    await installFakeAgent(executable, "replay");
    process.env.TRANSCRIPT = path;
    process.env.FAKE_LOG = log;

    const client = requireProviderDriver(provider).createClient(
      { executable, version: header.version, source: "managed" },
      20_000,
      NO_PROVIDER_CREDENTIALS,
    );
    clients.push(client);
    client.start();
    const thread = await startThread(client, { cwd: workspace, model: header.model });
    const turn = await runTurn(client, thread, {
      model: header.model,
      text: "Reply with the word OK and nothing else.",
    });
    await stopClients([client]);

    const entries = await readJsonl<LogEntry>(log);
    const unmatched = entries.filter((entry) => entry.event === "unmatched").map((entry) => entry.method);
    assert.deepEqual(unmatched, [], `${file}: the driver sends no request that the CLI did not answer.`);
    assert.equal(turn.error, null, `${file}: the turn completes with no error.`);
    assert.equal(turn.reply, REDACTED, `${file}: the turn shows the recorded answer.`);
    assert.deepEqual(
      entries.map((entry) => entry.method),
      recorded,
      `${file}: the driver sends the recorded requests in the recorded order.`,
    );
    report.results.push({
      transcript: file,
      provider,
      version: header.version,
      requests: recorded.length,
      reply: turn.reply,
    });
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
}
