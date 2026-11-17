// Real Node history process, unchanged scanner and SQLite importer. No provider or network calls.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Effect } from "effect";
import { AgentStore } from "../src/backend/agent-store";
import { claudeHistoryIndexPath, claudeHistoryReader } from "../src/backend/claude-history";
import {
  type ClaudeHistoryHostProcess,
  decodeClaudeHistoryHostMessage,
} from "../src/backend/claude-history-host-protocol";
import { ClaudeHistorySupervisor } from "../src/backend/claude-history-supervisor";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { providerFailure } from "../src/backend/provider-client-effects";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import type { ProviderHistoryFragment } from "../src/backend/provider-history";
import { importProviderHistory } from "../src/backend/provider-history-import";

const project = process.env.OPENBOT_HISTORY_HOST_ROOT ?? resolve(import.meta.dirname, "..");
const output = join(project, ".openbot-build", "claude-history-host-e2e");
const report: { passed: boolean; checks: string[]; workerPids: number[]; error?: string } = {
  passed: false,
  checks: [],
  workerPids: [],
};

async function fixture(): Promise<void> {
  const root = mkdtempSync(join(output, "run-"));
  const configDirectory = join(root, "claude");
  const transcriptDirectory = join(configDirectory, "projects", "-fixture-history");
  mkdirSync(transcriptDirectory, { recursive: true });
  const session = "11111111-2222-4333-8444-555555555555";
  const transcript = join(transcriptDirectory, `${session}.jsonl`);
  const options = { configDirectory, projectDirectoryName: "-fixture-history", indexDirectory: join(root, "index") };
  const processes: Array<{
    pid: number;
    exited: Promise<void>;
    running: boolean;
    threads: Set<string>;
    fragments: number;
    pending: number;
    maxPending: number;
    kill(): void;
  }> = [];
  const spawnHost = (): ClaudeHistoryHostProcess => {
    const child = spawn(process.execPath, [join(output, "claude-history-host.mjs")], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    assert.ok(child.pid);
    const exited = Promise.withResolvers<void>();
    const entry = {
      pid: child.pid,
      exited: exited.promise,
      running: true,
      threads: new Set<string>(),
      fragments: 0,
      pending: 0,
      maxPending: 0,
      kill: () => {
        child.kill();
      },
    };
    processes.push(entry);
    child.once("exit", () => {
      entry.running = false;
      exited.resolve();
    });
    return {
      send: (request) => {
        if (request.kind === "ack") entry.pending -= 1;
        else entry.threads.add(request.request.threadId);
        child.stdin.write(`${JSON.stringify(request)}\n`);
      },
      onMessage: (listener) => {
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
          const value = decodeClaudeHistoryHostMessage(JSON.parse(line));
          assert.ok(value);
          if (value.kind === "ready") {
            assert.notEqual(value.pid, process.pid);
            report.workerPids.push(value.pid);
          }
          if (value.kind === "fragment") {
            entry.fragments += 1;
            entry.pending += 1;
            entry.maxPending = Math.max(entry.maxPending, entry.pending);
            assert.ok(value.fragment.items.length <= 50, "The worker retains the scanner's fragment item bound.");
          }
          listener(value);
        });
      },
      onExit: (listener) => {
        child.once("exit", () => listener());
        child.once("error", () => listener());
      },
      kill: () => {
        child.kill();
      },
    };
  };
  const supervisor = new ClaudeHistorySupervisor({ spawnHost });
  const reader = supervisor.reader(options);
  const database = new OpenBotDatabase(join(root, "profile"));
  let parent: string | null = null;
  let tick = 0;
  function turns(prefix: string, count: number): string {
    const lines: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const name = `${prefix}-${index}`;
      for (const [type, uuid, content] of [
        ["user", `u-${name}`, `Prompt ${name}`],
        ["assistant", `a-${name}`, `Answer ${name}`],
      ] as const) {
        lines.push(
          JSON.stringify({
            type,
            uuid,
            parentUuid: parent,
            sessionId: session,
            isSidechain: false,
            timestamp: new Date(Date.UTC(2026, 10, 1) + ++tick * 1000).toISOString(),
            message: { role: type, content: [{ type: "text", text: content }] },
          }),
        );
        parent = uuid;
      }
    }
    return `${lines.join("\n")}\n`;
  }
  try {
    const store = new AgentStore(database.userDataPath, join(root, "home"), database);
    await runCauseEffect(store.initialize());
    const agent = await runCauseEffect(store.getOrCreate("history-worker-agent", "History worker", "Fixture"));
    const threadId = await runCauseEffect(store.ensureThreadId(agent.id));
    const answers = () =>
      database.readConversation(agent.id, threadId).messages.filter((entry) => entry.text.startsWith("Answer "));
    async function start() {
      let sent = 0;
      await Effect.runPromise(
        importProviderHistory({
          database,
          readHistory: (request, consume) =>
            reader(request, (fragment) => {
              if (fragment.complete) sent += 1;
              return consume(fragment);
            }),
          sessionId: "history-worker-session",
          provider: "claude",
          externalSessionId: session,
          agentId: agent.id,
          publicThreadId: threadId,
          findDelivery: () => null,
          findMessageDelivery: () => null,
          quietRoutineDelivery: () => false,
        }),
      );
      return sent;
    }
    writeFileSync(transcript, turns("initial", 40));
    assert.equal(await start(), 40);
    assert.equal(await start(), 40);
    assert.equal(await start(), 1);
    assert.equal(answers().length, 40);
    appendFileSync(transcript, turns("added", 3));
    assert.equal(await start(), 4);
    assert.equal(answers().length, 43);
    parent = "a-initial-30";
    appendFileSync(transcript, turns("branch", 1));
    assert.ok((await start()) > 1);
    assert.equal(answers().length, 44);
    parent = null;
    writeFileSync(transcript, turns("rewritten", 4));
    assert.equal(await start(), 4);
    assert.equal(answers().length, 48);
    report.checks.push(
      "A real background process and SQLite importer preserve full import, unchanged resume, append, branch rewind, rewritten transcript and retained old answers.",
    );

    const local: ProviderHistoryFragment[] = [];
    const background: ProviderHistoryFragment[] = [];
    await Effect.runPromise(
      claudeHistoryReader({ ...options, indexDirectory: join(root, "local-index") })(
        { threadId: session, items: "full" },
        (fragment) =>
          Effect.sync(() => {
            local.push(fragment);
            return true;
          }),
      ),
    );
    await Effect.runPromise(
      reader({ threadId: session, items: "full" }, (fragment) =>
        Effect.sync(() => {
          background.push(fragment);
          return true;
        }),
      ),
    );
    assert.deepEqual(background, local);
    report.checks.push(
      "Background fragments exactly match the unchanged local scanner, including ordering and completion metadata.",
    );

    let stopped = 0;
    await Effect.runPromise(
      reader({ threadId: session, items: "full", resumeKey: "stop-key" }, () =>
        Effect.sync(() => {
          stopped += 1;
          return false;
        }),
      ),
    );
    assert.equal(stopped, 1);
    const stoppedResume: ProviderHistoryFragment[] = [];
    await Effect.runPromise(
      reader({ threadId: session, items: "full", resumeKey: "stop-key" }, (fragment) =>
        Effect.sync(() => {
          stoppedResume.push(fragment);
          return true;
        }),
      ),
    );
    assert.equal(
      stoppedResume.filter((fragment) => fragment.complete).length,
      4,
      "Consumer stop must not advance its resume point.",
    );
    report.checks.push("Consumer false stops after one fragment and never advances the scanner's resume point.");

    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let secondConsumed = false;
    const gated = Effect.runPromise(
      reader({ threadId: session, items: "full" }, () =>
        Effect.promise(async () => {
          entered.resolve();
          await release.promise;
          return false;
        }),
      ),
    );
    await entered.promise;
    const second = Effect.runPromise(
      reader({ threadId: session, items: "none" }, () =>
        Effect.sync(() => {
          secondConsumed = true;
          return true;
        }),
      ),
    );
    assert.equal(secondConsumed, false);
    assert.equal(processes.length, 1, "Repeated scans of one derived index reuse one persistent process.");
    release.resolve();
    await Promise.all([gated, second]);
    assert.equal(secondConsumed, true);
    assert.equal(processes[0]?.maxPending, 1, "No second fragment is sent while the parent consumes one.");
    report.checks.push(
      "Concurrent scans serialize in one persistent child; one-fragment acknowledgements enforce backpressure.",
    );

    const consumerFailure = new Error("Private consumer failure stays in main.");
    await assert.rejects(
      runCauseEffect(
        reader({ threadId: session, items: "full", resumeKey: "failed-key" }, () =>
          Effect.fail(providerFailure(consumerFailure)),
        ),
      ),
      (failure) => failure === consumerFailure,
    );
    await processes[0]?.exited;
    let afterFailure = 0;
    await Effect.runPromise(
      reader({ threadId: session, items: "full", resumeKey: "failed-key" }, (fragment) =>
        Effect.sync(() => {
          if (fragment.complete) afterFailure += 1;
          return true;
        }),
      ),
    );
    assert.equal(afterFailure, 4);
    report.checks.push(
      "A failed parent consumer retains its original cause, kills only its own child and saves no unacknowledged cursor; a new explicit scan reads all turns.",
    );

    const cancellation = new AbortController();
    const cancellationEntered = Promise.withResolvers<void>();
    const cancelled = Effect.runPromise(
      reader({ threadId: session, items: "full", resumeKey: "cancelled-key" }, () =>
        Effect.callback<boolean>(() => {
          cancellationEntered.resolve();
        }),
      ),
      { signal: cancellation.signal },
    );
    await cancellationEntered.promise;
    cancellation.abort();
    await assert.rejects(cancelled);
    await processes.at(-1)?.exited;
    let afterCancel = 0;
    await Effect.runPromise(
      reader({ threadId: session, items: "full", resumeKey: "cancelled-key" }, (fragment) =>
        Effect.sync(() => {
          if (fragment.complete) afterCancel += 1;
          return true;
        }),
      ),
    );
    assert.equal(afterCancel, 4);
    report.checks.push(
      "Cancelling an active scan terminates only its owned process before a later scan can open that index, preserving its cursor.",
    );

    const laneFor = (id: string) => {
      const path = claudeHistoryIndexPath(options, id);
      const key = process.platform === "win32" ? path.toLowerCase() : path;
      return (createHash("sha256").update(key).digest()[0] ?? 0) % 4;
    };
    let otherSession = "other-history-0";
    for (let index = 1; laneFor(otherSession) === laneFor(session); index += 1) otherSession = `other-history-${index}`;
    writeFileSync(
      join(transcriptDirectory, `${otherSession}.jsonl`),
      readFileSync(transcript, "utf8").replaceAll(session, otherSession),
    );
    const aliasSession = session.replaceAll("-", "_");
    assert.equal(claudeHistoryIndexPath(options, session), claudeHistoryIndexPath(options, aliasSession));
    writeFileSync(
      join(transcriptDirectory, `${aliasSession}.jsonl`),
      readFileSync(transcript, "utf8").replaceAll(session, aliasSession),
    );
    const firstEntered = Promise.withResolvers<void>();
    const otherEntered = Promise.withResolvers<void>();
    const otherRelease = Promise.withResolvers<void>();
    const firstCancel = new AbortController();
    const firstScan = Effect.runPromise(
      reader({ threadId: session, items: "full" }, () =>
        Effect.callback<boolean>(() => {
          firstEntered.resolve();
        }),
      ),
      { signal: firstCancel.signal },
    );
    await firstEntered.promise;
    let aliasConsumed = false;
    const aliasScan = Effect.runPromise(
      reader({ threadId: aliasSession, items: "full" }, () =>
        Effect.sync(() => {
          aliasConsumed = true;
          return false;
        }),
      ),
    );
    const otherScan = Effect.runPromise(
      reader({ threadId: otherSession, items: "full" }, () =>
        Effect.promise(async () => {
          otherEntered.resolve();
          await otherRelease.promise;
          return false;
        }),
      ),
    );
    await otherEntered.promise;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(aliasConsumed, false, "Main timers still run while two background consumers remain blocked.");
    assert.equal(aliasConsumed, false, "Different transcript names that sanitize to one index stay serialized.");
    const firstProcess = processes.find((entry) => entry.running && entry.threads.has(session));
    const otherProcess = processes.find((entry) => entry.running && entry.threads.has(otherSession));
    assert.ok(firstProcess && otherProcess);
    assert.notEqual(firstProcess.pid, otherProcess.pid);
    firstCancel.abort();
    await assert.rejects(firstScan);
    await firstProcess.exited;
    await aliasScan;
    assert.equal(aliasConsumed, true);
    assert.equal(otherProcess.running, true, "Cancelling one lane must not end another lane's blocked scan.");
    otherRelease.resolve();
    await otherScan;
    report.checks.push(
      "Independent indexes reach blocked consumers concurrently in different processes; sanitized aliases serialize; cancelling one lane preserves the other lane.",
    );

    const lossEntered = Promise.withResolvers<void>();
    const consumerInterrupted = Promise.withResolvers<void>();
    const lost = Effect.runPromise(
      reader({ threadId: session, items: "full", resumeKey: "lost-host-key" }, () =>
        Effect.callback<boolean>(() => {
          lossEntered.resolve();
        }).pipe(Effect.ensuring(Effect.sync(() => consumerInterrupted.resolve()))),
      ),
    );
    await lossEntered.promise;
    const lostProcess = processes.find((entry) => entry.running && entry.threads.has(session));
    assert.ok(lostProcess);
    lostProcess.kill();
    await assert.rejects(lost);
    await consumerInterrupted.promise;
    let afterLoss = 0;
    await Effect.runPromise(
      reader({ threadId: session, items: "full", resumeKey: "lost-host-key" }, (fragment) =>
        Effect.sync(() => {
          if (fragment.complete) afterLoss += 1;
          return true;
        }),
      ),
    );
    assert.equal(afterLoss, 4);
    report.checks.push(
      "Worker death interrupts the blocked main consumer, advances no unacknowledged cursor and never retries the failed scan.",
    );

    let driverFactories = 0;
    const driverIndex = join(root, "driver-index");
    const driverClient = requireProviderDriver("claude").createClient(
      { executable: join(root, "unused-claude"), version: "2.1.0", source: "system" },
      30_000,
      {
        ...NO_PROVIDER_CREDENTIALS,
        providerStateDirectory: driverIndex,
        agentEnvironment: () => ({
          CLAUDE_CONFIG_DIR: configDirectory,
          CLAUDE_CODE_PROJECT_DIR_NAME: "-fixture-history",
        }),
        claudeHistoryReader: (selected) => {
          driverFactories += 1;
          assert.deepEqual(selected, {
            configDirectory,
            projectDirectoryName: "-fixture-history",
            indexDirectory: driverIndex,
          });
          return supervisor.reader(selected);
        },
      },
    );
    assert.equal(driverFactories, 1);
    assert.ok(driverClient.readHistory);
    let driverTurns = 0;
    await Effect.runPromise(
      driverClient.readHistory({ threadId: session, items: "none" }, () =>
        Effect.sync(() => {
          driverTurns += 1;
          return true;
        }),
      ),
    );
    assert.equal(driverTurns, 4);
    await Effect.runPromise(driverClient.stop());
    report.checks.push(
      "The actual Claude provider factory injects the background reader with account/project/index paths and reads metadata without starting a provider or network connection.",
    );
    report.passed = true;
  } finally {
    await Effect.runPromise(supervisor.close());
    assert.ok(
      processes.every((entry) => !entry.running),
      "Supervisor shutdown observes every child exit before returning.",
    );
    report.checks.push("Shutdown awaits observed exits for every owned background process.");
    await Promise.all(processes.map((entry) => entry.exited));
    database.close();
  }
}

mkdirSync(output, { recursive: true });
if (process.env.OPENBOT_HISTORY_HOST_FIXTURE === "1") {
  try {
    await fixture();
  } catch (failure) {
    report.passed = false;
    report.error = failure instanceof Error ? failure.stack : String(failure);
    process.exitCode = 1;
  }
  writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} else {
  const build = await Bun.build({
    entrypoints: [join(project, "src/backend/claude-history-host.ts"), import.meta.filename],
    target: "node",
    format: "esm",
    outdir: output,
    naming: "[name].mjs",
  });
  assert.ok(build.success, String(build.logs));
  const child = spawnSync("node", [join(output, "claude-history-host-e2e.mjs")], {
    cwd: project,
    env: { ...process.env, OPENBOT_HISTORY_HOST_FIXTURE: "1", OPENBOT_HISTORY_HOST_ROOT: project },
    encoding: "utf8",
    windowsHide: true,
    timeout: 120_000,
  });
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  assert.ifError(child.error);
  assert.equal(child.status, 0);
  assert.ok(JSON.parse(readFileSync(join(output, "report.json"), "utf8")).passed);
}
