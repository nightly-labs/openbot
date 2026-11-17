// Real isolated SQLite and separate Node hosts. No Electron, provider, network or user profile.
import assert from "node:assert/strict";
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineFlowDiscovery, RoutineFlowDiscoveryFailed } from "../src/backend/routine-flows/routine-flow-discovery";
import type {
  RoutineFlowDiscoveryProcess,
  RoutineFlowHandoffPage,
  RoutineFlowOwnerCursor,
  RoutineFlowOwnerPage,
} from "../src/backend/routine-flows/routine-flow-discovery-protocol";
import { RoutineFlowStore } from "../src/backend/routine-flows/routine-flow-store";
import { createRoutineFlows } from "../src/backend/routine-flows/routine-flows";
import { RoutineResultStore } from "../src/backend/routine-results/routine-result-store";
import { createRoutineResults } from "../src/backend/routine-results/routine-results";

const projectRoot = process.env.OPENBOT_FLOW_DISCOVERY_TEST_ROOT ?? resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build/routine-flow-discovery-e2e");
const hostPath = join(output, "host.mjs");
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };
const since = "2026-11-10T00:00:00.000Z";
const at = "2026-11-16T00:00:00.000Z";

function deadline<A>(promise: Promise<A>): Promise<A> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("The isolated discovery condition did not arrive.")), 4_000);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function fixture(): Promise<void> {
  const root = mkdtempSync(join(output, "run-"));
  const database = new OpenBotDatabase(join(root, "profile"));
  const children: ChildProcessWithoutNullStreams[] = [];
  const processes = new Set<RoutineFlowDiscovery>();
  const blocked = new Map<ChildProcessWithoutNullStreams, Promise<void>>();
  let observeSpawn: ((child: ChildProcessWithoutNullStreams) => void) | null = null;
  function spawnHost(
    script = hostPath,
    databasePath = join(database.userDataPath, "openbot.db"),
  ): RoutineFlowDiscoveryProcess {
    const child = spawn(process.execPath, [script, databasePath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    children.push(child);
    observeSpawn?.(child);
    observeSpawn = null;
    const messages = new Set<(message: unknown) => void>();
    const entered = Promise.withResolvers<void>();
    blocked.set(child, entered.promise);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const value = JSON.parse(line);
      if (isDynamicRecord(value) && value.kind === "blocked") entered.resolve();
      for (const listener of [...messages]) listener(value);
    });
    child.once("exit", () => lines.close());
    return {
      send: (request) => {
        child.stdin.write(`${JSON.stringify(request)}\n`);
      },
      onMessage: (listener) => {
        messages.add(listener);
        return () => {
          messages.delete(listener);
        };
      },
      onExit: (listener) => {
        child.on("exit", listener);
        return () => child.removeListener("exit", listener);
      },
      kill: () => {
        child.kill("SIGKILL");
      },
    };
  }
  function discovery(script = hostPath, queryDeadlineMs = 5_000, startDeadlineMs = 5_000) {
    const service = new RoutineFlowDiscovery({ spawn: () => spawnHost(script), queryDeadlineMs, startDeadlineMs });
    processes.add(service);
    return service;
  }
  const alive = () => children.filter((child) => child.exitCode === null && child.signalCode === null).length;
  const snapshot = () =>
    JSON.stringify([
      database.connection.prepare("SELECT * FROM projection_routine_runs ORDER BY run_id").all(),
      database.connection.prepare("SELECT * FROM routine_flow_links ORDER BY link_id").all(),
      database.connection.prepare("SELECT * FROM routine_flow_steps ORDER BY step_id").all(),
      database.connection.prepare("SELECT * FROM routine_result_destinations ORDER BY routine_id").all(),
      database.connection.prepare("SELECT * FROM routine_result_deliveries ORDER BY run_id").all(),
      database.connection.prepare("SELECT * FROM schema_migrations ORDER BY version").all(),
    ]);
  const failed = async (
    operation: Effect.Effect<unknown, RoutineFlowDiscoveryFailed>,
    reason: RoutineFlowDiscoveryFailed["reason"],
  ) => {
    const result = await deadline(Effect.runPromise(Effect.result(operation)));
    assert.ok(Result.isFailure(result) && result.failure instanceof RoutineFlowDiscoveryFailed);
    assert.equal(result.failure.reason, reason);
  };
  try {
    await runCauseEffect(database.initialize());
    const db = database.connection;
    db.prepare(`INSERT INTO projection_agent_routines
      (routine_id,agent_id,name,instruction,active,timezone,created_at,updated_at,last_event_sequence)
      VALUES ('solo','owner','Solo','Keep private text.',1,'UTC',?,?,1),
      ('flow','chief','Flow','Keep private text.',1,'UTC',?,?,1),
      ('late','chief','Late','Keep private text.',1,'UTC',?,?,1)`).run(since, since, since, since, since, since);
    db.prepare(`INSERT INTO routine_flow_links(link_id,routine_id,from_agent_id,to_agent_id,instruction,created_at)
      VALUES ('link','flow','chief','editor','Continue.',?),('late-link','late','chief','editor','Too late.',?)`).run(
      since,
      "2026-11-17T00:00:00.000Z",
    );
    const insert = db.prepare(`INSERT INTO projection_routine_runs
      (run_id,routine_id,agent_id,run_kind,scheduled_for,routine_name,instruction,delivery_id,status,error,created_at,updated_at,last_event_sequence)
      VALUES (?,?,?,'manual',?,'Fixture','Private instruction never leaves the database.',?, ?,NULL,?,?,1)`);
    db.exec("BEGIN IMMEDIATE");
    for (let index = 0; index < 270; index++)
      insert.run(
        `solo-${String(index).padStart(3, "0")}`,
        "solo",
        "owner",
        at,
        `delivery-${index}`,
        "succeeded",
        at,
        at,
      );
    for (const status of ["failed", "interrupted", "cancelled"])
      insert.run(`solo-${status}`, "solo", "owner", at, `delivery-${status}`, status, at, at);
    for (const name of ["fresh", "pending", "done"])
      insert.run(name, "flow", "chief", at, `delivery-${name}`, "succeeded", at, at);
    insert.run("late", "late", "chief", at, "delivery-late", "succeeded", at, at);
    insert.run(
      "old",
      "solo",
      "owner",
      since,
      "delivery-old",
      "succeeded",
      "2026-10-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    );
    insert.run("active", "solo", "owner", at, "delivery-active", "running", at, at);
    db.exec("COMMIT");
    const store = new RoutineFlowStore({ database });
    for (const name of ["pending", "done", "late"])
      store.addStep({ runId: name, agentId: "chief", input: "input", output: "answer", status: "succeeded" });
    store.addStep({ runId: "done", agentId: "editor", input: "input", output: "answer", status: "succeeded" });
    const reader = discovery();
    const before = snapshot();
    const owners: string[] = [];
    let ownerAfter: RoutineFlowOwnerCursor | null = null;
    do {
      const page: RoutineFlowOwnerPage = await Effect.runPromise(reader.ownerRuns(since, ownerAfter));
      assert.ok(page.runIds.length <= 128);
      owners.push(...page.runIds);
      ownerAfter = page.after;
    } while (ownerAfter);
    assert.deepEqual(
      owners,
      store.endedRunsWithoutOwnerStep(since).map((run) => run.id),
    );
    assert.ok(owners.includes("solo-000"));
    const handoffs: string[] = [];
    let handoffAfter: string | null = null;
    do {
      const page: RoutineFlowHandoffPage = await Effect.runPromise(reader.pendingHandoffs(since, handoffAfter));
      handoffs.push(...page.runIds);
      handoffAfter = page.after;
    } while (handoffAfter);
    assert.deepEqual(handoffs, store.runIdsWithPendingHandoff(since));
    assert.deepEqual(handoffs, ["pending"]);
    const parallel = await Effect.runPromise(
      Effect.all([reader.ownerRuns(since), reader.pendingHandoffs(since)], { concurrency: 2 }),
    );
    assert.equal(parallel[0]?.runIds.length, 128);
    assert.deepEqual(parallel[1]?.runIds, ["pending"]);
    assert.equal(snapshot(), before);
    report.checks.push(
      "Real read-only discovery preserves all canonical data and schema; paged owner IDs and handoffs equal the original predicates, including routines without links and excluding late links and old/running runs.",
    );

    db.exec("BEGIN IMMEDIATE");
    db.prepare("UPDATE projection_routine_runs SET status='running' WHERE run_id='solo-000'").run();
    try {
      const stale = await Effect.runPromise(reader.ownerRuns(since));
      assert.ok(
        stale.runIds.includes("solo-000"),
        "The worker sees the committed WAL snapshot while main has a write transaction.",
      );
      assert.equal(
        store.endedRunWithoutOwnerStep("solo-000", since),
        null,
        "Main revalidation rejects an eligibility change before any owner step write.",
      );
    } finally {
      db.exec("ROLLBACK");
    }
    report.checks.push(
      "The separate WAL reader does not block main writes; the main connection rejects stale discoveries before a write.",
    );

    const sent: string[] = [];
    store.endedRunsWithoutOwnerStep = () => {
      throw new Error("A production sweep used synchronous owner discovery.");
    };
    store.runIdsWithPendingHandoff = () => {
      throw new Error("A production sweep used synchronous handoff discovery.");
    };
    const runtime = await Effect.runPromise(
      createRoutineFlows({
        store,
        discovery: reader,
        routines: { list: () => [], get: () => null, listRuns: () => [] },
        delivery: (id) => ({
          status: id.startsWith("handoff-") ? "queued" : "completed",
          turnId: id.startsWith("handoff-") ? null : `turn-${id}`,
          error: null,
        }),
        turnAnswer: () => "answer",
        agentName: (id) => id,
        sendHandoff: (input) => {
          sent.push(input.run.id);
          return Effect.succeed(`handoff-${input.run.id}`);
        },
        stopRoutineRun: () => Effect.void,
        stopDelivery: () => Effect.void,
        changed: () => {},
        now: () => new Date(at),
      }),
    );
    try {
      await Effect.runPromise(runtime.sweep());
      assert.deepEqual([...sent].sort(), ["fresh", "pending"]);
      assert.equal(
        Number(db.prepare("SELECT count(*) AS n FROM routine_flow_steps WHERE agent_id='owner'").get()?.n),
        273,
      );
      const steps = snapshot();
      await Effect.runPromise(runtime.sweep());
      assert.equal(snapshot(), steps);
      assert.equal(sent.length, 2);
    } finally {
      await Effect.runPromise(runtime.close());
    }
    assert.equal(alive(), 0);
    await failed(reader.ownerRuns(since), "closed");
    report.checks.push(
      "The real flow runtime avoids both synchronous discovery methods, writes all 273 no-link terminal owner steps, sends only fresh/pending handoffs once, and closes its discovery host with its managed runtime.",
    );

    const resultStore = new RoutineResultStore(database);
    db.prepare(`INSERT INTO projection_messaging_connections
      (connection_id,platform,workspace_id,workspace_name,enabled,created_at,updated_at)
      VALUES ('result-connection','slack','result-workspace','Fixture',1,?,?)`).run(since, since);
    const destination = {
      connectionId: "result-connection",
      platform: "slack" as const,
      connectionName: "Fixture",
      placeId: "fixture-place",
      placeName: "Fixture",
    };
    resultStore.setDestination("solo", destination, since);
    resultStore.setDestination("late", destination, "2026-11-17T00:00:00.000Z");
    db.prepare(`INSERT INTO projection_mailbox_messages
      (message_id,sender_kind,sender_agent_id,text,reply_to_message_id,created_at,message_json,last_event_sequence)
      VALUES ('result-source','routine',NULL,'Private answer input.',NULL,?,'{}',1)`).run(at);
    db.prepare(`INSERT INTO projection_deliveries
      (delivery_id,message_id,recipient_agent_id,status,turn_id,error,created_at,delivery_json,last_event_sequence)
      VALUES ('delivery-failed','result-source','owner','completed','reported-failure-turn',NULL,?,'{}',1)`).run(at);
    for (const status of ["queued", "needs-attention"])
      insert.run(`result-${status}`, "solo", "owner", at, `delivery-${status}`, status, at, at);
    const existingStatuses = ["quiet", "pending", "sending", "sent", "failed", "uncertain"];
    for (const [index, status] of existingStatuses.entries()) {
      const run = resultStore.runWithoutDelivery(`solo-${String(index).padStart(3, "0")}`, since);
      assert.ok(run);
      resultStore.createDelivery(run, status === "quiet" ? null : "Already pending", at);
      db.prepare("UPDATE routine_result_deliveries SET status=? WHERE run_id=?").run(status, run.runId);
    }
    const resultReader = discovery();
    const beforeResults = snapshot();
    const resultIds: string[] = [];
    let resultAfter: RoutineFlowOwnerCursor | null = null;
    do {
      const page: RoutineFlowOwnerPage = await Effect.runPromise(resultReader.resultRuns(since, resultAfter));
      assert.ok(page.runIds.length <= 128);
      resultIds.push(...page.runIds);
      resultAfter = page.after;
    } while (resultAfter !== null);
    assert.deepEqual(
      resultIds,
      resultStore.runsWithoutDelivery(since).map((run) => run.runId),
    );
    assert.equal(resultIds.length, 265);
    assert.ok(resultIds.includes("solo-failed"));
    for (const excluded of [
      "solo-interrupted",
      "solo-cancelled",
      "old",
      "active",
      "result-queued",
      "result-needs-attention",
      "late",
      "fresh",
      "solo-000",
    ])
      assert.equal(resultIds.includes(excluded), false);
    assert.equal(snapshot(), beforeResults);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE routine_result_destinations SET updated_at='2026-11-17T00:00:00.000Z' WHERE routine_id='solo'",
      ).run();
      const stale = await Effect.runPromise(resultReader.resultRuns(since));
      assert.ok(stale.runIds.includes("solo-010"));
      assert.equal(resultStore.runWithoutDelivery("solo-010", since), null);
    } finally {
      db.exec("ROLLBACK");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE projection_deliveries SET status='failed' WHERE delivery_id='delivery-failed'").run();
      assert.equal(resultStore.runWithoutDelivery("solo-failed", since), null);
      db.prepare("UPDATE projection_routine_runs SET status='running' WHERE run_id='solo-010'").run();
      assert.equal(resultStore.runWithoutDelivery("solo-010", since), null);
    } finally {
      db.exec("ROLLBACK");
    }
    report.checks.push(
      "Result ID pages equal the original predicate and do not change canonical data: succeeded and agent-reported failures qualify; all other run states, stale destinations and every existing result status are excluded. Main revalidation rejects changed destination, run and source-delivery state.",
    );
    resultStore.runsWithoutDelivery = () => {
      throw new Error("A result sweep used synchronous discovery.");
    };
    const posts: string[] = [];
    const results = await Effect.runPromise(
      createRoutineResults({
        store: resultStore,
        discovery: resultReader,
        delivery: (id) => ({ turnId: `turn-${id}` }),
        turnAnswer: (_agent, turnId) =>
          turnId === "turn-delivery-10" || turnId === "turn-delivery-failed"
            ? `Answer ${turnId}`
            : turnId === "turn-delivery-12"
              ? "[[no-update]]"
              : null,
        connection: () => ({ platform: "slack", name: "Fixture" }),
        options: () => Effect.succeed([]),
        post: (_connection, _place, text) => {
          posts.push(text);
          return Effect.succeed({ posted: true as const });
        },
        changed: () => {},
        now: () => new Date(at),
      }),
    );
    try {
      await Effect.runPromise(results.sweep());
      assert.equal(posts.length, 3);
      assert.equal(posts.filter((text) => text.includes("Already pending")).length, 1);
      assert.equal(posts.filter((text) => text.includes("Answer turn-delivery-10")).length, 1);
      assert.equal(posts.filter((text) => text.includes("Answer turn-delivery-failed")).length, 1);
      assert.equal(
        db.prepare("SELECT status FROM routine_result_deliveries WHERE run_id='solo-011'").get()?.status,
        "quiet",
      );
      assert.equal(
        db.prepare("SELECT status FROM routine_result_deliveries WHERE run_id='solo-012'").get()?.status,
        "quiet",
      );
      const savedResults = snapshot();
      await Effect.runPromise(results.sweep());
      assert.equal(posts.length, 3);
      assert.equal(snapshot(), savedResults);
    } finally {
      await Effect.runPromise(results.close());
    }
    assert.equal(alive(), 0);
    await failed(resultReader.resultRuns(since), "closed");
    report.checks.push(
      "The real result runtime avoids synchronous discovery, keeps quiet/no-update results quiet, posts new answers and already-due work once, leaves sending/ended results unchanged and closes its separate reader; a zero-new-result sweep changes nothing.",
    );

    const blockedPath = join(root, "blocked.mjs");
    writeFileSync(
      blockedPath,
      `import {DatabaseSync} from 'node:sqlite';import {createInterface} from 'node:readline';
      const db=new DatabaseSync(':memory:');process.stdout.write(JSON.stringify({kind:'ready'})+'\\n');
      createInterface({input:process.stdin}).on('line',()=>{process.stdout.write(JSON.stringify({kind:'blocked'})+'\\n');
        db.prepare('WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x) SELECT sum(n) FROM x').get();});`,
    );
    const timeoutReader = discovery(blockedPath, 100);
    const startsBefore = children.length;
    await failed(timeoutReader.resultRuns(since), "deadline");
    await Effect.runPromise(timeoutReader.close());
    assert.equal(children.length, startsBefore + 1, "A timed-out discovery does not retry.");
    assert.equal(alive(), 0);
    const cancelReader = discovery(blockedPath);
    const abort = new AbortController();
    const cancelSpawned = Promise.withResolvers<ChildProcessWithoutNullStreams>();
    observeSpawn = cancelSpawned.resolve;
    const cancelled = Effect.runPromise(cancelReader.ownerRuns(since), { signal: abort.signal });
    const rejected = assert.rejects(cancelled);
    const cancelChild = await deadline(cancelSpawned.promise);
    const reached = blocked.get(cancelChild);
    assert.ok(reached);
    await deadline(reached);
    abort.abort();
    await rejected;
    await Effect.runPromise(cancelReader.close());
    assert.equal(alive(), 0);
    const closingReader = discovery(blockedPath);
    const closeSpawned = Promise.withResolvers<ChildProcessWithoutNullStreams>();
    observeSpawn = closeSpawned.resolve;
    const pending = Effect.runPromise(Effect.result(closingReader.ownerRuns(since)));
    const closeChild = await deadline(closeSpawned.promise);
    const closeReached = blocked.get(closeChild);
    assert.ok(closeReached);
    await deadline(closeReached);
    await Effect.runPromise(closingReader.close());
    const closed = await deadline(pending);
    assert.ok(Result.isFailure(closed) && closed.failure.reason === "closed");
    assert.equal(alive(), 0);
    const silentPath = join(root, "silent.mjs");
    writeFileSync(silentPath, "setInterval(()=>{},1000);");
    const silentReader = discovery(silentPath, 5_000, 100);
    await failed(silentReader.ownerRuns(since), "start");
    await Effect.runPromise(silentReader.close());
    assert.equal(alive(), 0);
    report.checks.push(
      "A real process blocked in native SQLite is killed on deadline, caller cancellation and close; a never-ready host is killed; no operation retries or leaves an owned process.",
    );
    report.passed = true;
  } finally {
    for (const process of processes) await Effect.runPromise(process.close());
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    database.close();
  }
}

mkdirSync(output, { recursive: true });
if (process.argv.includes("--fixture")) {
  try {
    await fixture();
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.exitCode = 1;
  } finally {
    writeFileSync(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
} else {
  for (const [entry, naming] of [
    [import.meta.filename, "fixture.mjs"],
    [join(projectRoot, "src/backend/routine-flows/routine-flow-discovery-host.ts"), "host.mjs"],
  ]) {
    assert.ok(entry && naming);
    const built = await Bun.build({ entrypoints: [entry], target: "node", format: "esm", outdir: output, naming });
    assert.ok(built.success, String(built.logs));
  }
  const child = spawnSync("node", [join(output, "fixture.mjs"), "--fixture"], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 45_000,
    env: { ...process.env, OPENBOT_FLOW_DISCOVERY_TEST_ROOT: projectRoot },
  });
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.ifError(child.error);
  assert.equal(child.status, 0);
}
