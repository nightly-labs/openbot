// Drives the Experiential Jev adapter through isolated loopback HTTP. No real key or service is used.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result } from "effect";
import { type JevRoutingObservation, JevWorkRouter } from "../src/backend/agent/jev-work-router";
import type { ServerWorkRouteDecisionInput } from "../src/backend/agent/server-work-routing";
import { ToolOperationFailed } from "../src/backend/agent/tool-operation";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { CustomThreadRoutingStatusStore } from "../src/main/custom-thread-routing-status-store";
import { PreferenceFileFailure, writePreferenceFile } from "../src/main/preference-file";

const projectRoot = process.env.OPENBOT_JEV_TEST_ROOT ?? resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build/jev-work-router-e2e");
const report: { passed: boolean; checks: string[]; error?: string } = { passed: false, checks: [] };
const fixtureKey = "isolated-jev-fixture-key-not-a-real-key";

function object(value: unknown): DynamicRecord {
  assert.ok(isDynamicRecord(value));
  return value;
}

function deadline<A>(promise: Promise<A>): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The fixture state did not arrive.")), 3_000);
  });
  return Promise.race([promise, expired]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function fixture(): Promise<void> {
  const diagnosticPath = join(mkdtempSync(join(output, "run-")), "routing-status.json");
  const diagnosticStore = new CustomThreadRoutingStatusStore(diagnosticPath);
  await Effect.runPromise(diagnosticStore.start());
  const observations: JevRoutingObservation[] = [];
  const observe = (event: JevRoutingObservation) =>
    Effect.sync(() => {
      observations.push(event);
    }).pipe(Effect.andThen(diagnosticStore.record(event)));
  const received: Array<{
    body: DynamicRecord;
    raw: string;
    authorization: string | undefined;
    idempotencyKey: string | string[] | undefined;
  }> = [];
  let redirected = 0;
  let respond: (response: ServerResponse, body: DynamicRecord) => void = () => undefined;
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url === "/redirect-target") {
        redirected += 1;
        response.writeHead(500).end();
        return;
      }
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/v1/systemone");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = object(JSON.parse(raw));
      received.push({
        body,
        raw,
        authorization: request.headers.authorization,
        idempotencyKey: request.headers["idempotency-key"],
      });
      respond(response, body);
    })().catch(() => {
      response.writeHead(500).end("An isolated fixture failed.");
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}/v1/systemone`;
  const router = new JevWorkRouter({ apiKey: () => fixtureKey, endpoint, observe });
  const input: ServerWorkRouteDecisionInput = {
    agentId: "owner-fixture-id",
    senderAgentId: "sender-fixture-id",
    requestId: "request-fixture-id",
    text: "Please continue the invoice work.",
    candidates: [
      {
        taskId: "existing-private-task-id",
        agentId: "owner-fixture-id",
        title: "Invoice work",
        state: "idle",
        hold: null,
        outcome: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  const answer = (body: DynamicRecord, choice: string, confidence = 1) => {
    const criteria = object(object(object(body.questions).thread).criteria);
    return {
      model: "jev-fixture",
      answers: {
        thread: {
          type: "choice",
          choice,
          confidence,
          probabilities: Object.fromEntries(Object.keys(criteria).map((label) => [label, label === choice ? 1 : 0])),
        },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  };
  const json = (response: ServerResponse, value: unknown) =>
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(value));
  const select = (choice: string, confidence = 1) => {
    respond = (response, body) => {
      json(response, answer(body, choice, confidence));
    };
  };
  const safeFailure = async (
    operation: Effect.Effect<unknown, ToolOperationFailed>,
    requests = 1,
    reason: JevRoutingObservation["reason"] = "invalid-response",
  ) => {
    const before = received.length;
    const observedBefore = observations.length;
    const result = await Effect.runPromise(Effect.result(operation));
    assert.ok(Result.isFailure(result));
    assert.ok(result.failure instanceof ToolOperationFailed);
    assert.ok(result.failure.cause instanceof Error);
    assert.equal(result.failure.cause.message, sourceText("error.app.jevRoutingUnavailable"));
    assert.equal(received.length, before + requests, "Routing failures must not trigger retries.");
    assert.equal(observations.length, observedBefore + 1);
    assert.equal(observations.at(-1)?.outcome, "failed");
    assert.equal(observations.at(-1)?.reason, reason);
  };

  try {
    select("work_0");
    assert.deepEqual(await runCauseEffect(router.decide(input)), {
      kind: "existing",
      taskId: input.candidates[0]?.taskId,
    });
    assert.equal(observations.length, 1);
    assert.equal(observations[0]?.outcome, "existing");
    assert.equal(observations[0]?.reason, "selected");
    const first = received.at(-1);
    assert.ok(first);
    assert.equal(first.authorization, `Bearer ${fixtureKey}`);
    assert.equal(first.idempotencyKey, undefined, "The gateway request has one attempt and no Idempotency-Key header.");
    assert.equal(first.body.model, "jev-latest");
    assert.deepEqual(first.body.state, { incomingText: input.text });
    const question = object(object(first.body.questions).thread);
    assert.equal(question.type, "choice");
    assert.deepEqual(Object.keys(object(question.criteria)), ["main", "new", "work_0"]);
    assert.ok(
      typeof question.instructions === "string" &&
        question.instructions.includes("Shared project or subject alone NEVER selects main"),
    );
    assert.ok(
      String(object(question.criteria).new).includes("Default for an actionable job, question, report or lookup"),
    );
    assert.equal(first.raw.includes(input.candidates[0]?.taskId ?? "missing"), false);
    assert.equal(first.raw.includes(input.senderAgentId), false);
    assert.equal(first.raw.includes(input.requestId), false);
    report.checks.push(
      "The Experiential native Choice envelope uses Bearer auth, scoped title aliases and no task IDs, transcripts or Idempotency-Key header.",
    );

    select("new", 0.8);
    assert.deepEqual(await runCauseEffect(router.decide(input)), { kind: "new" });
    assert.equal(observations.at(-1)?.reason, "selected");
    select("new", 0.799);
    assert.deepEqual(await runCauseEffect(router.decide(input)), { kind: "main" });
    assert.equal(observations.at(-1)?.reason, "low-confidence");
    select("main");
    assert.deepEqual(await runCauseEffect(router.decide(input)), { kind: "main" });
    report.checks.push("The local confidence policy accepts 0.8 and keeps lower confidence in main.");

    select("new");
    const lateConstraint = "Keep this final constraint in the routing input.";
    const longText = `${"An ordinary sentence. ".repeat(6_000).slice(0, INPUT_LIMITS.messageText - lateConstraint.length)}${lateConstraint}`;
    assert.equal(longText.length, INPUT_LIMITS.messageText);
    await runCauseEffect(router.decide({ ...input, text: longText }));
    assert.deepEqual(received.at(-1)?.body.state, { incomingText: longText });
    const secretText = `Continue ${fixtureKey}. password=synthetic-fixture-password`;
    const firstCandidate = input.candidates[0];
    assert.ok(firstCandidate);
    await runCauseEffect(
      router.decide({
        ...input,
        text: secretText,
        candidates: [{ ...firstCandidate, title: `${"x".repeat(110)}${fixtureKey}` }],
      }),
    );
    assert.equal(received.at(-1)?.raw.includes(fixtureKey), false);
    assert.equal(received.at(-1)?.raw.includes("synthetic-fixture-password"), false);
    await runCauseEffect(
      router.decide({
        ...input,
        mainTitle: `Current invoice ${fixtureKey} ${"subject ".repeat(40)}`,
      }),
    );
    const mainSubjectRequest = received.at(-1);
    assert.ok(mainSubjectRequest);
    const mainSubjectState = object(mainSubjectRequest.body.state);
    assert.equal(mainSubjectState.incomingText, input.text);
    assert.ok(typeof mainSubjectState.mainTitle === "string");
    assert.equal(mainSubjectState.mainTitle.length, INPUT_LIMITS.agentTaskTitle);
    assert.ok(mainSubjectState.mainTitle.startsWith("Current invoice "));
    assert.equal(mainSubjectRequest.raw.includes(fixtureKey), false);
    const mainCriteria = object(object(object(mainSubjectRequest.body.questions).thread).criteria).main;
    assert.ok(typeof mainCriteria === "string" && mainCriteria.includes("untrusted title data"));
    report.checks.push(
      "The current main subject is sent as bounded masked title data while the incoming message stays complete.",
    );
    const candidates = Array.from({ length: 51 }, (_, index) => ({
      ...firstCandidate,
      taskId: `private-candidate-${index}`,
      title: `Scoped fixture work ${index}`,
    }));
    await runCauseEffect(router.decide({ ...input, candidates }));
    assert.equal(Object.keys(object(object(object(received.at(-1)?.body.questions).thread).criteria)).length, 52);
    assert.equal(received.at(-1)?.raw.includes("Scoped fixture work 50"), false);
    report.checks.push(
      "All incoming text, including late constraints, is retained; credentials are masked and candidate titles are bounded.",
    );

    const defaultRouter = new JevWorkRouter({
      apiKey: () => fixtureKey,
      observe,
      request: async (url, init) => {
        assert.equal(url, "https://api.experientiallabs.ai/v1/systemone");
        return fetch(endpoint, init);
      },
    });
    await runCauseEffect(defaultRouter.decide(input));
    assert.throws(() => new JevWorkRouter({ apiKey: () => fixtureKey, endpoint: "https://example.com/route" }));
    assert.throws(() => new JevWorkRouter({ apiKey: () => fixtureKey, endpoint: "http://127.0.0.1/route?key=bad" }));
    await safeFailure(new JevWorkRouter({ apiKey: () => null, endpoint, observe }).decide(input), 0, "missing-key");
    await safeFailure(router.decide({ ...input, text: "x".repeat(INPUT_LIMITS.messageText + 1) }), 0, "invalid-input");
    await safeFailure(
      router.decide({ ...input, text: `{"headers":{"X-Tenant":"fixture"} ${lateConstraint}` }),
      0,
      "unsafe-text",
    );
    await safeFailure(
      router.decide({ ...input, candidates: [{ ...firstCandidate, agentId: "foreign-owner" }] }),
      0,
      "invalid-scope",
    );
    report.checks.push(
      "The production URL is the fixed Experiential gateway; test overrides stay on loopback and missing host-supplied gateway credentials fail before HTTP.",
    );

    respond = (response, body) => {
      json(response, {
        ...answer(body, "new"),
        answers: {
          thread: {
            type: "choice",
            choice: "private-unlisted-task-id",
            confidence: 1,
            probabilities: { main: 0, new: 1, work_0: 0 },
          },
        },
      });
    };
    await safeFailure(router.decide(input));
    respond = (response, body) => {
      const value = answer(body, "new");
      value.answers.thread.probabilities.invented = 0;
      json(response, value);
    };
    await safeFailure(router.decide(input));
    respond = (response, body) => {
      const value = answer(body, "new");
      value.answers.thread.confidence = 2;
      json(response, value);
    };
    await safeFailure(router.decide(input));
    respond = (response) => {
      response.writeHead(200).end("{invalid JSON");
    };
    await safeFailure(router.decide(input));
    respond = (response) => {
      response.writeHead(503).end(`${fixtureKey} private response content`);
    };
    await safeFailure(router.decide(input), 1, "http");
    assert.equal(observations.at(-1)?.httpStatus, 503);
    respond = (response) => {
      response.writeHead(302, { Location: "/redirect-target" }).end();
    };
    await safeFailure(router.decide(input), 1, "http");
    assert.equal(redirected, 0);
    report.checks.push(
      "Invented labels, invalid answers, bad JSON, HTTP errors and redirects fail with a typed safe error and no retries.",
    );

    respond = (response, body) => {
      const padding = " ".repeat(140 * 1024);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write(padding);
      response.end(padding + JSON.stringify(answer(body, "new")));
    };
    await safeFailure(router.decide(input));
    respond = (response, body) => {
      const content = `${" ".repeat(256 * 1024)}${JSON.stringify(answer(body, "new"))}`;
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(content) });
      response.end(content);
    };
    await safeFailure(router.decide(input));
    report.checks.push(
      "Declared and streamed responses above 256 KiB are refused even when their JSON would be valid.",
    );

    const timedOutClosed = Promise.withResolvers<void>();
    respond = (response) => {
      response.once("close", timedOutClosed.resolve);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write(" ");
    };
    await safeFailure(router.decide(input), 1, "timeout");
    await deadline(timedOutClosed.promise);
    report.checks.push(
      "The five-second deadline also aborts a stalled response stream and closes its HTTP connection.",
    );

    const arrived = Promise.withResolvers<void>();
    const cancelledClosed = Promise.withResolvers<void>();
    respond = (response) => {
      response.once("close", cancelledClosed.resolve);
      arrived.resolve();
    };
    const cancel = new AbortController();
    const observedBeforeCancel = observations.length;
    const pending = Effect.runPromise(router.decide(input), { signal: cancel.signal });
    const rejected = assert.rejects(pending);
    await deadline(arrived.promise);
    cancel.abort();
    await rejected;
    await deadline(cancelledClosed.promise);
    assert.equal(observations.length, observedBeforeCancel + 1);
    assert.equal(observations.at(-1)?.outcome, "failed");
    assert.equal(observations.at(-1)?.reason, "cancelled");
    report.checks.push("Effect cancellation aborts an in-flight HTTP request without a retry.");

    select("new");
    const beforeConcurrent = observations.length;
    const decisions = await Effect.runPromise(
      Effect.all(
        Array.from({ length: 8 }, (_, index) =>
          router.decide({
            ...input,
            requestId: `parallel-request-${index}`,
            text: `Run independent report ${index} in the invoice project.`,
          }),
        ),
        { concurrency: 8 },
      ),
    );
    assert.ok(decisions.every((decision) => decision.kind === "new"));
    assert.equal(observations.length, beforeConcurrent + 8);
    const readStoredEvents = () => {
      const stored = object(JSON.parse(readFileSync(diagnosticPath, "utf8")));
      assert.equal(stored.version, 1);
      assert.ok(Array.isArray(stored.events));
      return stored.events.map((value) => {
        const { recordedAt, ...event } = object(value);
        assert.ok(typeof recordedAt === "string" && Number.isFinite(Date.parse(recordedAt)));
        return event;
      });
    };
    await Effect.runPromise(diagnosticStore.flush());
    assert.deepEqual(readStoredEvents(), observations);
    for (const event of observations) {
      assert.deepEqual(
        Object.keys(event).sort(),
        [
          "agentId",
          "candidateCount",
          "elapsedMs",
          "outcome",
          "reason",
          ...(event.httpStatus === undefined ? [] : ["httpStatus"]),
        ].sort(),
      );
      assert.ok(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0);
      assert.ok(event.candidateCount >= 0 && event.candidateCount <= 50);
    }
    const storedText = readFileSync(diagnosticPath, "utf8");
    for (const privateText of [
      fixtureKey,
      input.text,
      input.candidates[0]?.taskId ?? "missing",
      "Invoice work",
      "private response content",
      "parallel-request-",
    ])
      assert.equal(storedText.includes(privateText), false);
    report.checks.push(
      "Each decision, failure and cancellation emits one safe diagnostic; concurrent HTTP decisions retain every event in the real atomic status store without text, titles, task IDs or secrets.",
    );

    let failedObserverCalls = 0;
    const brokenObserver = new JevWorkRouter({
      apiKey: () => fixtureKey,
      endpoint,
      observe: () => {
        failedObserverCalls += 1;
        return Effect.die(new Error("An isolated observer failed."));
      },
    });
    assert.deepEqual(await runCauseEffect(brokenObserver.decide(input)), { kind: "new" });
    respond = (response) => {
      response.writeHead(503).end("Private provider error.");
    };
    const originalFailure = await Effect.runPromise(Effect.result(brokenObserver.decide(input)));
    assert.ok(Result.isFailure(originalFailure) && originalFailure.failure instanceof ToolOperationFailed);
    assert.equal(failedObserverCalls, 2);
    report.checks.push("An observer defect cannot replace a routing success or its original typed failure.");

    const retained = Array.from(
      { length: 205 },
      (_, index): JevRoutingObservation => ({
        agentId: `bounded-fixture-agent-${index}`,
        outcome: "new",
        reason: "selected",
        elapsedMs: 0,
        candidateCount: 0,
      }),
    );
    await Effect.runPromise(
      Effect.all(
        retained.map((event) => diagnosticStore.record(event)),
        { concurrency: 8 },
      ),
    );
    await Effect.runPromise(diagnosticStore.flush());
    const bounded = readStoredEvents();
    assert.equal(bounded.length, 200);
    const retainedIds = new Set(retained.map((event) => event.agentId));
    assert.equal(new Set(bounded.map((event) => event.agentId)).size, 200);
    assert.ok(bounded.every((event) => typeof event.agentId === "string" && retainedIds.has(event.agentId)));
    const sentinel: JevRoutingObservation = {
      agentId: "bounded-fixture-final",
      outcome: "main",
      reason: "selected",
      elapsedMs: 0,
      candidateCount: 0,
    };
    await runCauseEffect(diagnosticStore.record(sentinel));
    await Effect.runPromise(diagnosticStore.flush());
    assert.deepEqual(readStoredEvents(), [...bounded.slice(1), sentinel]);
    report.checks.push(
      "Concurrent atomic diagnostic writes retain 200 distinct completed events; the next committed event evicts only the oldest retained event.",
    );
    select("new");
    const blockedPath = join(mkdtempSync(join(output, "blocked-")), "routing-status.json");
    const writerEntered = Promise.withResolvers<void>();
    const writerRelease = Deferred.makeUnsafe<void>();
    let writes = 0;
    const blockedStore = new CustomThreadRoutingStatusStore(blockedPath, {
      write: (path, status) =>
        Effect.gen(function* () {
          writes += 1;
          if (writes === 1) {
            writerEntered.resolve();
            yield* Deferred.await(writerRelease);
          }
          yield* writePreferenceFile(path, status);
        }),
    });
    await Effect.runPromise(blockedStore.start());
    await Effect.runPromise(blockedStore.record(sentinel));
    await deadline(writerEntered.promise);
    const nonblockingRouter = new JevWorkRouter({
      apiKey: () => fixtureKey,
      endpoint,
      observe: (event) => blockedStore.record(event),
    });
    const whileBlocked = Effect.runPromise(nonblockingRouter.decide(input).pipe(Effect.timeout("1 second")));
    try {
      assert.deepEqual(await deadline(whileBlocked), { kind: "new" });
      assert.equal(writes, 1, "The first diagnostic write is still pending when routing returns.");
      select("work_0");
      assert.deepEqual(
        await deadline(Effect.runPromise(nonblockingRouter.decide(input).pipe(Effect.timeout("1 second")))),
        { kind: "existing", taskId: input.candidates[0]?.taskId },
      );
      assert.equal(writes, 1, "An existing-work choice also returns while the writer is blocked.");
      await Effect.runPromise(
        Effect.all(
          retained.map((event) => blockedStore.record(event)),
          { concurrency: 8 },
        ),
      );
    } finally {
      await Effect.runPromise(Deferred.succeed(writerRelease, undefined));
      await whileBlocked.catch(() => undefined);
      await Effect.runPromise(blockedStore.dispose());
    }
    const drained = object(JSON.parse(readFileSync(blockedPath, "utf8")));
    assert.ok(Array.isArray(drained.events));
    assert.equal(drained.events.length, 200);
    const drainedIds = new Set(drained.events.map((event) => object(event).agentId));
    assert.equal(drainedIds.size, 200);
    assert.ok([...drainedIds].every((id) => typeof id === "string" && retainedIds.has(id)));
    const writesAtClose = writes;
    await Effect.runPromise(blockedStore.record(sentinel));
    await Effect.runPromise(blockedStore.dispose());
    assert.equal(writes, writesAtClose, "Disposed diagnostics cannot start another write.");
    assert.ok(writes <= 3, "A blocked writer must coalesce bursts, not write once per event.");
    report.checks.push(
      "A pending diagnostic write cannot consume a routing deadline; bounded bursts coalesce and shutdown flushes the latest accepted 200 events before closing its scoped worker.",
    );

    const failurePath = join(mkdtempSync(join(output, "write-failure-")), "routing-status.json");
    let failedWrites = 0;
    const failureStore = new CustomThreadRoutingStatusStore(failurePath, {
      write: (path, status) => {
        failedWrites += 1;
        return failedWrites === 1
          ? Effect.fail(new PreferenceFileFailure({ cause: new Error("Isolated diagnostic write failure.") }))
          : writePreferenceFile(path, status);
      },
    });
    await Effect.runPromise(failureStore.record(sentinel));
    await Effect.runPromise(failureStore.flush());
    assert.equal(failedWrites, 1);
    const recovered = { ...sentinel, agentId: "after-writer-error" };
    await Effect.runPromise(failureStore.record(recovered));
    await Effect.runPromise(failureStore.dispose());
    const recoveredStatus = object(JSON.parse(readFileSync(failurePath, "utf8")));
    assert.ok(Array.isArray(recoveredStatus.events));
    assert.equal(recoveredStatus.events.length, 2);
    assert.equal(object(recoveredStatus.events[1]).agentId, recovered.agentId);
    report.checks.push(
      "A failed diagnostic write preserves its bounded memory view; a later flush saves new events and disposal also works without starting a worker.",
    );
    report.passed = true;
  } finally {
    await Effect.runPromise(diagnosticStore.dispose());
    const closed = once(server, "close");
    server.closeAllConnections();
    server.close();
    await closed;
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
  const build = await Bun.build({
    entrypoints: [import.meta.filename],
    target: "node",
    format: "esm",
    outdir: output,
    naming: "fixture.mjs",
  });
  assert.ok(build.success, String(build.logs));
  const child = spawnSync("node", [join(output, "fixture.mjs"), "--fixture"], {
    cwd: projectRoot,
    env: { ...process.env, OPENBOT_JEV_TEST_ROOT: projectRoot },
    encoding: "utf8",
    windowsHide: true,
    timeout: 45_000,
  });
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.ifError(child.error);
  assert.equal(child.status, 0, "The isolated Jev work router check failed.");
}
