import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { BrowserTab } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { Deferred, Effect, Fiber } from "effect";
import { app, BrowserWindow, type WebContents, webContents } from "electron";
import { z } from "zod";
import type { BrowserOperationError } from "../src/backend/browser-effects";
import { BrowserHost } from "../src/backend/browser-host";
import { BROWSER_DYNAMIC_TOOLS } from "../src/backend/browser-tools";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams, DynamicToolResult } from "../src/backend/protocol";
import { parseBrowserToolText } from "./browser-snapshot-text";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

const eventSchema = z.object({
  id: z.string(),
  field: z.string(),
  trusted: z.boolean(),
  submitted: z.boolean(),
  values: z.record(z.string(), z.string()),
});
type FormEvent = z.infer<typeof eventSchema>;
const events: FormEvent[] = [];
const cases: string[] = [];
const snapshotSchema = z.object({
  tabId: z.string(),
  revision: z.number(),
  elements: z.array(z.object({ ref: z.string(), name: z.string(), tag: z.string().optional() })),
});
const outcomeSchema = z.object({
  tabId: z.string(),
  status: z.enum(["completed", "refused", "partial", "snapshot_failed"]),
  inputCompleted: z.boolean(),
  confirmed: z.array(z.number()),
  failedIndex: z.number().nullable(),
  uncertainIndex: z.number().nullable(),
  reason: z.string().optional(),
  snapshot: snapshotSchema.optional(),
});
interface FixtureForm {
  id: string;
  tab: BrowserTab;
  contents: WebContents;
  snapshot: z.infer<typeof snapshotSchema>;
  field(name: string): string;
  fields: Array<{ ref: string; text: string }>;
}
type FixtureCall = (
  tool: string,
  args: DynamicToolCallParams["arguments"],
  owner?: string,
) => Promise<DynamicToolResult>;
type FixtureParams = (tool: string, args: DynamicToolCallParams["arguments"], owner?: string) => DynamicToolCallParams;
const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/event" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      events.push(eventSchema.parse(JSON.parse(body)));
      response.writeHead(204).end();
    } else {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(formPage(url.searchParams.get("id") ?? "frame", url.searchParams.get("mode") ?? "ordinary"));
    }
  })().catch(() => response.writeHead(500).end("Fixture request failed."));
});

let browser: BrowserHost | undefined;
let window: BrowserWindow | undefined;
let sequence = 0;
let nativeFocusEvents = 0;
let currentPhase = "entry";

void main().catch((error) => {
  process.stderr.write(`${redactText(String(error))}\n`);
  app.exit(1);
});

async function main(): Promise<void> {
  app.setPath("userData", join(fixtureRoot, "profile"));
  app.setPath("sessionData", join(fixtureRoot, "session"));
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  phase("entry-start");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object", "Fixture server address missing.");
    const origin = `http://127.0.0.1:${address.port}`;
    phase("loopback-listening");
    await app.whenReady();
    phase("electron-ready");
    app.on("browser-window-focus", () => {
      nativeFocusEvents += 1;
    });
    window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"));
    phase("hidden-window-created");
    const host = browser;
    const params = (
      tool: string,
      args: DynamicToolCallParams["arguments"],
      owner = "fixture-agent",
    ): DynamicToolCallParams => ({
      namespace: "openbot_browser",
      tool,
      arguments: args,
      ownerAgentId: owner,
      threadId: "fixture-thread",
      turnId: "fixture-turn",
      callId: `fill-${++sequence}`,
    });
    const callsByTool = new Map<string, number>();
    const call = (tool: string, args: DynamicToolCallParams["arguments"], owner?: string) => {
      callsByTool.set(tool, (callsByTool.get(tool) ?? 0) + 1);
      return runCauseEffect(host.handleDynamicTool(params(tool, args, owner)));
    };
    const json = (result: DynamicToolResult) => {
      const text = result.contentItems.find((item) => item.type === "inputText");
      assert(text?.type === "inputText", "Missing fixture tool text.");
      return z.json().parse(parseBrowserToolText(text.text));
    };
    const open = async (mode = "ordinary") => {
      const id = `form-${++sequence}`;
      const tab = await runCauseEffect(
        host.open(`${origin}/form?id=${id}&mode=${mode}`, "fixture-thread", "fixture-agent"),
      );
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      assert(contents, "Missing owned fixture contents.");
      const result = await call("snapshot", { tabId: tab.id, image: "never" });
      assert(result.success, "Initial fixture snapshot failed.");
      const snapshot = snapshotSchema.parse(json(result));
      const field = (name: string) => {
        const element = snapshot.elements.find((item) => item.name === name);
        assert(element, "Fixture field missing from inspected snapshot.");
        return element.ref;
      };
      const fields = Array.from({ length: 8 }, (_, index) => ({
        ref: field(`Field ${index + 1}`),
        text: `value-${index + 1}`,
      }));
      return { id, tab, contents, snapshot, field, fields };
    };
    const drain = async (contents: WebContents) => {
      if (!contents.isDestroyed()) await contents.executeJavaScript("window.fixtureDrain?.()", false);
    };
    const recorded = (id: string) => events.filter((event) => event.id === id);
    const fill = async (
      form: Awaited<ReturnType<typeof open>>,
      fields = form.fields,
      revision = form.snapshot.revision,
      timeoutMs = 10_000,
    ) => {
      const result = await call("fill_fields", { tabId: form.tab.id, revision, fields, timeoutMs });
      await drain(form.contents);
      return { result, outcome: outcomeSchema.parse(json(result)) };
    };
    const close = (id: string) => runCauseEffect(host.close(id));
    const reverse = async (form: Awaited<ReturnType<typeof open>>) => {
      const result = await call("snapshot", { tabId: form.tab.id, image: "never" });
      const snapshot = snapshotSchema.parse(json(result));
      const ref = snapshot.elements.find((element) => element.name === "Field 8")?.ref;
      assert(ref, "Reverse input field missing.");
      const typed = await call("type", {
        tabId: form.tab.id,
        target: { kind: "ref", ref, revision: snapshot.revision },
        text: "reverse",
      });
      await drain(form.contents);
      assert(typed.success && recorded(form.id).at(-1)?.values.f8 === "reverse", "Single-field reverse input failed.");
    };
    assert(
      BROWSER_DYNAMIC_TOOLS.some((namespace) => namespace.tools.some((tool) => tool.name === "fill_fields")),
      "Original catalog lacks fill_fields.",
    );
    recordCases("original-deferred-catalog");

    phase("ordinary-form");
    const ordinary = await open();
    const ordinaryCount = commandCounts(ordinary.contents);
    const complete = await fill(ordinary);
    assert(
      complete.result.success && complete.outcome.status === "completed" && complete.outcome.confirmed.length === 8,
      "Eight-field fill failed.",
    );
    assert(
      ordinaryCount.snapshot() === 1 && recorded(ordinary.id).length === 8,
      "Batch did not use one final snapshot or eight native inputs.",
    );
    assert(
      recorded(ordinary.id).every((event) => event.trusted && !event.submitted),
      "Input was untrusted or submitted the form.",
    );
    assert(
      ordinary.fields.every((field, index) => recorded(ordinary.id).at(-1)?.values[`f${index + 1}`] === field.text),
      "Fixture values differ from requested values.",
    );
    ordinaryCount.restore();
    recordCases("eight-fields-one-snapshot", "trusted-input-no-submit");
    await reverse(ordinary);
    recordCases("single-type-after-success");
    await close(ordinary.tab.id);

    const textTypes = await open("text-types");
    const typeFields = textTypes.fields.map((field, index) => ({
      ...field,
      text: index === 0 ? "" : index === 7 ? "첫 줄\nsecond line" : field.text,
    }));
    assert((await fill(textTypes, typeFields)).result.success, "Ordinary input types or empty replacement failed.");
    await close(textTypes.tab.id);
    recordCases("native-text-types-textarea-empty-replacement");

    for (const [name, change] of [
      [
        "stale-revision",
        (form: Awaited<ReturnType<typeof open>>) => ({ fields: form.fields, revision: form.snapshot.revision + 1 }),
      ],
      [
        "missing-ref",
        (form: Awaited<ReturnType<typeof open>>) => ({
          fields: [{ ...firstField(form), ref: "missing" }],
          revision: form.snapshot.revision,
        }),
      ],
      [
        "duplicate-ref",
        (form: Awaited<ReturnType<typeof open>>) => ({
          fields: [firstField(form), firstField(form)],
          revision: form.snapshot.revision,
        }),
      ],
      [
        "utf8-byte-limit",
        (form: Awaited<ReturnType<typeof open>>) => ({
          fields: [{ ...firstField(form), text: "한".repeat(6000) }],
          revision: form.snapshot.revision,
        }),
      ],
    ] as const) {
      phase(name);
      const form = await open();
      const args = change(form);
      const result = await call("fill_fields", { tabId: form.tab.id, ...args });
      await drain(form.contents);
      assert(!result.success && recorded(form.id).length === 0, "Envelope refusal sent input.");
      await reverse(form);
      await close(form.tab.id);
      recordCases(name);
    }
    recordCases("single-type-after-refusal");
    phase("field-count-and-byte-limits");
    const countLimit = await open("seventeen");
    const seventeen = Array.from({ length: 17 }, (_, index) => ({
      ref: countLimit.field(`Field ${index + 1}`),
      text: `count-${index}`,
    }));
    assert(
      !(
        await call("fill_fields", {
          tabId: countLimit.tab.id,
          revision: countLimit.snapshot.revision,
          fields: seventeen,
        })
      ).success && recorded(countLimit.id).length === 0,
      "Seventeen valid fields sent input.",
    );
    assert((await fill(countLimit, seventeen.slice(0, 16))).result.success, "Sixteen valid fields were refused.");
    await close(countLimit.tab.id);
    const bytesLimit = await open();
    assert(
      (await fill(bytesLimit, [{ ...firstField(bytesLimit), text: `${"가".repeat(5461)}x` }])).result.success,
      "Exact UTF-8 limit was refused.",
    );
    await close(bytesLimit.tab.id);
    recordCases("sixteen-and-seventeen-fields", "exact-utf8-byte-limit");
    for (const [mode, label] of [
      ["disabled", "Field 2"],
      ["readonly", "Field 2"],
      ["password", "Sensitive"],
      ["otp", "Sensitive"],
      ["card", "Sensitive"],
      ["editable", "Editable"],
      ["frame", "Frame field"],
    ] as const) {
      const form = await open(mode);
      phase(`preflight-${mode}`);
      const { result } = await fill(form, [firstField(form), { ref: form.field(label), text: "synthetic" }]);
      assert(!result.success && recorded(form.id).length === 0, "Unsupported field preflight sent input.");
      await close(form.tab.id);
      recordCases(`preflight-${mode}`);
    }
    const hidden = await open();
    await hidden.contents.executeJavaScript("document.querySelector('#f2').hidden = true", false);
    const hiddenResult = (await fill(hidden)).result;
    assert(!hiddenResult.success && recorded(hidden.id).length === 0, "Hidden field preflight sent input.");
    assert(
      outcomeSchema.parse(json(hiddenResult)).reason === "invalid_target",
      "Hidden field preflight reported the wrong reason.",
    );
    await close(hidden.tab.id);
    recordCases("preflight-hidden");

    for (const mode of ["replace-next", "remove-next", "sensitive-next", "value-next"]) {
      phase(mode);
      const form = await open(mode);
      const { outcome } = await fill(form);
      assert(
        outcome.status === "partial" &&
          outcome.confirmed.length === 1 &&
          outcome.failedIndex === 1 &&
          recorded(form.id).length === 1,
        "Changed target received later input.",
      );
      await close(form.tab.id);
      recordCases(mode);
    }
    for (const mode of ["reload", "navigate"]) {
      phase(`document-${mode}`);
      const form = await open(mode);
      const { outcome } = await fill(form);
      assert(outcome.status === "partial" && recorded(form.id).length === 1, "New document received later input.");
      await close(form.tab.id);
      recordCases(`document-${mode}`);
    }

    const owned = await open();
    const crossAgent = await call(
      "fill_fields",
      { tabId: owned.tab.id, revision: owned.snapshot.revision, fields: owned.fields },
      "other-agent",
    );
    const crossThread = await runCauseEffect(
      host.handleDynamicTool({
        ...params("fill_fields", { tabId: owned.tab.id, revision: owned.snapshot.revision, fields: owned.fields }),
        threadId: "other-thread",
      }),
    );
    assert(
      !crossAgent.success && !crossThread.success && recorded(owned.id).length === 0,
      "Cross-owner batch sent input.",
    );
    await runCauseEffect(host.beginTakeover(owned.tab.id));
    assert(
      !(await call("fill_fields", { tabId: owned.tab.id, revision: owned.snapshot.revision, fields: owned.fields }))
        .success,
      "Takeover allowed batch input.",
    );
    host.endTakeover(owned.tab.id);
    await close(owned.tab.id);
    recordCases("agent-and-thread-ownership", "takeover-refusal");

    const seed = await open();
    await seed.contents.session.protocol.handle(
      "https",
      () =>
        new Response(
          "<label>Ordinary<input id='ordinary'></label><label>Password<input id='password' type='password'></label>",
          { headers: { "Content-Type": "text/html" } },
        ),
    );
    const protectedTab = await runCauseEffect(
      host.open("https://fill-protection.openbot.test/", "fixture-thread", "fixture-agent"),
    );
    const protectedSnapshot = snapshotSchema.parse(
      json(await call("snapshot", { tabId: protectedTab.id, image: "never" })),
    );
    const ordinaryRef = protectedSnapshot.elements.find((element) => element.name === "Ordinary")?.ref;
    const passwordRef = protectedSnapshot.elements.find((element) => element.name === "Password")?.ref;
    assert(ordinaryRef && passwordRef, "Protection fixture refs missing.");
    const protection = await runCauseEffect(
      host.prepareSecret(
        params("submit_secret", {
          tabId: protectedTab.id,
          method: "password",
          submission: "on_input",
          targets: [{ kind: "ref", ref: passwordRef, revision: protectedSnapshot.revision }],
        }),
      ),
    );
    assert(
      !(
        await call("fill_fields", {
          tabId: protectedTab.id,
          revision: protectedSnapshot.revision,
          fields: [{ ref: ordinaryRef, text: "synthetic" }],
        })
      ).success,
      "Protected document allowed ordinary batch.",
    );
    protection.cancel();
    await close(protectedTab.id);
    await seed.contents.session.protocol.unhandle("https");
    await close(seed.tab.id);
    recordCases("synthetic-pending-secret-protection");

    phase("interruption-and-closure");
    await interruptionCases(open, reverse, call, params, host, recorded, recordCases);

    const captureFailure = await open();
    const native = captureFailure.contents.debugger.sendCommand.bind(captureFailure.contents.debugger);
    captureFailure.contents.debugger.sendCommand = (method, params, sessionId) =>
      method === "Page.getLayoutMetrics"
        ? Promise.reject(new Error("password=synthetic-capture-marker-729104"))
        : native(method, params, sessionId);
    const failedCapture = await fill(captureFailure);
    assert(
      failedCapture.outcome.status === "snapshot_failed" &&
        failedCapture.outcome.inputCompleted &&
        failedCapture.outcome.confirmed.length === 8,
      "Capture failure lost completed input state.",
    );
    assert(
      !JSON.stringify(failedCapture.result).includes("synthetic-capture-marker-729104"),
      "Page exception leaked to provider output.",
    );
    captureFailure.contents.debugger.sendCommand = native;
    const diagnostics = await call("snapshot", { tabId: captureFailure.tab.id, image: "never" });
    assert(
      !JSON.stringify(diagnostics).includes("synthetic-capture-marker-729104"),
      "Page exception leaked to diagnostics.",
    );
    await close(captureFailure.tab.id);
    recordCases("capture-failure-preserves-completion", "redacted-page-exception");

    const samples: Array<{
      batchMs: number;
      singleMs: number;
      batchBytes: number;
      singleBytes: number;
      batchSnapshots: number;
      singleSnapshots: number;
      batchCalls: number;
      singleCalls: number;
    }> = [];
    phase("paired-measurements");
    for (let iteration = 0; iteration < 23; iteration += 1) {
      const pair = async (batch: boolean) => {
        const form = await open();
        const counts = commandCounts(form.contents);
        const callsBefore = (callsByTool.get("fill_fields") ?? 0) + (callsByTool.get("type") ?? 0);
        let bytes = 0;
        const start = performance.now();
        if (batch) {
          const { result } = await fill(form);
          assert(result.success, "Warm batch failed.");
          bytes = Buffer.byteLength(JSON.stringify(result));
        } else {
          let current = form.snapshot;
          for (const [index, field] of form.fields.entries()) {
            const ref = current.elements.find((element) => element.name === `Field ${index + 1}`)?.ref;
            assert(ref, "Warm single ref missing.");
            const result = await call("type", {
              tabId: form.tab.id,
              target: { kind: "ref", ref, revision: current.revision },
              text: field.text,
              snapshot: true,
            });
            assert(result.success, "Warm single fill failed.");
            bytes += Buffer.byteLength(JSON.stringify(result));
            current = snapshotSchema.parse(json(result));
          }
          await drain(form.contents);
        }
        const milliseconds = performance.now() - start;
        assert(
          recorded(form.id).length === 8 && recorded(form.id).every((event) => event.trusted && !event.submitted),
          "Warm fixture input evidence failed.",
        );
        const snapshots = counts.snapshot();
        const toolCalls = (callsByTool.get("fill_fields") ?? 0) + (callsByTool.get("type") ?? 0) - callsBefore;
        counts.restore();
        await close(form.tab.id);
        return { milliseconds, bytes, snapshots, toolCalls };
      };
      const first = await pair(iteration % 2 === 0);
      const second = await pair(iteration % 2 !== 0);
      const batch = iteration % 2 === 0 ? first : second;
      const single = iteration % 2 === 0 ? second : first;
      if (iteration >= 3)
        samples.push({
          batchMs: batch.milliseconds,
          singleMs: single.milliseconds,
          batchBytes: batch.bytes,
          singleBytes: single.bytes,
          batchSnapshots: batch.snapshots,
          singleSnapshots: single.snapshots,
          batchCalls: batch.toolCalls,
          singleCalls: single.toolCalls,
        });
      // Machine-readable: progress keeps the root aware while the serial fixture runs.
      process.stdout.write(`${JSON.stringify({ pairedRun: iteration + 1, warmup: iteration < 3 })}\n`);
    }
    assert(
      samples.every((sample) => sample.batchSnapshots === 1 && sample.singleSnapshots === 8),
      "Measured snapshot counts differ from contract.",
    );
    assert(
      samples.every((sample) => sample.batchCalls === 1 && sample.singleCalls === 8),
      "Measured tool call counts differ from contract.",
    );
    assert(!window.isVisible() && nativeFocusEvents === 0, "Fixture window became visible or focused.");
    recordCases("twenty-warm-paired-runs", "hidden-window-no-native-focus");
    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      platform: process.platform,
      architecture: process.arch,
      versions: {
        node: process.version,
        bun: argument("bun-version"),
        harnessNodeCompatibility: argument("harness-runtime"),
        electron: process.versions.electron,
        chromium: process.versions.chrome,
      },
      cases,
      warmupPairs: 3,
      measuredPairs: samples.length,
      samples,
      hostExecutionMs: {
        batch: {
          p50: percentile(
            samples.map((sample) => sample.batchMs),
            0.5,
          ),
          p95: percentile(
            samples.map((sample) => sample.batchMs),
            0.95,
          ),
        },
        single: {
          p50: percentile(
            samples.map((sample) => sample.singleMs),
            0.5,
          ),
          p95: percentile(
            samples.map((sample) => sample.singleMs),
            0.95,
          ),
        },
      },
      toolCallsPerPair: { batch: 1, single: 8 },
      snapshotCountsPerPair: { batch: 1, single: 8 },
      nativeFocusEvents,
      limits: { fields: 16, combinedUtf8Bytes: 16384, totalDeadlineMs: 30000 },
      scope:
        "Owned hidden native process, temporary profile, and synthetic forms. Host execution only. No provider calls, billable tokens, or model speed measured.",
    };
    assert(!JSON.stringify(report).includes("synthetic-capture-marker-729104"), "Synthetic marker leaked to artifact.");
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify({ status: "failed", runId, sourceSha: argument("source-sha"), phase: currentPhase, cases, nativeFocusEvents, reason: redactText(String(error)) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  } finally {
    phase("native-cleanup");
    if (browser) await runCauseEffect(browser.destroy());
    if (window && !window.isDestroyed()) window.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.exit(Number(process.exitCode ?? 0));
  }
}

function phase(name: string): void {
  currentPhase = name;
  // Machine-readable: startup and case receipts contain no page or input data.
  process.stdout.write(`${JSON.stringify({ runId, phase: name, status: "running" })}\n`);
}

function recordCases(...names: string[]): void {
  for (const name of names) {
    cases.push(name);
    // Machine-readable: emit only completed case names after their assertions.
    process.stdout.write(`${JSON.stringify({ runId, case: name, status: "passed" })}\n`);
  }
}

function commandCounts(contents: WebContents) {
  const native = contents.debugger.sendCommand.bind(contents.debugger);
  let snapshots = 0;
  contents.debugger.sendCommand = (method, params, sessionId) => {
    if (method === "Page.getLayoutMetrics") snapshots += 1;
    return native(method, params, sessionId);
  };
  return {
    snapshot: () => snapshots,
    restore: () => {
      contents.debugger.sendCommand = native;
    },
  };
}

function percentile(samples: number[], fraction: number): number {
  const sorted = samples.toSorted((left, right) => left - right);
  const result = sorted[Math.ceil(sorted.length * fraction) - 1];
  assert(result !== undefined, "Empty fixture measurements.");
  return result;
}

function firstField(form: FixtureForm): { ref: string; text: string } {
  const field = form.fields[0];
  assert(field, "Fixture has no ordinary field.");
  return field;
}

/** Gates sit after real native dispatch. They delay acknowledgment, never replace page input. */
async function interruptionCases(
  open: (mode?: string) => Promise<FixtureForm>,
  reverse: (form: FixtureForm) => Promise<void>,
  call: FixtureCall,
  params: FixtureParams,
  host: BrowserHost,
  recorded: (id: string) => FormEvent[],
  completed: (...names: string[]) => void,
): Promise<void> {
  const before = await open();
  const entered = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const native = before.contents.debugger.sendCommand.bind(before.contents.debugger);
  let held = false;
  before.contents.debugger.sendCommand = async (method, args, sessionId) => {
    const result = await native(method, args, sessionId);
    if (method === "Page.getLayoutMetrics" && !held) {
      held = true;
      Deferred.doneUnsafe(entered, Effect.void);
      await Effect.runPromise(Deferred.await(release));
    }
    return result;
  };
  const holder = call("snapshot", { tabId: before.tab.id, image: "never" });
  await Effect.runPromise(Deferred.await(entered));
  const batchParams = params("fill_fields", {
    tabId: before.tab.id,
    revision: before.snapshot.revision,
    fields: before.fields,
  });
  const batchStarted = controlStarted(host, batchParams.callId);
  const queued = Effect.runFork(host.handleDynamicTool(batchParams));
  await batchStarted;
  await Effect.runPromise(Fiber.interrupt(queued));
  await Effect.runPromise(Deferred.succeed(release, undefined));
  await holder;
  before.contents.debugger.sendCommand = native;
  await before.contents.executeJavaScript("window.fixtureDrain()", false);
  assert(recorded(before.id).length === 0, "Queued cancellation sent input.");
  await reverse(before);
  await runCauseEffect(host.close(before.tab.id));
  completed("cancel-before-dispatch", "single-type-after-interruption");

  for (const mode of ["cancel", "deadline", "owned-cancel", "owned-deadline", "takeover", "close"] as const) {
    phase(`during-input-${mode}`);
    const form = await open();
    if (mode === "close") phase("during-input-close-opened");
    // Attaching externally covers the engine's unabortable debugger path.
    if (!mode.startsWith("owned-")) form.contents.debugger.attach("1.3");
    const cancellation = mode.endsWith("cancel");
    const deadline = mode.endsWith("deadline");
    const dispatched = Deferred.makeUnsafe<void>();
    const acknowledge = Deferred.makeUnsafe<void>();
    const nextCommand = Deferred.makeUnsafe<void>();
    const destroyed = Deferred.makeUnsafe<void>();
    if (mode === "close") {
      form.contents.once("destroyed", () => {
        Deferred.doneUnsafe(destroyed, Effect.void);
        phase("during-input-close-native-destroyed");
      });
    }
    const send = form.contents.debugger.sendCommand.bind(form.contents.debugger);
    let firstInput = true;
    let released = false;
    let laterCommandBeforeRelease = false;
    let lifecycle: Fiber.Fiber<void, BrowserOperationError> | undefined;
    form.contents.debugger.sendCommand = async (method, args, sessionId) => {
      if (method === "Input.insertText" && firstInput) {
        firstInput = false;
        const result = await send(method, args, sessionId);
        if (mode === "close") phase("during-input-close-input-acknowledged");
        Deferred.doneUnsafe(dispatched, Effect.void);
        if (mode === "takeover") lifecycle = Effect.runFork(host.beginTakeover(form.tab.id));
        if (mode === "close") {
          lifecycle = Effect.runFork(host.close(form.tab.id));
          phase("during-input-close-lifecycle-started");
        }
        if (cancellation || deadline) await Effect.runPromise(Deferred.await(acknowledge));
        return result;
      }
      if (!firstInput && method === "Input.insertText" && !released) laterCommandBeforeRelease = true;
      if (!firstInput && method === "Page.getLayoutMetrics") Deferred.doneUnsafe(nextCommand, Effect.void);
      return send(method, args, sessionId);
    };
    const fiber = Effect.runFork(
      host.handleDynamicTool(
        params("fill_fields", {
          tabId: form.tab.id,
          revision: form.snapshot.revision,
          fields: form.fields,
          // Three seconds is the deadline exercise bound. Success waits for actual dispatch;
          // this does not assert how fast preflight must complete.
          timeoutMs: deadline ? 3_000 : 10_000,
        }),
      ),
    );
    try {
      await Effect.runPromise(Deferred.await(dispatched));
      let deadlineResult: DynamicToolResult | undefined;
      if (cancellation) fiber.interruptUnsafe();
      if (deadline) {
        deadlineResult = await runCauseEffect(Fiber.join(fiber));
        const content = deadlineResult.contentItems.find((item) => item.type === "inputText");
        assert(content?.type === "inputText", "Deadline result missing.");
        const outcome = outcomeSchema.parse(JSON.parse(content.text));
        assert(
          outcome.reason === "deadline" && outcome.confirmed.length === 0 && outcome.uncertainIndex === 0,
          "Deadline lost uncertain progress.",
        );
      }
      if (cancellation || deadline) {
        const captureParams = params("snapshot", { tabId: form.tab.id, image: "never" });
        const captureStarted = controlStarted(host, captureParams.callId);
        const queuedSnapshot = runCauseEffect(host.handleDynamicTool(captureParams));
        // A control event proves the next call entered the host while the native acknowledgment
        // is still held. Its capture must remain behind the old queue slot.
        await captureStarted;
        assert(!Deferred.isDoneUnsafe(nextCommand), "A later queued capture overtook held native input.");
        released = true;
        await Effect.runPromise(Deferred.succeed(acknowledge, undefined));
        await Effect.runPromise(Fiber.await(fiber));
        await queuedSnapshot;
        await reverse(form);
      } else {
        const result = await runCauseEffect(Fiber.join(fiber));
        if (mode === "close") phase("during-input-close-fill-response");
        assert(!result.success, "A policy change or closure allowed the rest of the batch.");
        if (mode === "close") {
          const content = result.contentItems.find((item) => item.type === "inputText");
          assert(content?.type === "inputText", "Close result missing.");
          const outcome = outcomeSchema.parse(JSON.parse(content.text));
          assert(
            outcome.reason === "tab_closed" && outcome.uncertainIndex === 0 && outcome.confirmed.length === 0,
            "Close result lost uncertain input state.",
          );
          phase("during-input-close-await-drain");
        }
        if (lifecycle) await runCauseEffect(Fiber.join(lifecycle));
        if (mode === "close") {
          phase("during-input-close-drain-complete");
          await Effect.runPromise(Deferred.await(destroyed));
          assert(form.contents.isDestroyed(), "Closed fixture contents remain alive.");
        }
        if (mode === "takeover") host.endTakeover(form.tab.id);
      }
      assert(!laterCommandBeforeRelease, "Later input was dispatched during held acknowledgment.");
      // Native close returns before its destroyed event. Never run fixture JavaScript on
      // closing contents merely because isDestroyed() is not true yet.
      if (mode !== "close" && !form.contents.isDestroyed()) {
        form.contents.debugger.sendCommand = send;
        if (form.contents.debugger.isAttached()) form.contents.debugger.detach();
        await form.contents.executeJavaScript("window.fixtureDrain()", false);
      }
      // Reverse input adds one event only in the interrupted cases.
      assert(
        recorded(form.id).filter((event) => event.values.f8 !== "reverse").length === 1,
        "An undispatched field received input after abort.",
      );
      await runCauseEffect(host.close(form.tab.id));
      completed(`during-input-${mode}`);
    } finally {
      released = true;
      Deferred.doneUnsafe(acknowledge, Effect.void);
      fiber.interruptUnsafe();
      await Effect.runPromise(Fiber.await(fiber));
      if (!form.contents.isDestroyed()) {
        form.contents.debugger.sendCommand = send;
        if (form.contents.debugger.isAttached()) form.contents.debugger.detach();
      }
      if (lifecycle) await Effect.runPromise(Fiber.await(lifecycle));
    }
  }
}

function controlStarted(host: BrowserHost, callId: string): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = host.onControlChanged((state) => {
      if (!state.sessions.some((session) => session.callId === callId && session.phase === "acting")) return;
      unsubscribe();
      resolve();
    });
  });
}

function formPage(id: string, mode: string): string {
  const inputs = Array.from({ length: mode === "seventeen" ? 17 : 8 }, (_, index) => {
    if (mode === "text-types" && index === 7)
      return '<label>Field 8<textarea id="f8" name="f8">old-8</textarea></label>';
    const type = mode === "text-types" ? ["text", "search", "tel", "url", "email"][index % 5] : "text";
    return `<label>Field ${index + 1}<input id="f${index + 1}" name="f${index + 1}" type="${type}" value="old-${index + 1}" ${index === 1 && mode === "disabled" ? "disabled" : ""} ${index === 1 && mode === "readonly" ? "readonly" : ""}></label>`;
  }).join("");
  const sensitive =
    mode === "password"
      ? 'type="password"'
      : mode === "otp"
        ? 'autocomplete="one-time-code"'
        : 'autocomplete="section-pay billing cc-number"';
  return `<!doctype html><meta charset="utf-8"><form>${inputs}
    ${["password", "otp", "card"].includes(mode) ? `<label>Sensitive<input id="sensitive" ${sensitive}></label>` : ""}
    ${mode === "editable" ? '<div contenteditable="true" role="textbox" aria-label="Editable">old</div>' : ""}
    ${mode === "frame" ? '<iframe title="Frame" srcdoc="<label>Frame field<input></label>"></iframe>' : ""}
    <button>Submit</button></form><script>
    const id = ${JSON.stringify(id)}, mode = ${JSON.stringify(mode)}, pending = [];
    window.fixtureDrain = () => Promise.all(pending);
    const record = (event, submitted) => {
      pending.push(fetch('/event', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field: event.target.id || '', trusted: event.isTrusted, submitted, values: Object.fromEntries([...document.querySelectorAll('input,textarea')].map(field => [field.id, field.value])) }) }));
    };
    document.addEventListener('submit', event => { event.preventDefault(); record(event, true); });
    document.addEventListener('input', event => {
      record(event, false);
      if (event.target.id !== 'f1') return;
      const next = document.querySelector('#f2');
      if (mode === 'replace-next') next.replaceWith(next.cloneNode());
      if (mode === 'remove-next') next.remove();
      if (mode === 'sensitive-next') next.autocomplete = 'one-time-code';
      if (mode === 'value-next') next.value = 'changed-by-page';
      if (mode === 'reload') location.reload();
      if (mode === 'navigate') location.href = '/form?id=' + id + '&mode=ordinary&newDocument=1';
    });</script>`;
}
