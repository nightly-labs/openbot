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
const measurements: Record<string, number | boolean> = {};
const snapshotSchema = z.object({ tabId: z.string(), revision: z.number(), url: z.string() });
const scriptSchema = z.object({
  tabId: z.string(),
  status: z.enum(["completed", "failed", "timeout", "step_limit", "user_control", "tab_closed", "page_crashed"]),
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
  else if (url.pathname in PAGES) response.end(PAGES[url.pathname]);
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
    // The site memories that the host reads, by agent and host name, for the site-memories phase.
    const siteMemoryReads: { agentId: string; hostname: string }[] = [];
    let siteMemoriesOn = false;
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"), {
      siteMemories: (agentId, hostname) => {
        if (!siteMemoriesOn) return [];
        siteMemoryReads.push({ agentId, hostname });
        return [{ id: "memory-site", site: hostname, text: "Search with the Search button, not Enter." }];
      },
    });
    const host = browser;
    let turnId = "fixture-turn";
    const params = (tool: string, args: DynamicToolCallParams["arguments"]): DynamicToolCallParams => ({
      namespace: "openbot_browser",
      tool,
      arguments: args,
      ownerAgentId: "fixture-agent",
      threadId: "fixture-thread",
      turnId,
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
      script: "return [typeof process, typeof require, typeof fetch, typeof XMLHttpRequest];",
    });
    assert.deepEqual(isolated.outcome.value, ["undefined", "undefined", "undefined", "undefined"]);
    recordCases("script-has-no-host-access");

    // A timer is a host sleep step, so it waits through a navigation as well.
    const slept = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: `
        const started = Date.now();
        await sleep(300);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const cancelled = setTimeout(() => log("cancelled timer ran"), 0);
        clearTimeout(cancelled);
        await waitFor(100);
        return Date.now() - started;
      `,
    });
    assert.equal(slept.outcome.status, "completed", slept.outcome.error);
    assert(Number(slept.outcome.value) >= 600, `The script slept ${slept.outcome.value} ms.`);
    assert.equal(slept.outcome.log, undefined, "A cleared timer ran.");
    recordCases("script-sleeps-on-host");

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

    // The forms that models write from other libraries wait for the same conditions.
    const guessed = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: `
        await waitFor("text", "item-3-1");
        await waitFor("selector", "ul");
        await waitFor({ selector: "ul" }, { timeout: 2000 });
        await waitFor({ target: "ul", state: "visible" });
        await waitFor({ target: "ul" }, { state: "visible" });
        await waitFor({ state: "networkidle" }, 5000);
        await waitFor("item-3-1", 2000);
        await waitFor(() => true, 2000);
        await waitFor("item-3-1", "page");
        await waitFor("item-3-1", "load");
        await waitFor(".absent-spinner", "hidden");
        await waitFor(() => true, "present");
        let refused = "";
        try { await waitFor("visible", "li"); } catch (error) { refused = error.message; }
        return [
          refused,
          role("button", { name: "Search", exact: true }),
          [css("li").nth(2), css("li", 1), css("li").first(), text("Next", { exact: true, nth: 1 }), role("link", "Next", { nth: 0 })],
        ];
      `,
    });
    assert.equal(guessed.outcome.status, "completed", guessed.outcome.error);
    const [refused, roleTarget, picks] = z.tuple([z.string(), z.unknown(), z.unknown()]).parse(guessed.outcome.value);
    assert.match(refused, /waitFor takes/u);
    assert.deepEqual(roleTarget, { kind: "role", role: "button", name: "Search", exact: true });
    assert.deepEqual(picks, [
      { kind: "css", selector: "li", nth: 2 },
      { kind: "css", selector: "li", nth: 1 },
      { kind: "css", selector: "li", nth: 0 },
      { kind: "text", text: "Next", exact: true, nth: 1 },
      { kind: "role", role: "link", name: "Next", nth: 0 },
    ]);
    recordCases("script-accepts-guessed-wait-forms", "script-targets-take-nth");

    // "present" after a selector waits for the element, not for the selector as page text.
    const presence = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: `
        await evaluate("void setTimeout(() => document.body.append(Object.assign(document.createElement('div'), { id: 'late-results', textContent: 'Loaded' })), 200)");
        await waitFor("#late-results", "present", { timeoutMs: 3000 });
        await waitFor("item-3-1", "appears", { timeoutMs: 3000 });
        return await evaluate(() => Boolean(document.querySelector("#late-results")));
      `,
    });
    assert.equal(presence.outcome.value, true, presence.outcome.error);
    recordCases("script-waits-for-present-selector");

    // The sandbox has no page globals: the error says where they are.
    const pageGlobal = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: "return document.title;",
    });
    assert.equal(pageGlobal.outcome.status, "failed");
    assert.match(pageGlobal.outcome.error ?? "", /runs in a sandbox, not in the page/u);
    const snakeHelper = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: "await wait_for({ text: 'Next' });",
    });
    assert.equal(snakeHelper.outcome.status, "failed");
    assert.match(snakeHelper.outcome.error ?? "", /helpers use camelCase: waitFor/u);
    recordCases("script-names-the-sandbox-for-page-globals", "script-names-camel-case-helpers");

    // Scripts resolve the links that they read, as in a browser, and can navigate to a URL object.
    // location is the tab address after each step, and it is read-only.
    const resolved = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      script: [
        "const next = new URL('../b?x=1&x=2#h', 'https://example.com/a/c');",
        "next.searchParams.set('page', '2');",
        "const moved = new URL('/list?page=1', location.href);",
        "moved.search = '?page=2';",
        "await navigate(moved);",
        "let assigned = 'assigned';",
        "try { location.href = '/elsewhere'; } catch (error) { assigned = error.message; }",
        "return [next.href, next.pathname, next.searchParams.getAll('x'), next.origin, URL.canParse('no scheme'),",
        "  String(new URLSearchParams({ q: 'a b&c' })), location.href, location.search, String(location), assigned,",
        "  await evaluate(() => location.href)];",
      ].join("\n"),
    });
    assert.equal(resolved.outcome.status, "completed", resolved.outcome.error);
    assert.deepEqual(resolved.outcome.value, [
      "https://example.com/b?x=1&x=2&page=2#h",
      "/b",
      ["1", "2"],
      "https://example.com",
      false,
      "q=a+b%26c",
      `${origin}/list?page=2`,
      "?page=2",
      `${origin}/list?page=2`,
      "location is read-only in the script: call await navigate(url).",
      `${origin}/list?page=2`,
    ]);
    recordCases("script-resolves-urls", "script-reads-tab-location");

    // A wait needs one match: each of these targets matches several elements of the list page.
    const waitedForMany = await runScript({
      tabId: list.tab.id,
      finalSnapshot: false,
      timeoutMs: 10_000,
      script: "await waitFor(css('li')); await waitFor(text('Next', { exact: true })); return 'present';",
    });
    assert.equal(waitedForMany.outcome.status, "completed", waitedForMany.outcome.error);
    recordCases("wait-for-target-with-several-matches");

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

    phase("open-snapshot");
    const opened = parseBrowserToolText(text(await call("open", { url: `${origin}/form` })));
    const openedPage = snapshotSchema.extend({ elements: z.array(z.object({ name: z.string() })) }).parse(opened);
    assert(
      openedPage.elements.some((element) => element.name === "Search"),
      "open returned no snapshot of the page.",
    );
    recordCases("open-returns-snapshot");
    await close(openedPage.tabId);

    phase("page-settle");
    const pageSchema = z.object({
      url: z.string(),
      elements: z.array(z.object({ name: z.string() })),
      diagnostics: z.array(z.object({ message: z.string() })).optional(),
      challenge: z.object({ vendor: z.string(), status: z.string(), waitedMs: z.number() }).optional(),
    });
    const readPage = async (tool: string, args: DynamicToolCallParams["arguments"]) => {
      const started = Date.now();
      const result = await call(tool, args);
      const parsed = parseBrowserToolText(text(result));
      const page = pageSchema.parse(
        tool === "run_script" ? z.object({ snapshot: z.unknown() }).parse(parsed).snapshot : parsed,
      );
      return { page, ms: Date.now() - started, raw: parsed };
    };
    const names = (page: z.infer<typeof pageSchema>) => page.elements.map((element) => element.name);
    const settleTab = await runCauseEffect(host.open(`${origin}/form`, "fixture-thread", "fixture-agent"));
    const skeleton = await readPage("navigate", { tabId: settleTab.id, url: `${origin}/skeleton` });
    assert(names(skeleton.page).includes("Loaded"), `The snapshot showed the skeleton: ${names(skeleton.page)}`);
    measurements.skeletonNavigateMs = skeleton.ms;
    recordCases("snapshot-waits-for-skeleton");
    await readPage("navigate", { tabId: settleTab.id, url: `${origin}/stuck-skeleton` });
    const stuckAgain = await readPage("snapshot", { tabId: settleTab.id, image: "never" });
    assert(stuckAgain.ms < 1_500, `A page that keeps its skeleton waited again: ${stuckAgain.ms} ms.`);
    measurements.stuckSkeletonSecondSnapshotMs = stuckAgain.ms;
    recordCases("snapshot-waits-once-per-document");

    phase("challenge");
    const interstitial = await readPage("navigate", { tabId: settleTab.id, url: `${origin}/challenge` });
    assert.equal(interstitial.page.url, `${origin}/form`, "The snapshot did not wait for the interstitial.");
    assert.equal(interstitial.page.challenge?.status, "cleared");
    measurements.interstitialNavigateMs = interstitial.ms;
    recordCases("snapshot-waits-for-interstitial");
    const captcha = await readPage("navigate", { tabId: settleTab.id, url: `${origin}/captcha` });
    assert.equal(captcha.page.challenge?.status, "needs-user");
    assert(captcha.ms < 5_000, `An interactive check waited: ${captcha.ms} ms.`);
    const ordinary = await readPage("navigate", { tabId: settleTab.id, url: `${origin}/article` });
    assert.equal(ordinary.page.challenge, undefined, "A long page that mentions a captcha read as a check.");
    recordCases("snapshot-reports-interactive-check", "snapshot-ignores-long-page");
    const stuckCheck = await readPage("navigate", { tabId: settleTab.id, url: `${origin}/stuck-challenge` });
    // navigate stops its wait at its own timeout; the next read waits only the rest of the 15 s.
    assert.equal(stuckCheck.page.challenge?.status, "checking", "A check with wait time left asked for a person.");
    const stuckCheckRest = await readPage("snapshot", { tabId: settleTab.id, image: "never" });
    assert.equal(stuckCheckRest.page.challenge?.status, "needs-user", "A check that stayed did not ask for a person.");
    assert(
      stuckCheck.ms + stuckCheckRest.ms < 20_000,
      `The reads of one check waited more than once: ${stuckCheck.ms} + ${stuckCheckRest.ms} ms.`,
    );
    const stuckCheckAgain = await readPage("snapshot", { tabId: settleTab.id, image: "never" });
    assert.equal(stuckCheckAgain.page.challenge?.status, "needs-user");
    assert(stuckCheckAgain.ms < 3_000, `A check that stayed waited again: ${stuckCheckAgain.ms} ms.`);
    measurements.stuckChallengeSecondSnapshotMs = stuckCheckAgain.ms;
    recordCases("snapshot-waits-for-check-once-per-document");
    const offerSchema = z.object({
      challenge: z.object({ target: z.object({ kind: z.literal("point"), x: z.number(), y: z.number() }) }),
    });
    const offer = await readPage("navigate", { tabId: settleTab.id, url: `${origin}/checkbox-captcha` });
    assert.equal(offer.page.challenge?.status, "click-once", "A checkbox check did not offer its click.");
    await call("click", { tabId: settleTab.id, target: offerSchema.parse(offer.raw).challenge.target });
    const passed = await readPage("snapshot", { tabId: settleTab.id, image: "never" });
    // The check passed before or while the read waited.
    assert(
      passed.page.challenge === undefined || passed.page.challenge.status === "cleared",
      `The clicked checkbox did not pass the check: ${passed.page.challenge?.status}`,
    );
    measurements.checkboxPassedSnapshotMs = passed.ms;
    recordCases("challenge-offers-one-click", "challenge-click-passes");
    const shadowOffer = await readPage("navigate", { tabId: settleTab.id, url: `${origin}/shadow-checkbox-captcha` });
    assert.equal(
      shadowOffer.page.challenge?.status,
      "click-once",
      "A Turnstile frame in a closed shadow root did not offer its click.",
    );
    await call("click", { tabId: settleTab.id, target: offerSchema.parse(shadowOffer.raw).challenge.target });
    const shadowPassed = await readPage("snapshot", { tabId: settleTab.id, image: "never" });
    assert(
      shadowPassed.page.challenge === undefined || shadowPassed.page.challenge.status === "cleared",
      `The clicked checkbox in a closed shadow root did not pass the check: ${shadowPassed.page.challenge?.status}`,
    );
    recordCases("challenge-click-in-closed-shadow-root");
    const selfPass = await readPage("navigate", { tabId: settleTab.id, url: `${origin}/self-passing-turnstile` });
    assert(
      selfPass.page.challenge === undefined || selfPass.page.challenge.status === "cleared",
      `A Turnstile that passes by itself offered its click: ${selfPass.page.challenge?.status}`,
    );
    measurements.selfPassingTurnstileMs = selfPass.ms;
    recordCases("turnstile-passes-without-click");
    const stuckOffer = await readPage("navigate", { tabId: settleTab.id, url: `${origin}/stuck-checkbox-captcha` });
    assert.equal(stuckOffer.page.challenge?.status, "click-once");
    await call("click", { tabId: settleTab.id, target: offerSchema.parse(stuckOffer.raw).challenge.target });
    const stuckClick = await readPage("snapshot", { tabId: settleTab.id, image: "never" });
    assert.equal(
      stuckClick.page.challenge?.status,
      "needs-user",
      "A check that stayed after its click did not ask for a person.",
    );
    assert(stuckClick.ms < 10_000, `The read after the click waited too long: ${stuckClick.ms} ms.`);
    const stuckClickAgain = await readPage("snapshot", { tabId: settleTab.id, image: "never" });
    assert.equal(stuckClickAgain.page.challenge?.status, "needs-user", "A document offered its click twice.");
    assert(stuckClickAgain.ms < 3_000, `A check that stayed after its click waited again: ${stuckClickAgain.ms} ms.`);
    measurements.stuckCheckboxSecondSnapshotMs = stuckClickAgain.ms;
    recordCases("challenge-click-once-per-document");

    phase("modal");
    const modal = await readPage("navigate", { tabId: settleTab.id, url: `${origin}/modal` });
    // A fact for the modal-first decision, not a requirement.
    measurements.modalOutsideButtonInSnapshot = names(modal.page).includes("Outside");
    assert(names(modal.page).includes("Inside"), "The modal button is missing.");
    recordCases("snapshot-reads-modal");

    phase("site-memories");
    const siteSchema = z.object({
      siteMemories: z.array(z.object({ id: z.string(), site: z.string(), text: z.string() })).optional(),
    });
    const siteMemoriesOf = async (tool: string, args: DynamicToolCallParams["arguments"]) =>
      siteSchema.parse((await readPage(tool, args)).raw).siteMemories;
    siteMemoriesOn = true;
    turnId = "site-turn-1";
    const recalled = await siteMemoriesOf("navigate", { tabId: settleTab.id, url: `${origin}/form` });
    assert.deepEqual(
      recalled,
      [{ id: "memory-site", site: "127.0.0.1", text: "Search with the Search button, not Enter." }],
      "The snapshot did not show the memories of its site.",
    );
    assert.deepEqual(siteMemoryReads, [{ agentId: "fixture-agent", hostname: "127.0.0.1" }]);
    recordCases("snapshot-shows-site-memories");
    const again = await siteMemoriesOf("navigate", { tabId: settleTab.id, url: `${origin}/article` });
    assert.equal(again, undefined, "A second page of the same site showed its memories again in one turn.");
    recordCases("site-memories-once-per-turn");
    turnId = "site-turn-2";
    const nextTurn = await siteMemoriesOf("snapshot", { tabId: settleTab.id, image: "never" });
    assert.equal(nextTurn?.length, 1, "A new turn did not show the site memories.");
    recordCases("site-memories-again-next-turn");
    siteMemoriesOn = false;
    turnId = "fixture-turn";
    await close(settleTab.id);

    phase("page-crash");
    const crashing = await open("/form");
    const gone = new Promise<void>((resolve) => crashing.contents.once("render-process-gone", () => resolve()));
    crashing.contents.forcefullyCrashRenderer();
    await gone;
    const recovered = await readPage("snapshot", { tabId: crashing.tab.id, image: "never" });
    assert.equal(recovered.page.url, `${origin}/form`);
    assert(names(recovered.page).includes("Search"), "The crashed page did not load again.");
    assert(
      recovered.page.diagnostics?.some((item) => item.message.includes("The page crashed")),
      "The snapshot did not report the crash.",
    );
    recordCases("crashed-tab-reloads-on-next-call");

    await crashing.contents.executeJavaScript("delete window.fixtureFinish");
    const crashStarted = Date.now();
    const crashScript = runScript({
      tabId: crashing.tab.id,
      script: `
        await evaluate("new Promise((resolve) => { window.fixtureFinish = resolve; })");
        await click(role("button", "Search"));
      `,
    });
    await crashing.contents.executeJavaScript(
      "new Promise((resolve) => { const ready = () => (window.fixtureFinish ? resolve() : requestAnimationFrame(ready)); ready(); })",
    );
    crashing.contents.forcefullyCrashRenderer();
    const crashOutcome = await crashScript;
    assert.equal(crashOutcome.outcome.status, "page_crashed", crashOutcome.outcome.error);
    assert(crashOutcome.outcome.snapshot, "A crashed script returned no fresh snapshot.");
    assert.equal(await crashing.contents.executeJavaScript("window.clicks"), 0, "A step acted after the crash.");
    measurements.crashedScriptMs = Date.now() - crashStarted;
    assert(measurements.crashedScriptMs < 15_000, "A crashed script waited for its deadline.");
    recordCases("crashed-script-stops");
    await close(crashing.tab.id);

    // A new host with a short sweep: of the idle tabs, only the 3 most recently used stay loaded.
    phase("tab-sleep");
    await runCauseEffect(host.destroy());
    const sleepy = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "sleep-tabs.json"), {
      tabSleep: { sweepMs: 50, awakeGraceMs: 0 },
    });
    browser = sleepy;
    const unloaded = (contents: Electron.WebContents) =>
      contents.isDestroyed()
        ? Promise.resolve()
        : new Promise<void>((resolve) => contents.once("destroyed", () => resolve()));
    const loaded: Electron.WebContents[] = [];
    let firstTabId: string | undefined;
    for (const index of [1, 2, 3, 4, 5]) {
      const url = `${origin}/form?tab=${index}`;
      const tab = await runCauseEffect(sleepy.open(url, "fixture-thread", "fixture-agent"));
      firstTabId ??= tab.id;
      const contents = webContents.getAllWebContents().find((item) => !item.isDestroyed() && item.getURL() === url);
      assert(contents, `Missing contents of sleep tab ${index}.`);
      loaded.push(contents);
    }
    const [first, second, ...newest] = loaded;
    assert(first && second, "Missing sleep tabs.");
    // The fifth tab is the active one, so it is in use; the first of the four idle tabs is past the cap.
    await unloaded(first);
    assert(!second.isDestroyed() && newest.every((item) => !item.isDestroyed()), "A tab within the cap slept.");
    recordCases("idle-tabs-past-cap-sleep");

    assert(firstTabId, "Missing the first sleep tab.");
    const woken = snapshotSchema.parse(
      parseBrowserToolText(
        text(await runCauseEffect(sleepy.handleDynamicTool(params("snapshot", { tabId: firstTabId, image: "never" })))),
      ),
    );
    assert.equal(woken.url, `${origin}/form?tab=1`, "A slept tab did not load its page again.");
    // The woken tab is now the most recently used one, so the second tab is past the cap.
    await unloaded(second);
    assert(
      newest.every((item) => !item.isDestroyed()),
      "A tab within the cap slept after another tab woke.",
    );
    recordCases("slept-tab-wakes-on-next-call");

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      cases,
      measurements,
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

const PAGES: Record<string, string> = {
  "/skeleton": `<!doctype html><meta charset="utf-8"><title>Skeleton</title>
    <main><div class="skeleton" aria-busy="true" style="width:240px;height:40px;background:#ddd"></div></main>
    <script>
      setTimeout(() => {
        document.querySelector("main").innerHTML = "<button type='button'>Loaded</button>";
      }, 1200);
    </script>`,
  "/stuck-skeleton": `<!doctype html><meta charset="utf-8"><title>Stuck</title>
    <div class="skeleton" style="width:240px;height:40px;background:#ddd"></div><button type="button">Stay</button>`,
  "/challenge": `<!doctype html><meta charset="utf-8"><title>Just a moment...</title>
    <div id="challenge-running">Checking your browser before accessing the site.</div>
    <script>setTimeout(() => location.replace("/form"), 3000);</script>`,
  "/stuck-challenge": `<!doctype html><meta charset="utf-8"><title>Just a moment...</title>
    <div id="challenge-running">Checking your browser before accessing the site.</div>`,
  "/captcha": `<!doctype html><meta charset="utf-8"><title>Security check</title>
    <p>Please complete the security check to continue.</p>
    <iframe src="/hcaptcha.com/checkbox" style="width:300px;height:80px"></iframe>`,
  "/hcaptcha.com/checkbox": `<!doctype html><meta charset="utf-8"><label><input type="checkbox">I am human</label>`,
  "/checkbox-captcha": checkboxCaptchaPage(true),
  "/stuck-checkbox-captcha": checkboxCaptchaPage(false),
  "/shadow-checkbox-captcha": checkboxCaptchaPage(true, true),
  "/self-passing-turnstile": checkboxCaptchaPage(false, false, true),
  // A click anywhere in the widget tells the page; the fixture page decides whether the check passes.
  "/challenges.cloudflare.com/turnstile": `<!doctype html><meta charset="utf-8">
    <body style="margin:0"><label style="display:block;height:65px;padding-left:16px">
    <input type="checkbox" style="margin-top:20px">Verify you are human</label>
    <script>document.addEventListener("click", () => parent.postMessage("turnstile-click", "*"));</script></body>`,
  "/article": `<!doctype html><meta charset="utf-8"><title>Article</title><h1>Article</h1>
    <p>${"This article explains how a captcha asks you to verify you are human. ".repeat(40)}</p>`,
  "/modal": `<!doctype html><meta charset="utf-8"><title>Modal</title>
    <button type="button">Outside</button>
    <dialog><p>Confirm</p><button type="button">Inside</button></dialog>
    <script>document.querySelector("dialog").showModal();</script>`,
};

// Turnstile puts its frame in a closed shadow root, so only CDP finds it. A widget that passes by
// itself gets its token without a click.
function checkboxCaptchaPage(passes: boolean, shadow = false, selfPass = false): string {
  const frame = `<iframe src="/challenges.cloudflare.com/turnstile" style="width:300px;height:65px;border:0"></iframe>`;
  return `<!doctype html><meta charset="utf-8"><title>Security check</title>
    <p>Verify you are human to continue.</p>
    <form><div><div id="widget">${shadow ? "" : frame}</div>
    <input type="hidden" name="cf-turnstile-response" value=""></div></form>
    <script>
      if (${shadow}) document.querySelector("#widget").attachShadow({ mode: "closed" }).innerHTML = ${JSON.stringify(frame)};
      if (${selfPass})
        setTimeout(() => (document.querySelector("[name=cf-turnstile-response]").value = "fixture-token"), 1500);
      addEventListener("message", (event) => {
        if (${passes} && event.data === "turnstile-click")
          document.querySelector("[name=cf-turnstile-response]").value = "fixture-token";
      });
    </script>`;
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
