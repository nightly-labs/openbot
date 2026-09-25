import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TraceFile } from "./trace-file";

// Failure modes: a secret in a status word reaches the file; a line holds more than the four span
// fields; a cut-off line from a crash breaks the summary; a turn with no start is recorded.
describe("TraceFile", () => {
  let directory = "";
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("writes only redacted span fields and summarizes them past a cut-off line", async () => {
    directory = await mkdtemp(join(tmpdir(), "openbot-trace-"));
    const trace = new TraceFile({ directory });
    trace.record({ kind: "ipc", name: "agent:send", durationMs: 12.4, outcome: "ok" });
    trace.record({ kind: "ipc", name: "agent:send", durationMs: 30, outcome: "error" });
    trace.observeAgentEvent({
      type: "turn-completed",
      agentId: "a",
      threadId: "t",
      turnId: "orphan",
      status: "completed",
    });
    trace.observeAgentEvent({ type: "turn-started", agentId: "a", threadId: "t", turnId: "turn-1", origin: "user" });
    trace.observeAgentEvent({
      type: "turn-completed",
      agentId: "a",
      threadId: "t",
      turnId: "turn-1",
      status: "failed token=sk-live-abcdefgh1234",
    });
    await trace.flush();

    const path = join(directory, "trace.ndjson");
    const text = await readFile(path, "utf8");
    expect(text).not.toContain("sk-live-abcdefgh1234");
    const lines = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(Object.keys(line).sort()).toEqual(["at", "durationMs", "kind", "name", "outcome"]);

    await writeFile(path, `${text}{"kind":"ipc","name":"agent:se`);
    const summary = await trace.summarize();
    expect(summary.map(({ kind, name, count, outcomes, maxMs }) => ({ kind, name, count, outcomes, maxMs }))).toEqual([
      { kind: "ipc", name: "agent:send", count: 2, outcomes: { ok: 1, error: 1 }, maxMs: 30 },
      { kind: "turn", name: "user", count: 1, outcomes: { "failed token=[redacted]": 1 }, maxMs: lines[2].durationMs },
    ]);
  });
});
