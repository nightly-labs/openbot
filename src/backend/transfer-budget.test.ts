import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentService } from "./agent-service";
import { startAgentTestFixture, startService, stopAgentTestFixture, waitFor } from "./agent-service-test-harness";

// Hard caps for one conversation, about 30% above the values measured when each cap was set. A red
// test means a change made a turn or a read do more work. Make the change cheaper, or raise the cap
// in the same pull request and say why. `.openbot-build/transfer-budget.json` has the measured values.
const BUDGETS = {
  /** SQL statements from `sendMessage` to the completed delivery, for the first turn of a thread. */
  firstTurnStatements: 320,
  /** The same for a later turn on the same thread. */
  laterTurnStatements: 360,
  /** SQL statements for one `readConversation` after two turns. */
  readConversationStatements: 4,
  /** JSON bytes of the `readConversation` answer after two turns. */
  conversationSnapshotBytes: 1_800,
  /** JSON bytes of every `AgentEvent` that one later turn sends to the renderer. */
  laterTurnEventBytes: 18_000,
};

const REPORT_PATH = resolve(import.meta.dirname, "../../.openbot-build/transfer-budget.json");

let root: string;
let service: AgentService | null = null;
beforeEach(async () => {
  ({ root } = await startAgentTestFixture());
});
afterEach(async () => {
  vi.restoreAllMocks();
  await stopAgentTestFixture(root, service);
  service = null;
});

describe("transfer budget", () => {
  it("keeps one conversation within its SQL statement and payload caps", async () => {
    // A spy calls through to SQLite and counts each statement that runs.
    const spies = [
      vi.spyOn(StatementSync.prototype, "run"),
      vi.spyOn(StatementSync.prototype, "get"),
      vi.spyOn(StatementSync.prototype, "all"),
      vi.spyOn(StatementSync.prototype, "iterate"),
      vi.spyOn(DatabaseSync.prototype, "exec"),
    ];
    const resetStatements = () => {
      for (const spy of spies) spy.mockClear();
    };
    const statements = () => spies.reduce((total, spy) => total + spy.mock.calls.length, 0);

    const started = await startService(root, { provider: "codex" });
    service = started.service;
    const events: AgentEvent[] = [];
    service.on("event", (event) => events.push(event));
    const measured: typeof BUDGETS = {
      firstTurnStatements: 0,
      laterTurnStatements: 0,
      readConversationStatements: 0,
      conversationSnapshotBytes: 0,
      laterTurnEventBytes: 0,
    };

    const turn = async (index: number, text: string) => {
      resetStatements();
      events.length = 0;
      await started.service.sendMessage({ agentId: "chief", text });
      await waitFor(() => started.service.listQueue("chief").deliveries[index]?.status === "completed");
      return { statements: statements(), eventBytes: jsonBytes(events) };
    };
    measured.firstTurnStatements = (await turn(0, "Summarize the week.")).statements;
    const later = await turn(1, "Now list three risks.");
    measured.laterTurnStatements = later.statements;
    measured.laterTurnEventBytes = later.eventBytes;

    resetStatements();
    const snapshot = await service.readConversation("chief");
    measured.readConversationStatements = statements();
    measured.conversationSnapshotBytes = jsonBytes(snapshot);

    await mkdir(join(REPORT_PATH, ".."), { recursive: true });
    await writeFile(REPORT_PATH, `${JSON.stringify({ measured, budgets: BUDGETS }, null, 2)}\n`);
    expect(measured.firstTurnStatements).toBeLessThanOrEqual(BUDGETS.firstTurnStatements);
    expect(measured.laterTurnStatements).toBeLessThanOrEqual(BUDGETS.laterTurnStatements);
    expect(measured.readConversationStatements).toBeLessThanOrEqual(BUDGETS.readConversationStatements);
    expect(measured.conversationSnapshotBytes).toBeLessThanOrEqual(BUDGETS.conversationSnapshotBytes);
    expect(measured.laterTurnEventBytes).toBeLessThanOrEqual(BUDGETS.laterTurnEventBytes);
  });
});

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
