// Checks the start import of a Claude Code transcript after a full read (#7686). Runs the real
// Claude history reader, the provider history importer and SQLite on a temporary profile, with a
// transcript of many turns. No app, provider, account or network is started.
//
// The starts:
// 1. The first import reads all turns.
// 2. The next start with an unchanged transcript reads all turns again and saves its turn list.
// 3. A start with an unchanged transcript sends only the newest turn.
// 4. New turns, made while OpenBot was closed, import.
// 5. A rewind: a new prompt answers from inside an older turn, so later turns leave the branch. The
//    turn list changed, so the read sends all the turns of the new branch, and the new turn imports.
// 6. A rewritten transcript reads all turns, and its turns import.
// Each start keeps every earlier answer in the chat.
//
// Run: bun scripts/claude-history-resume-e2e.ts
// Writes .openbot-build/claude-history-resume-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Effect } from "effect";
import { AgentStore } from "../src/backend/agent-store";
import { claudeHistoryReader } from "../src/backend/claude-history";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { importProviderHistory } from "../src/backend/provider-history-import";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-history-resume-e2e");
const TURNS = 200;
const SESSION = "11111111-2222-4333-8444-555555555555";
const PROJECT = "-tmp-resume-project";

interface Start {
  label: string;
  sentTurns: number;
  chatMessages: number;
  ms: number;
}

const report: { turns: number; starts: Start[]; passed: boolean; error?: string } = {
  turns: TURNS,
  starts: [],
  passed: false,
};

/** One line of a Claude Code transcript, without the fields that every line has. */
interface TranscriptRecord {
  type: "user" | "assistant";
  uuid: string;
  message: { role: "user" | "assistant"; content: unknown; [field: string]: unknown };
}

let parent: string | null = null;
let clock = Date.parse("2026-11-01T08:00:00.000Z");

/** Claude Code records of `count` turns: a prompt, three tool calls and a final answer each. */
function turns(prefix: string, count: number): string {
  const lines: string[] = [];
  const push = (record: TranscriptRecord) => {
    clock += 1000;
    lines.push(
      JSON.stringify({
        parentUuid: parent,
        isSidechain: false,
        sessionId: SESSION,
        cwd: "/tmp/resume-project",
        timestamp: new Date(clock).toISOString(),
        ...record,
      }),
    );
    parent = record.uuid;
  };
  for (let index = 0; index < count; index += 1) {
    const turn = `${prefix}${index}`;
    push({ type: "user", uuid: `u-${turn}`, message: { role: "user", content: `Prompt ${turn}` } });
    for (let tool = 0; tool < 3; tool += 1) {
      const id = `toolu_${turn}_${tool}`;
      push({
        type: "assistant",
        uuid: `a-${turn}-${tool}`,
        message: {
          id: `msg_${turn}_${tool}`,
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [{ type: "tool_use", id, name: "Read", input: { file_path: `/tmp/resume-project/${tool}.ts` } }],
          stop_reason: "tool_use",
        },
      });
      push({
        type: "user",
        uuid: `r-${turn}-${tool}`,
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "file text" }] },
      });
    }
    push({
      type: "assistant",
      uuid: `a-${turn}-final`,
      message: {
        id: `msg_${turn}_final`,
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: `Answer ${turn}` }],
        stop_reason: "end_turn",
      },
    });
  }
  return `${lines.join("\n")}\n`;
}

async function run(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openbot-claude-history-resume-"));
  const projectDirectory = join(root, "claude", "projects", PROJECT);
  mkdirSync(projectDirectory, { recursive: true });
  const transcript = join(projectDirectory, `${SESSION}.jsonl`);
  const database = new OpenBotDatabase(join(root, "state"));
  try {
    const agentStore = new AgentStore(join(root, "state"), join(root, "home"), database);
    await runCauseEffect(agentStore.initialize());
    const agent = await runCauseEffect(agentStore.getOrCreate("resume-agent", "Resume agent", "Resume agent"));
    const threadId = await runCauseEffect(agentStore.ensureThreadId(agent.id));
    const readHistory = claudeHistoryReader({
      configDirectory: join(root, "claude"),
      projectDirectoryName: PROJECT,
      indexDirectory: join(root, "index"),
    });
    const answers = () =>
      database
        .readConversation(agent.id, threadId)
        .messages.map((message) => message.text)
        .filter((text) => text.startsWith("Answer "));
    const start = async (label: string): Promise<Start> => {
      const began = performance.now();
      const result = await Effect.runPromise(
        importProviderHistory({
          database,
          readHistory: (request, consume) =>
            readHistory(request, (fragment) => {
              if (fragment.complete) sent += 1;
              return consume(fragment);
            }),
          sessionId: "resume-session",
          provider: "claude",
          externalSessionId: SESSION,
          agentId: agent.id,
          publicThreadId: threadId,
          cwd: "/tmp/resume-project",
          findDelivery: () => null,
          findMessageDelivery: () => null,
          quietRoutineDelivery: () => false,
        }),
      );
      const entry = {
        label,
        sentTurns: sent,
        chatMessages: answers().length,
        ms: Math.round(performance.now() - began),
      };
      sent = 0;
      report.starts.push(entry);
      assert.ok(result.turns <= entry.sentTurns);
      return entry;
    };
    let sent = 0;

    writeFileSync(transcript, turns("t", TURNS));
    assert.equal((await start("first import")).sentTurns, TURNS);
    assert.equal(answers().length, TURNS);
    assert.equal((await start("unchanged, saves the turn list")).sentTurns, TURNS);
    const unchanged = await start("unchanged, resumes");
    assert.equal(unchanged.sentTurns, 1, "an unchanged transcript sends only the newest turn");
    assert.equal(unchanged.chatMessages, TURNS, "the chat keeps every answer");

    appendFileSync(transcript, turns("n", 5));
    const added = await start("five new turns");
    assert.equal(added.sentTurns, 6, "the newest earlier turn and the five new turns are sent");
    assert.ok(answers().includes("Answer n4"), "a turn made while OpenBot was closed imports");
    assert.equal(added.chatMessages, TURNS + 5);

    parent = `a-t${TURNS - 10}-final`;
    appendFileSync(transcript, turns("fork", 1));
    const fork = await start("rewind to an older turn");
    assert.ok(fork.sentTurns > 1, "a changed branch sends all of its turns");
    assert.ok(answers().includes("Answer fork0"), "the turn of the new branch imports");
    assert.equal(fork.chatMessages, TURNS + 6, "the chat keeps the answers of the earlier branch");

    parent = null;
    writeFileSync(transcript, turns("rewritten", 3));
    const rewritten = await start("rewritten transcript");
    assert.equal(rewritten.sentTurns, 3, "a rewritten transcript sends all of its turns");
    assert.ok(answers().includes("Answer rewritten2"), "the rewritten turns import");
    report.passed = true;
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const entry of report.starts) {
    process.stdout.write(
      `${entry.label}: ${entry.sentTurns} turns sent, ${entry.chatMessages} answers, ${entry.ms} ms\n`,
    );
  }
  process.stdout.write(report.passed ? "PASS\n" : `FAIL: ${report.error ?? "unknown"}\n`);
}
