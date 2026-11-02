import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect, Fiber } from "effect";
import { app, BrowserWindow, webContents } from "electron";
import { z } from "zod";
import { BrowserHost } from "../src/backend/browser-host";
import { BROWSER_DYNAMIC_TOOLS, BROWSER_SCRIPT_MAX_STEPS } from "../src/backend/browser-tools";
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

const cases: string[] = [];
const snapshotSchema = z.object({ tabId: z.string(), revision: z.number(), url: z.string() });
const scriptSchema = z.object({
  tabId: z.string(),
  status: z.enum(["completed", "failed", "timeout", "step_limit", "user_control", "tab_closed"]),
  value: z.unknown().optional(),
  error: z.string().optional(),
  steps: z.number(),
  log: z.array(z.string()).optional(),
  url: z.string().optional(),
  snapshot: snapshotSchema.optional(),
});

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (url.pathname === "/list") response.end(listPage(Number(url.searchParams.get("page") ?? "1")));
  else response.end(formPage());
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
      callId: `steps-${++sequence}`,
    });
    const call = (tool: string, args: DynamicToolCallParams["arguments"]) =>
      runCauseEffect(host.handleDynamicTool(params(tool, args)));
    const text = (result: DynamicToolResult) => {
      const item = result.contentItems.find((content) => content.type === "inputText");
      assert(item?.type === "inputText", "Missing fixture tool text.");
      return item.text;
    };
    const open = async (path: string) => {
      const tab = await runCauseEffect(host.open(`${origin}${path}`, "fixture-thread", "fixture-agent"));
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      assert(contents, "Missing owned fixture contents.");
      const first = snapshotSchema.parse(
        parseBrowserToolText(text(await call("snapshot", { tabId: tab.id, image: "never" }))),
      );
      return { tab, contents, revision: first.revision };
    };
    const runScript = async (args: DynamicToolCallParams["arguments"]) => {
      const result = await call("run_script", args);
      return { result, outcome: scriptSchema.parse(parseBrowserToolText(text(result))) };
    };
    const close = (id: string) => runCauseEffect(host.close(id));

    const tools: string[] = BROWSER_DYNAMIC_TOOLS.flatMap((namespace) => namespace.tools.map((tool) => tool.name));
    assert(tools.includes("run_script") && !tools.includes("run_steps"), "The catalog lacks run_script alone.");
    recordCases("catalog-lists-run-script");

    phase("script-sequence");
    const form = await open("/form");
    const searched = await runScript({
      tabId: form.tab.id,
      script: `
        await type("#query", "openbot");
        await click(role("button", "Search"));
        await waitFor("Result: openbot");
        return await evaluate("document.querySelector('#out').textContent");
      `,
    });
    assert.equal(searched.result.success, true, searched.outcome.error);
    assert.equal(searched.outcome.status, "completed");
    assert.equal(searched.outcome.steps, 4);
    assert.equal(searched.outcome.value, "Result: openbot");
    // Each snapshot raises the revision by one: one final capture, none per step.
    assert.equal(searched.outcome.snapshot?.revision, form.revision + 1, "Script steps took snapshots of their own.");
    recordCases("script-runs-steps-in-order", "script-takes-one-final-snapshot");

    const quiet = await runScript({
      tabId: form.tab.id,
      finalSnapshot: false,
      script: `return [await evaluate("1 + 1"), await step({ action: "evaluate", expression: "document.title" })];`,
    });
    assert.equal(quiet.outcome.snapshot, undefined, "finalSnapshot=false returned a snapshot.");
    assert.deepEqual(quiet.outcome.value, [2, "Form"]);
    recordCases("script-without-final-snapshot", "script-runs-named-step");

    const stopped = await runScript({
      tabId: form.tab.id,
      script: `await evaluate("void (window.before = 1)"); await click("#missing", { timeoutMs: 500 }); await evaluate("void (window.after = 1)");`,
    });
    assert.equal(stopped.result.success, false);
    assert.equal(stopped.outcome.status, "failed");
    assert.deepEqual(await form.contents.executeJavaScript("[window.before, window.after]"), [1, undefined]);
    assert(stopped.outcome.snapshot, "A failed script lost its final snapshot.");
    recordCases("script-stops-at-failed-step");

    const navigated = await runScript({
      tabId: form.tab.id,
      script: `
        await navigate(${JSON.stringify(`${origin}/list?page=2`)});
        await click(text("Next"));
        await waitFor({ url: ${JSON.stringify(`${origin}/list?page=3`)} });
        return await evaluate("document.querySelectorAll('li').length");
      `,
    });
    assert.equal(navigated.outcome.status, "completed", navigated.outcome.error);
    assert.equal(navigated.outcome.value, 3);
    assert.equal(navigated.outcome.snapshot?.url, `${origin}/list?page=3`);
    recordCases("script-crosses-navigation");

    phase("user-control");
    const held = await open("/form");
    const holding = runScript({
      tabId: held.tab.id,
      script: `
        await evaluate("new Promise((resolve) => { window.fixtureFinish = resolve; })");
        await click(role("button", "Search"));
      `,
    });
    await held.contents.executeJavaScript(
      "new Promise((resolve) => { const ready = () => (window.fixtureFinish ? resolve() : requestAnimationFrame(ready)); ready(); })",
    );
    // The take waits in the tab queue behind the running step, so it is not awaited here.
    const take = Effect.runFork(host.takeUserControl(held.tab.id, { kind: "local" }));
    await held.contents.executeJavaScript("window.fixtureFinish('done')");
    const heldOutcome = await holding;
    await runCauseEffect(Fiber.join(take));
    assert.equal(heldOutcome.outcome.status, "user_control");
    assert.equal(heldOutcome.outcome.snapshot, undefined, "A held tab returned a snapshot.");
    assert.equal(await held.contents.executeJavaScript("window.clicks"), 0, "A step acted on a held tab.");
    host.releaseUserControl(held.tab.id);
    recordCases("script-stops-at-user-control");

    // The person takes the tab during the last step: the script is done, but the final snapshot is
    // refused. The result keeps the value, so that the agent does not run the steps again.
    await held.contents.executeJavaScript("delete window.fixtureFinish");
    const late = runScript({
      tabId: held.tab.id,
      script: `
        const value = await evaluate("new Promise((resolve) => { window.fixtureFinish = resolve; })");
        return { value };
      `,
    });
    await held.contents.executeJavaScript(
      "new Promise((resolve) => { const ready = () => (window.fixtureFinish ? resolve() : requestAnimationFrame(ready)); ready(); })",
    );
    const lateTake = Effect.runFork(host.takeUserControl(held.tab.id, { kind: "local" }));
    await held.contents.executeJavaScript("window.fixtureFinish('late')");
    const lateOutcome = await late;
    await runCauseEffect(Fiber.join(lateTake));
    assert.equal(lateOutcome.outcome.status, "user_control");
    assert.deepEqual(lateOutcome.outcome.value, { value: "late" }, "The script result was lost.");
    assert.equal(lateOutcome.outcome.steps, 1);
    assert.equal(lateOutcome.outcome.snapshot, undefined, "A held tab returned a snapshot.");
    host.releaseUserControl(held.tab.id);
    recordCases("script-keeps-result-when-snapshot-refused");

    phase("secret-protection");
    const seed = await open("/form");
    await seed.contents.session.protocol.handle(
      "https",
      () =>
        new Response("<label>Password<input id='password' type='password'></label>", {
          headers: { "Content-Type": "text/html" },
        }),
    );
    const protectedTab = await runCauseEffect(
      host.open("https://steps-protection.openbot.test/", "fixture-thread", "fixture-agent"),
    );
    const protectedSnapshot = z
      .object({ revision: z.number(), elements: z.array(z.object({ ref: z.string(), name: z.string() })) })
      .parse(parseBrowserToolText(text(await call("snapshot", { tabId: protectedTab.id, image: "never" }))));
    const passwordRef = protectedSnapshot.elements.find((element) => element.name === "Password")?.ref;
    assert(passwordRef, "Protection fixture ref missing.");
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
    const refusedScript = await call("run_script", { tabId: protectedTab.id, script: "return 1;" });
    assert.equal(refusedScript.success, false, "A protected tab ran a script.");
    protection.cancel();
    await close(protectedTab.id);
    await seed.contents.session.protocol.unhandle("https");
    await close(seed.tab.id);
    recordCases("script-refuses-protected-tab");

    phase("run-script");
    const list = await open("/list?page=1");
    const looped = await runScript({
      tabId: list.tab.id,
      script: `
        const items = [];
        for (;;) {
          items.push(...(await evaluate(() => [...document.querySelectorAll("li")].map((item) => item.textContent))));
          const hasNext = await evaluate("Boolean(document.querySelector('a.next'))");
          if (!hasNext) break;
          await click("a.next");
          log("page", items.length);
        }
        return items;
      `,
    });
    assert.equal(looped.result.success, true, looped.outcome.error);
    assert.deepEqual(
      looped.outcome.value,
      [1, 2, 3].flatMap((page) => [1, 2, 3].map((item) => `item-${page}-${item}`)),
    );
    assert.equal(looped.outcome.log?.length, 2);
    // Each navigation also raises the revision: two pages, then the one final capture.
    assert.equal(looped.outcome.snapshot?.revision, list.revision + 3, "Script steps took snapshots.");
    recordCases("script-loops-across-pages", "script-returns-value", "script-keeps-log", "script-one-final-snapshot");

    const caught = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: `try { await click("#missing", { timeoutMs: 300 }); return "no"; } catch (error) { return "caught"; }`,
    });
    assert.equal(caught.outcome.value, "caught", "A failed helper did not throw into the script.");
    recordCases("script-catches-step-error");

    const isolated = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: "return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof XMLHttpRequest];",
    });
    assert.deepEqual(isolated.outcome.value, ["undefined", "undefined", "undefined", "undefined", "undefined"]);
    recordCases("script-has-no-host-access");

    const waited = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: `
        const started = await evaluate("void setTimeout(() => { window.ready = 'yes'; }, 200)");
        await waitFor(() => window.ready === "yes");
        let timedOut = false;
        try { await waitFor(() => false, { timeoutMs: 300 }); } catch { timedOut = true; }
        return [started, await evaluate(() => window.ready), timedOut];
      `,
    });
    assert.deepEqual(waited.outcome.value, [null, "yes", true], waited.outcome.error);
    recordCases("script-evaluate-undefined-is-null", "script-waits-for-page-function");

    const leftOff = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: `await navigate(${JSON.stringify(`${origin}/list?page=2`)}); throw new Error("stop");`,
    });
    assert.equal(leftOff.outcome.status, "failed");
    assert.equal(leftOff.outcome.url, `${origin}/list?page=2`, "A failed script did not say where it left the tab.");
    recordCases("script-failure-reports-url");

    const spinning = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      timeoutMs: 1_000,
      script: "for (;;) {}",
    });
    assert.equal(spinning.outcome.status, "timeout");
    assert.equal(spinning.result.success, false);
    recordCases("script-cpu-deadline");

    const capped = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: "for (;;) await evaluate('1');",
    });
    assert.equal(capped.outcome.status, "step_limit");
    assert.equal(capped.outcome.steps, BROWSER_SCRIPT_MAX_STEPS);
    recordCases("script-step-cap");

    const stuck = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: "await new Promise(() => {});",
    });
    assert.equal(stuck.outcome.status, "failed");
    const broken = await runScript({ tabId: list.tab.id, finalSnapshot: false, script: "return (" });
    assert.equal(broken.outcome.status, "failed");
    const large = await runScript({ tabId: list.tab.id, finalSnapshot: false, script: "return 'x'.repeat(70000);" });
    assert.equal(large.outcome.status, "failed");
    const invalidStep = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: `try { await step({ action: "upload_files" }); } catch (error) { return error.message; }`,
    });
    assert.match(String(invalidStep.outcome.value), /Invalid browser step/u);
    recordCases("script-stuck-await", "script-syntax-error", "script-result-limit", "script-validates-steps");
    await close(list.tab.id);
    await close(form.tab.id);
    await close(held.tab.id);

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      cases,
      scope:
        "Owned hidden native process, temporary profile, and loopback pages. BrowserHost.handleDynamicTool for run_script. No provider calls.",
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

function formPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>Form</title>
    <label>Query<input id="query"></label><button type="button">Search</button><div id="out"></div>
    <script>
      window.clicks = 0;
      document.querySelector("button").addEventListener("click", () => {
        window.clicks += 1;
        document.querySelector("#out").textContent = "Result: " + document.querySelector("#query").value;
      });
    </script>`;
}

function listPage(page: number): string {
  const items = [1, 2, 3].map((item) => `<li>item-${page}-${item}</li>`).join("");
  const next = page < 3 ? `<a class="next" href="/list?page=${page + 1}">Next</a>` : "";
  return `<!doctype html><meta charset="utf-8"><title>List ${page}</title><ul>${items}</ul>${next}`;
}
