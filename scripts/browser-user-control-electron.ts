import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import type { AgentEvent, BrowserTab } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { Effect, Exit } from "effect";
import { app, BrowserWindow, type WebContents, webContents } from "electron";
import { z } from "zod";
import { browserUserControlResult } from "../src/backend/agent/prompts";
import { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams, DynamicToolResult } from "../src/backend/protocol";
import { RemoteEventRefresh } from "../src/main/remote-server-event-refresh";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

const cases: string[] = [];
const resultSchema = z.object({ status: z.literal("user-control-ended"), note: z.string(), next: z.string() });

// `/slow` never answers, so only a stop ends its load.
const server = createServer((request, response) => {
  if (request.url === "/slow") return;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end('<!doctype html><meta charset="utf-8"><title>Fixture</title><button>Fixture button</button>');
});

let browser: BrowserHost | undefined;
let window: BrowserWindow | undefined;
let sequence = 0;
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
    await app.whenReady();
    phase("electron-ready");
    window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"));
    const host = browser;
    const params = (tool: string, args: DynamicToolCallParams["arguments"]): DynamicToolCallParams => ({
      namespace: "openbot_browser",
      tool,
      arguments: args,
      ownerAgentId: "fixture-agent",
      threadId: "fixture-thread",
      turnId: "fixture-turn",
      callId: `user-control-${++sequence}`,
    });
    // The same composition as the browser branch of `OpenBotToolRouter`: a held tab waits before the
    // call, a call that the hold reaches in the tab queue waits through the hook, and the turn's
    // cancellation interrupts either wait.
    const routed = (
      call: DynamicToolCallParams,
      signal: AbortSignal,
    ): Promise<Exit.Exit<DynamicToolResult, unknown>> => {
      const userControl = (tabId: string) =>
        host.awaitUserControlRelease(tabId).pipe(Effect.as(browserUserControlResult()));
      const operation = Effect.suspend(() => {
        const heldTabId = host.userControlTabFor(call);
        return heldTabId ? userControl(heldTabId) : host.handleDynamicTool(call, { onUserControl: userControl });
      });
      const cancelled = Effect.callback<never>((resume) => {
        const abort = () => resume(Effect.interrupt);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
        return Effect.sync(() => signal.removeEventListener("abort", abort));
      });
      return Effect.runPromiseExit(operation.pipe(Effect.raceFirst(cancelled)));
    };
    const settled = <A>(promise: Promise<A>) => {
      const state = { done: false };
      void promise.finally(() => {
        state.done = true;
      });
      return state;
    };
    // A settled promise runs its callbacks before the next macrotask, so this proves "still waiting"
    // without a timer that guesses how long the host needs.
    const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
    const open = async () => {
      const tab = await runCauseEffect(host.open(`${origin}/page-${++sequence}`, "fixture-thread", "fixture-agent"));
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      assert(contents, "Missing fixture contents.");
      return { tab, contents };
    };
    const listed = (tabId: string): BrowserTab | undefined => host.listTabs().find((tab) => tab.id === tabId);
    const success = (exit: Exit.Exit<DynamicToolResult, unknown>) => {
      assert(Exit.isSuccess(exit), "Tool call failed.");
      return exit.value;
    };
    const userControlEnded = (result: DynamicToolResult) => {
      assert.equal(result.success, true);
      const text = result.contentItems.find((item) => item.type === "inputText");
      assert(text?.type === "inputText", "Missing user control result text.");
      resultSchema.parse(JSON.parse(text.text));
    };
    const startBlockingEvaluate = async (tabId: string, contents: WebContents, signal: AbortSignal) => {
      const call = params("evaluate", {
        tabId,
        expression: "new Promise((resolve) => { window.fixtureFinish = resolve; })",
        awaitPromise: true,
        timeoutMs: 30_000,
      });
      const started = controlStarted(host, call.callId);
      const running = routed(call, signal);
      await started;
      // The page owns the promise, so the action ends only when the fixture says so.
      await contents.executeJavaScript(
        "new Promise((resolve) => { const ready = () => (window.fixtureFinish ? resolve() : requestAnimationFrame(ready)); ready(); })",
      );
      return {
        running,
        finish: () => contents.executeJavaScript("window.fixtureFinish('finished')"),
      };
    };

    phase("cases");
    const never = new AbortController().signal;

    {
      const { tab } = await open();
      const changes: boolean[] = [];
      const unsubscribe = host.onChanged((tabs) => {
        changes.push(tabs.find((item) => item.id === tab.id)?.userControl === true);
      });
      await runCauseEffect(host.takeUserControl(tab.id, { kind: "local" }));
      assert.equal(listed(tab.id)?.userControl, true);
      assert(changes.includes(true), "The take did not report the held tab.");
      await runCauseEffect(host.takeUserControl(tab.id, { kind: "local" }));
      recordCases("take-marks-tab", "take-is-idempotent");

      const waiting = routed(params("snapshot", { tabId: tab.id, image: "never" }), never);
      const state = settled(waiting);
      await turn();
      assert.equal(state.done, false, "A call on a held tab did not wait.");
      host.releaseUserControl(tab.id);
      userControlEnded(success(await waiting));
      assert.equal(listed(tab.id)?.userControl, undefined);
      assert.equal(changes.at(-1), false, "The release did not report the tab.");
      host.releaseUserControl(tab.id);
      unsubscribe();
      const after = success(await routed(params("snapshot", { tabId: tab.id, image: "never" }), never));
      assert.equal(after.success, true, "A call after the release did not run.");
      recordCases(
        "held-call-waits",
        "release-returns-user-control-result",
        "release-is-idempotent",
        "call-runs-after-release",
      );
    }

    {
      const { tab } = await open();
      await runCauseEffect(host.takeUserControl(tab.id, { kind: "local" }));
      const listing = routed(params("list_tabs", {}), never);
      const listingState = settled(listing);
      await turn();
      assert.equal(listingState.done, false, "A tab list ran while a tab was held.");
      host.releaseUserControl(tab.id);
      userControlEnded(success(await listing));
      const afterRelease = success(await routed(params("list_tabs", {}), never));
      assert.equal(afterRelease.success, true, "A tab list after the release did not run.");
      recordCases("tab-list-waits-for-held-tab", "tab-list-runs-after-release");
    }

    {
      const { tab, contents } = await open();
      const action = await startBlockingEvaluate(tab.id, contents, never);
      const queued = routed(params("snapshot", { tabId: tab.id, image: "never" }), never);
      // The queued call takes its place in the tab queue before the take does.
      await turn();
      const take = runCauseEffect(host.takeUserControl(tab.id, { kind: "local" }));
      const takeState = settled(take);
      await turn();
      assert.equal(takeState.done, false, "The take did not wait for the running action.");
      assert.equal(listed(tab.id)?.userControl, true, "The take did not mark the tab at once.");
      await action.finish();
      const finished = success(await action.running);
      assert.equal(finished.success, true, "The running action did not end normally.");
      await take;
      const queuedState = settled(queued);
      await turn();
      assert.equal(queuedState.done, false, "A queued call ran on a held tab.");
      host.releaseUserControl(tab.id);
      userControlEnded(success(await queued));
      recordCases(
        "running-action-ends-normally",
        "take-resolves-after-running-action",
        "queued-call-waits-through-hook",
      );
    }

    {
      const { tab } = await open();
      await runCauseEffect(host.takeUserControl(tab.id, { kind: "local" }));
      const controller = new AbortController();
      const waiting = routed(params("snapshot", { tabId: tab.id, image: "never" }), controller.signal);
      await turn();
      controller.abort();
      const exit = await waiting;
      assert(Exit.isFailure(exit) && Exit.hasInterrupts(exit), "Cancellation did not end the wait.");
      assert.equal(listed(tab.id)?.userControl, true, "Cancellation released the tab.");
      host.releaseUserControl(tab.id);
      recordCases("cancellation-ends-wait");

      await runCauseEffect(host.takeUserControl(tab.id, { kind: "local" }));
      const closing = routed(params("snapshot", { tabId: tab.id, image: "never" }), never);
      await turn();
      await runCauseEffect(host.close(tab.id));
      userControlEnded(success(await closing));
      assert.equal(listed(tab.id), undefined);
      recordCases("close-ends-wait");
    }

    {
      const local = await open();
      const member = await open();
      const other = await open();
      await runCauseEffect(host.takeUserControl(local.tab.id, { kind: "local" }));
      await runCauseEffect(host.takeUserControl(member.tab.id, { kind: "member", memberId: "m1", sessionId: "s1" }));
      await runCauseEffect(host.takeUserControl(other.tab.id, { kind: "member", memberId: "m2", sessionId: "s2" }));
      host.releaseUserControlHeldBy({ kind: "local" });
      assert.equal(listed(local.tab.id)?.userControl, undefined, "Window close kept the local hold.");
      assert.equal(listed(member.tab.id)?.userControl, true, "Window close released a member hold.");
      host.releaseUserControlHeldBy({ kind: "session", sessionId: "s1" });
      assert.equal(listed(member.tab.id)?.userControl, undefined, "Session end kept its hold.");
      assert.equal(listed(other.tab.id)?.userControl, true, "Session end released another session's hold.");
      host.releaseUserControlHeldBy({ kind: "member", memberId: "m2" });
      assert.equal(listed(other.tab.id)?.userControl, undefined, "Member removal kept the member's hold.");
      recordCases(
        "window-close-releases-local-holds",
        "session-end-releases-its-holds",
        "member-end-releases-its-holds",
      );
    }

    {
      const missing = await runCauseEffect(host.takeUserControl("missing-tab", { kind: "local" })).then(
        () => null,
        (error: unknown) => error,
      );
      assert(missing instanceof Error, "A take of a missing tab did not fail.");
      recordCases("take-refuses-missing-tab");
    }

    {
      const { tab } = await open();
      assert.equal(listed(tab.id)?.canGoBack, false, "A new tab reported a page to go back to.");
      assert.equal(listed(tab.id)?.canGoForward, false, "A new tab reported a page to go forward to.");
      await runCauseEffect(host.loadUrl(tab.id, `${origin}/page-${++sequence}`));
      assert.equal(listed(tab.id)?.canGoBack, true, "A second page did not allow Back.");
      assert.equal(listed(tab.id)?.canGoForward, false);
      await runCauseEffect(host.navigate(tab.id, "back"));
      assert.equal(listed(tab.id)?.canGoBack, false, "The first page allowed Back.");
      assert.equal(listed(tab.id)?.canGoForward, true, "Back did not allow Forward.");
      recordCases("history-state-follows-navigation");

      const started = new Promise<void>((resolve) => {
        const unsubscribe = host.onChanged((tabs) => {
          if (!tabs.some((item) => item.id === tab.id && item.loading)) return;
          unsubscribe();
          resolve();
        });
      });
      const loading = runCauseEffect(host.loadUrl(tab.id, `${origin}/slow`));
      await started;
      await runCauseEffect(host.stop(tab.id));
      await loading;
      assert.equal(listed(tab.id)?.loading, false, "The stopped tab still loads.");
      await runCauseEffect(host.stop(tab.id));
      const after = success(await routed(params("snapshot", { tabId: tab.id, image: "never" }), never));
      assert.equal(after.success, true, "The tab did not work after a stop.");
      recordCases("stop-ends-load-as-done", "stop-of-idle-tab-is-noop", "tab-works-after-stop");
    }

    {
      const emitted: AgentEvent[] = [];
      const refresh = new RemoteEventRefresh({
        request: () => Effect.die(new Error("This fixture makes no request.")),
        hasServer: () => true,
        emit: (_serverId, event) => emitted.push(event),
      });
      const tab = {
        id: "remote-tab",
        title: "Remote",
        url: "https://remote.test",
        loading: false,
        ownerThreadId: null,
        ownerAgentId: null,
      };
      await Effect.runPromise(
        refresh.forward("server-1", { type: "browser-changed", tabs: [tab], activeTabId: tab.id }),
      );
      await Effect.runPromise(refresh.forward("server-1", { type: "browser-user-control-changed", tabIds: [tab.id] }));
      const merged = emitted.at(-1);
      assert(merged?.type === "browser-changed" && merged.tabs[0]?.userControl === true, "Remote hold was not merged.");
      await Effect.runPromise(
        refresh.forward("server-1", { type: "browser-changed", tabs: [tab], activeTabId: tab.id }),
      );
      const kept = emitted.at(-1);
      assert(
        kept?.type === "browser-changed" && kept.tabs[0]?.userControl === true,
        "A tab change lost the remote hold.",
      );
      await Effect.runPromise(refresh.forward("server-1", { type: "browser-user-control-changed", tabIds: [] }));
      const released = emitted.at(-1);
      assert(
        released?.type === "browser-changed" && released.tabs[0]?.userControl === undefined,
        "Remote release was not merged.",
      );
      await Effect.runPromise(
        refresh.forward("server-1", {
          type: "browser-page-state-changed",
          tabs: [{ tabId: tab.id, canGoBack: true, canGoForward: false }],
        }),
      );
      const paged = emitted.at(-1);
      assert(
        paged?.type === "browser-changed" && paged.tabs[0]?.canGoBack === true && paged.tabs[0].canGoForward === false,
        "Remote page state was not merged.",
      );
      await Effect.runPromise(
        refresh.forward("server-1", { type: "browser-changed", tabs: [tab], activeTabId: tab.id }),
      );
      const pageKept = emitted.at(-1);
      assert(
        pageKept?.type === "browser-changed" && pageKept.tabs[0]?.canGoBack === true,
        "A tab change lost the remote page state.",
      );
      refresh.forget("server-1");
      await Effect.runPromise(refresh.forward("server-1", { type: "browser-user-control-changed", tabIds: [tab.id] }));
      assert.equal(emitted.at(-1)?.type, "browser-user-control-changed", "A forgotten server kept its tab list.");
      recordCases(
        "remote-event-merges-hold",
        "remote-tab-change-keeps-hold",
        "remote-release-clears-hold",
        "remote-event-merges-page-state",
        "remote-tab-change-keeps-page-state",
        "remote-forget-clears-state",
      );
    }

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      cases,
      scope:
        "Owned hidden native process, temporary profile, and a loopback page. BrowserHost with the tool router's composition, the history state and Stop, and the remote event merge. No provider calls, no Team API transport, no secret request.",
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      `${JSON.stringify({ status: "failed", runId, sourceSha: argument("source-sha"), phase: currentPhase, cases, reason: redactText(String(error)) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  } finally {
    phase("native-cleanup");
    if (browser) await runCauseEffect(browser.destroy());
    if (window && !window.isDestroyed()) window.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.exit(Number(process.exitCode ?? 0));
  }
}

function phase(name: string): void {
  currentPhase = name;
  // Machine-readable: phase receipts contain no page data.
  process.stdout.write(`${JSON.stringify({ runId, phase: name, status: "running" })}\n`);
}

function recordCases(...names: string[]): void {
  for (const name of names) {
    cases.push(name);
    process.stdout.write(`${JSON.stringify({ runId, case: name, status: "passed" })}\n`);
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
