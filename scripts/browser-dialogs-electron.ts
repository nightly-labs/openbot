import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import {
  BROWSER_VIEW_DIALOG_QUERY,
  type BrowserViewDialog,
  decodeBrowserViewHostMessage,
  encodeBrowserViewInput,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import {
  app,
  type BaseWindow,
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type WebContents,
  webContents,
} from "electron";
import { z } from "zod";
import { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams, DynamicToolResult } from "../src/backend/protocol";
import { BrowserViewGateway } from "../src/main/browser-view-gateway";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

const cases: string[] = [];
const THREAD_ID = "fixture-thread";
const TURN_ID = "fixture-turn";
const STATE_WAIT_MS = 10_000;
const VIEW_TOKEN = "fixture-view-token";
const VIEW_MEMBER = "fixture-member";

const PAGE = `<!doctype html><meta charset="utf-8"><title>start</title>
<button id="confirm" onclick="document.title = 'confirm:' + confirm('Delete the test item?')">Confirm</button>
<button id="alert" onclick="alert('Saved'); document.title = 'alert:done'">Alert</button>
<button id="chain" onclick="if (confirm('First?')) alert('Second'); document.title = 'chain:done'">Chain</button>
<button id="secret" onclick="document.title = 'secret:' + confirm('Use password=hunter2 here?')">Secret</button>
<button id="later" onclick="setTimeout(() => { document.title = 'later:' + confirm('Later?') })">Later</button>
<button id="prompt" onclick="document.title = 'prompt:' + prompt('Name?')">Prompt</button>
<form action="/done" onsubmit="return confirm('Send the form?')"><button id="submit">Send</button></form>`;

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (request.url === "/done") response.end('<!doctype html><meta charset="utf-8"><title>done</title>');
  else if (request.url === "/greet" || request.url === "/welcome")
    response.end("<!doctype html><title>start</title><script>alert('Welcome'); document.title = 'greeted'</script>");
  else if (request.url === "/stall") return;
  else if (request.url === "/busy")
    response.end(
      "<!doctype html><title>busy</title><script>setTimeout(() => { while (true) {} }, 50)</script><img src='/stall'>",
    );
  else if (request.url === "/ask-twice")
    response.end(
      "<!doctype html><title>start</title><script>document.title = 'first:' + confirm('First?'); alert('Second'); document.title += ':done'</script>",
    );
  else if (request.url === "/ask")
    response.end(
      "<!doctype html><title>start</title><script>document.title = 'asked:' + confirm('Continue?')</script>",
    );
  else response.end(PAGE);
});

interface NativeBox {
  message: string;
  aborted: boolean;
  answer: (response: number) => void;
}
const boxes: NativeBox[] = [];
const boxListeners = new Set<() => void>();
dialog.showMessageBox = (...args: Array<BaseWindow | MessageBoxOptions>): Promise<MessageBoxReturnValue> => {
  const options = args.find((item): item is MessageBoxOptions => "message" in item);
  return new Promise((resolve) => {
    const box: NativeBox = {
      message: options?.message ?? "",
      aborted: false,
      answer: (response) => resolve({ response, checkboxChecked: false }),
    };
    options?.signal?.addEventListener(
      "abort",
      () => {
        box.aborted = true;
        resolve({ response: options.cancelId ?? 0, checkboxChecked: false });
      },
      { once: true },
    );
    boxes.push(box);
    for (const listener of boxListeners) listener();
  });
};

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

    const call = (
      tool: string,
      args: DynamicToolCallParams["arguments"],
      turnId = TURN_ID,
    ): Promise<DynamicToolResult> =>
      Effect.runPromise(
        host.handleDynamicTool({
          namespace: "openbot_browser",
          tool,
          arguments: args,
          ownerAgentId: "fixture-agent",
          threadId: THREAD_ID,
          turnId,
          callId: `dialogs-${++sequence}`,
        } satisfies DynamicToolCallParams),
      );
    const text = (result: DynamicToolResult): string => {
      const item = result.contentItems.find((content) => content.type === "inputText");
      assert(item?.type === "inputText", "Missing tool result text.");
      return item.text;
    };
    const dialogResult = z.object({
      tabId: z.string(),
      dialog: z.object({ id: z.string().optional(), type: z.enum(["alert", "confirm"]), message: z.string() }),
      note: z.string(),
    });
    const parsedDialog = (result: DynamicToolResult) => {
      assert.equal(result.success, true, text(result));
      return dialogResult.parse(JSON.parse(text(result)));
    };
    const agentDialog = (result: DynamicToolResult) => {
      const parsed = parsedDialog(result);
      assert(parsed.dialog.id, "The agent got no dialog id. Check Electron's -cancel-dialogs listener.");
      return { ...parsed.dialog, id: parsed.dialog.id };
    };
    const failure = (result: DynamicToolResult, pattern: RegExp) => {
      assert.equal(result.success, false, "The tool call did not fail.");
      assert.match(text(result), pattern);
    };
    const click = (tabId: string, selector: string, turnId = TURN_ID) =>
      call("click", { tabId, target: { kind: "css", selector } }, turnId);
    const answer = (tabId: string, dialogId: string, accept: boolean, turnId = TURN_ID) =>
      call("handle_dialog", { tabId, dialogId, accept }, turnId);
    const open = async (): Promise<{ tabId: string; contents: WebContents }> => {
      const tab = await runCauseEffect(host.open(`${origin}/page-${++sequence}`, THREAD_ID, "fixture-agent"));
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      assert(contents, "Missing fixture contents.");
      return { tabId: tab.id, contents };
    };
    const title = async (contents: WebContents) => String(await contents.executeJavaScript("document.title"));

    phase("cases");

    {
      const { tabId, contents } = await open();
      const box = nextBox();
      const opened = agentDialog(await click(tabId, "#confirm"));
      assert.equal(opened.type, "confirm");
      assert.equal(opened.message, "Delete the test item?");
      recordCases("action-returns-dialog");
      assert.equal((await box).message, "Delete the test item?");
      assert.equal((await box).aborted, false);
      recordCases("native-box-shown-for-person");
      const refused = await call("snapshot", { tabId, image: "never" });
      failure(refused, /Answer it first with handle_dialog/);
      assert.match(text(refused), new RegExp(opened.id));
      recordCases("other-tool-refused-while-open");
      failure(await answer(tabId, opened.id, true, "other-turn"), /Only a person can answer/);
      recordCases("other-turn-cannot-answer");
      failure(await answer(tabId, "not-a-dialog", true), /This dialog is closed/);
      recordCases("unknown-dialog-id-refused");
      const answered = await answer(tabId, opened.id, true);
      assert.equal(answered.success, true, text(answered));
      assert.equal(JSON.parse(text(answered)).answered, "accepted");
      assert.equal(await title(contents), "confirm:true");
      recordCases("accept-presses-ok");
      assert.equal((await box).aborted, true, "Electron's box stayed open after the answer.");
      recordCases("native-box-closed-after-answer");

      const dismissed = agentDialog(await click(tabId, "#confirm"));
      assert.equal(JSON.parse(text(await answer(tabId, dismissed.id, false))).answered, "dismissed");
      assert.equal(await title(contents), "confirm:false");
      recordCases("dismiss-presses-cancel");

      const alert = agentDialog(await click(tabId, "#alert"));
      assert.equal(alert.type, "alert");
      assert.equal((await answer(tabId, alert.id, true)).success, true);
      assert.equal(await title(contents), "alert:done");
      recordCases("alert-answered");

      const first = agentDialog(await click(tabId, "#chain"));
      const second = agentDialog(await answer(tabId, first.id, true));
      assert.equal(second.type, "alert");
      assert.equal(second.message, "Second");
      assert.notEqual(second.id, first.id);
      assert.equal((await answer(tabId, second.id, true)).success, true);
      assert.equal(await title(contents), "chain:done");
      recordCases("chained-dialog-returned");

      const later = agentDialog(await click(tabId, "#later"));
      assert.equal(later.message, "Later?");
      assert.equal((await answer(tabId, later.id, true)).success, true);
      assert.equal(await title(contents), "later:true");
      recordCases("dialog-after-input-returned");

      const secret = agentDialog(await click(tabId, "#secret"));
      assert(!secret.message.includes("hunter2"), "The dialog text kept a secret.");
      assert.match(secret.message, /\[redacted\]/);
      assert.equal((await answer(tabId, secret.id, false)).success, true);
      recordCases("dialog-text-redacted");

      const prompt = await click(tabId, "#prompt");
      assert.equal(prompt.success, true, text(prompt));
      assert.equal(JSON.parse(text(prompt)).dialog, undefined, "The agent got a prompt dialog.");
      assert.match(text(prompt), /prompt\(\) is not supported/);
      recordCases("prompt-not-claimed");

      const submit = agentDialog(await click(tabId, "#submit"));
      const submitted = await answer(tabId, submit.id, true);
      assert.equal(submitted.success, true, text(submitted));
      assert.match(JSON.parse(text(submitted)).url, /\/done\??$/);
      recordCases("form-navigation-kept-after-accept");

      const greeting = agentDialog(await call("navigate", { tabId, url: `${origin}/greet` }));
      assert.equal(greeting.message, "Welcome");
      const greeted = await answer(tabId, greeting.id, true);
      assert.equal(greeted.success, true, text(greeted));
      assert.equal(await title(contents), "greeted");
      recordCases("dialog-during-navigation-returned");
    }

    {
      const loadContents = (path: string) => {
        const contents = webContents.getAllWebContents().find((item) => item.getURL() === `${origin}${path}`);
        assert(contents, `Missing ${path} contents.`);
        return contents;
      };
      const asked = parsedDialog(await call("open", { url: `${origin}/ask` }));
      assert.equal(asked.dialog.type, "confirm");
      assert.equal(asked.dialog.message, "Continue?");
      assert(asked.dialog.id, "The agent got no id for the dialog of its open.");
      recordCases("open-returns-load-dialog");
      const dismissed = await answer(asked.tabId, asked.dialog.id, false);
      assert.equal(dismissed.success, true, text(dismissed));
      await waitUntil(async () => (await title(loadContents("/ask"))) === "asked:false");
      recordCases("open-load-dialog-answered");

      const welcome = parsedDialog(await call("open", { url: `${origin}/welcome` }));
      assert.equal(welcome.dialog.type, "alert");
      assert(welcome.dialog.id, "The agent got no id for the alert of its open.");
      assert.equal((await answer(welcome.tabId, welcome.dialog.id, true)).success, true);
      await waitUntil(async () => (await title(loadContents("/welcome"))) === "greeted");
      recordCases("open-load-alert-returned");

      const first = parsedDialog(await call("open", { url: `${origin}/ask-twice` }));
      assert.equal(first.dialog.message, "First?");
      assert(first.dialog.id, "The agent got no id for the first dialog of its open.");
      const second = parsedDialog(await answer(first.tabId, first.dialog.id, true));
      assert.equal(second.dialog.message, "Second");
      assert(second.dialog.id, "The agent got no id for the second dialog of the same load.");
      assert.equal((await answer(second.tabId, second.dialog.id, true)).success, true);
      await waitUntil(async () => (await title(loadContents("/ask-twice"))) === "first:true:done");
      recordCases("open-load-dialogs-chained");

      const stalled = call("open", { url: `${origin}/stall` });
      let stalledTabId: string | undefined;
      await waitUntil(async () => {
        const tabs = z
          .object({ tabs: z.array(z.object({ id: z.string(), url: z.string() })) })
          .parse(JSON.parse(text(await call("list_tabs", {}))));
        stalledTabId = tabs.tabs.find((tab) => tab.url.endsWith("/stall"))?.id;
        return stalledTabId !== undefined;
      });
      assert(stalledTabId, "Missing the tab of the stalled open.");
      assert.equal((await call("close_tab", { tabId: stalledTabId })).success, true);
      const closedOpen = await stalled;
      assert.equal(closedOpen.success, false, text(closedOpen));
      assert.match(text(closedOpen), /Unable to open/);
      recordCases("open-fails-when-tab-closes-during-load");
    }

    {
      const { tabId, contents } = await open();
      const script = await call("run_script", { tabId, script: "await click('#confirm'); return 'after';" });
      assert.equal(script.success, false);
      const run = z
        .object({ status: z.literal("dialog"), dialog: z.object({ id: z.string() }) })
        .parse(JSON.parse(text(script)));
      assert.equal((await answer(tabId, run.dialog.id, true)).success, true);
      assert.equal(await title(contents), "confirm:true");
      recordCases("run-script-stops-at-dialog");
    }

    {
      const { tabId, contents } = await open();
      const box = nextBox();
      const opened = agentDialog(await click(tabId, "#confirm"));
      host.endControl(THREAD_ID, TURN_ID);
      assert.equal((await box).aborted, false, "The turn end closed Electron's box.");
      failure(await answer(tabId, opened.id, true, "turn-2"), /Only a person can answer/);
      const personRefusal = await call("snapshot", { tabId, image: "never" }, "turn-2");
      failure(personRefusal, /only a person can answer it/);
      assert.match(text(personRefusal), /A confirm dialog .*"Delete the test item\?"/);
      assert(!text(personRefusal).includes(opened.id), "The agent got the id of a person's dialog.");
      recordCases("turn-end-hands-off");
      (await box).answer(0);
      await waitUntil(async () => (await title(contents)) === "confirm:true");
      recordCases("person-answers-after-handoff");
      await waitUntil(async () => (await call("snapshot", { tabId, image: "never" }, "turn-2")).success);
      recordCases("tools-work-after-person-answer");
    }

    {
      const { contents } = await open();
      const box = nextBox();
      const clicked = contents.executeJavaScript("document.getElementById('confirm').click()", true);
      assert.equal((await box).aborted, false);
      (await box).answer(1);
      await clicked;
      assert.equal(await title(contents), "confirm:false");
      recordCases("person-dialog-stays-native");
    }

    {
      const { tabId, contents } = await open();
      const box = nextBox();
      await contents.executeJavaScript(
        "setTimeout(() => { alert('Session expired password=hunter2'); document.title = 'noticed' })",
      );
      await waitUntil(async () => (await title(contents)) === "noticed");
      assert.equal((await box).aborted, true, "Electron's box stayed open after the page alert.");
      recordCases("page-alert-accepted-in-agent-tab");
      const snapshot = await call("snapshot", { tabId, image: "never" });
      assert.equal(snapshot.success, true, text(snapshot));
      assert.match(text(snapshot), /Session expired/);
      assert(!text(snapshot).includes("hunter2"), "The alert text kept a secret.");
      recordCases("page-alert-reported-to-agent");
    }

    {
      const { tabId, contents } = await open();
      await runCauseEffect(host.activate(tabId));
      await runCauseEffect(host.setVisible({ visible: true, bounds: { x: 0, y: 0, width: 800, height: 600 } }));
      contents.focus();
      const shownBefore = boxes.length;
      const box = nextBox();
      let personKeySeen = false;
      const notePersonKey = (_event: Electron.Event, input: Electron.Input) => {
        if (input.type === "keyDown") personKeySeen = true;
      };
      contents.on("before-input-event", notePersonKey);
      phase("person-input-alert-key");
      contents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
      contents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
      await waitUntil(async () => personKeySeen);
      contents.off("before-input-event", notePersonKey);
      phase("person-input-alert-open");
      await contents.executeJavaScript("setTimeout(() => document.getElementById('alert').click())");
      await waitUntil(async () => boxes.length > shownBefore);
      phase("cases");
      assert.equal((await box).aborted, false, "A person's alert in an agent tab got OK with no person.");
      (await box).answer(0);
      await waitUntil(async () => (await title(contents)) === "alert:done");
      await runCauseEffect(host.setVisible({ visible: false }));
      recordCases("person-input-alert-in-agent-tab-stays-native");
    }

    {
      const tab = await runCauseEffect(host.open(`${origin}/person-${++sequence}`));
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
      assert(contents, "Missing person tab contents.");
      const box = nextBox();
      const shown = contents.executeJavaScript("alert('Hello'); document.title = 'person:alert'", true);
      assert.equal((await box).aborted, false);
      (await box).answer(0);
      await shown;
      assert.equal(await title(contents), "person:alert");
      recordCases("person-tab-alert-stays-native");
      await runCauseEffect(host.close(tab.id));
    }

    {
      const { tabId, contents } = await open();
      contents.debugger.attach("1.3");
      await contents.debugger.sendCommand("Page.enable");
      const box = nextBox();
      const opened = parsedDialog(await click(tabId, "#confirm", "turn-3"));
      assert.equal(opened.dialog.id, undefined, "The agent got a dialog of another debugger.");
      assert.match(opened.note, /only a person can answer/);
      assert.equal((await box).aborted, false);
      (await box).answer(0);
      await waitUntil(async () => (await title(contents)) === "confirm:true");
      contents.debugger.detach();
      recordCases("external-debugger-leaves-dialog-to-person");
    }

    {
      const { tabId } = await open();
      const box = nextBox();
      agentDialog(await click(tabId, "#confirm", "turn-4"));
      const closed = await call("close_tab", { tabId }, "turn-4");
      assert.equal(closed.success, true, text(closed));
      assert(!host.listTabs().some((tab) => tab.id === tabId));
      const shown = await box;
      await waitUntil(async () => shown.aborted);
      recordCases("close-tab-with-open-dialog");
    }

    {
      const { tabId, contents } = await open();
      const box = nextBox();
      void contents.executeJavaScript("document.getElementById('confirm').click()", true).catch(() => undefined);
      const shown = await box;
      await runCauseEffect(host.close(tabId));
      await waitUntil(async () => shown.aborted);
      recordCases("person-dialog-closed-with-tab");
    }

    {
      const { tabId, contents } = await open();
      const gateway = new BrowserViewGateway({
        browser: host,
        authenticate: (token) => (token === VIEW_TOKEN ? { id: VIEW_MEMBER } : null),
      });
      const viewServer = createServer();
      viewServer.on("upgrade", (request, socket, head) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (gateway.handlesUpgrade(url)) gateway.handleUpgrade(request, socket, head, url);
        else socket.destroy();
      });
      await new Promise<void>((resolve) => viewServer.listen(0, "127.0.0.1", resolve));
      const viewAddress = viewServer.address();
      assert(viewAddress && typeof viewAddress === "object", "View server address missing.");
      try {
        const box = nextBox();
        const opened = agentDialog(await click(tabId, "#confirm", "turn-view"));
        await box;
        const session = gateway.createSession({ memberId: VIEW_MEMBER, teamSessionId: "fixture-session", tabId });
        const socket = new WebSocket(
          `ws://127.0.0.1:${viewAddress.port}${session.streamPath}?${BROWSER_VIEW_DIALOG_QUERY}=1`,
          [`openbot-token.${VIEW_TOKEN}`],
        );
        socket.binaryType = "arraybuffer";
        const dialogs: Array<BrowserViewDialog | null> = [];
        let frames = 0;
        socket.addEventListener("message", (message) => {
          if (typeof message.data !== "string") {
            frames += 1;
            return;
          }
          const hostMessage = decodeBrowserViewHostMessage(message.data);
          if (hostMessage?.type === "dialog") dialogs.push(hostMessage.dialog);
        });
        await waitUntil(async () => dialogs.length > 0);
        assert.deepEqual(dialogs[0], { id: opened.id, type: "confirm", message: "Delete the test item?" });
        assert.equal(frames, 0, "The view drew the page while the dialog stopped it.");
        recordCases("view-shows-open-dialog-before-first-frame");

        socket.send(encodeBrowserViewInput({ type: "dialog", id: opened.id, accept: true }));
        await waitUntil(async () => frames > 0 && dialogs.at(-1) === null);
        assert.equal(await title(contents), "confirm:true");
        assert.equal((await box).aborted, true, "Electron's box stayed open after the person answered.");
        recordCases("view-answer-starts-the-view");

        const pageBox = nextBox();
        const shownBefore = dialogs.length;
        void contents.executeJavaScript("document.getElementById('confirm').click()", true).catch(() => undefined);
        await waitUntil(async () => dialogs.length > shownBefore);
        const pageDialog = dialogs.at(-1);
        assert(pageDialog, "The view got no dialog that the page opened while a person watched.");
        assert.equal(pageDialog.message, "Delete the test item?");
        socket.send(encodeBrowserViewInput({ type: "dialog", id: pageDialog.id, accept: false }));
        await waitUntil(async () => dialogs.at(-1) === null);
        assert.equal(await title(contents), "confirm:false");
        assert.equal((await pageBox).aborted, true, "Electron's box stayed open after the person answered.");
        recordCases("view-shows-dialog-that-opens-while-watched");

        const alertBox = nextBox();
        const shownBeforeAlert = dialogs.length;
        const target: { x: number; y: number } = await contents.executeJavaScript(
          "(() => { const r = document.getElementById('alert').getBoundingClientRect(); return { x: (r.x + r.width / 2) / innerWidth, y: (r.y + r.height / 2) / innerHeight }; })()",
          true,
        );
        for (const action of ["down", "up"] as const)
          socket.send(
            encodeBrowserViewInput({
              type: "pointer",
              action,
              ...target,
              button: "left",
              clickCount: 1,
              deltaX: 0,
              deltaY: 0,
              modifiers: 0,
            }),
          );
        await waitUntil(async () => dialogs.length > shownBeforeAlert);
        const personAlert = dialogs.at(-1);
        assert(personAlert, "The view got no alert that the person's click opened.");
        assert.equal(personAlert.type, "alert");
        assert.equal(personAlert.message, "Saved");
        assert.equal(
          (await alertBox).aborted,
          false,
          "The host answered the person's alert before the view showed it.",
        );
        socket.send(encodeBrowserViewInput({ type: "dialog", id: personAlert.id, accept: true }));
        await waitUntil(async () => (await title(contents)) === "alert:done");
        assert.equal((await alertBox).aborted, true, "Electron's box stayed open after the person answered.");
        recordCases("view-person-alert-in-agent-tab-shown");
        socket.close();
      } finally {
        await runCauseEffect(gateway.stop());
        viewServer.closeAllConnections();
        await new Promise<void>((resolve) => viewServer.close(() => resolve()));
      }
    }

    {
      phase("open-deadline-busy-page");
      const busy = await call("open", { url: `${origin}/busy` });
      assert.equal(busy.success, true, text(busy));
      assert.match(text(busy), /"loading":true/);
      phase("cases");
      recordCases("open-returns-at-deadline-on-busy-page");
    }

    {
      const { tabId } = await open();
      const box = nextBox();
      agentDialog(await click(tabId, "#confirm", "turn-5"));
      browser = undefined;
      await runCauseEffect(host.destroy());
      assert.equal((await box).aborted, true, "Electron's box stayed open after the browser closed.");
      recordCases("destroy-with-open-dialog");
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
        "Owned hidden native process, temporary profile, and a loopback page. BrowserHost tool calls, Electron's own dialog listeners, and a stand-in for the native box. No provider calls.",
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

function nextBox(): Promise<NativeBox> {
  const index = boxes.length;
  return new Promise((resolve) => {
    const check = () => {
      const box = boxes[index];
      if (!box) return;
      boxListeners.delete(check);
      resolve(box);
    };
    boxListeners.add(check);
  });
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + STATE_WAIT_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`State did not change in phase ${currentPhase}.`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function phase(name: string): void {
  currentPhase = name;
  process.stdout.write(`${JSON.stringify({ runId, phase: name, status: "running" })}\n`);
}

function recordCases(...names: string[]): void {
  for (const name of names) {
    cases.push(name);
    process.stdout.write(`${JSON.stringify({ runId, case: name, status: "passed" })}\n`);
  }
}
