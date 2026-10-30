import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
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

const PAGE = `<!doctype html><meta charset="utf-8"><title>start</title>
<button id="confirm" onclick="document.title = 'confirm:' + confirm('Delete the test item?')">Confirm</button>
<button id="alert" onclick="alert('Saved'); document.title = 'alert:done'">Alert</button>
<button id="chain" onclick="if (confirm('First?')) alert('Second'); document.title = 'chain:done'">Chain</button>
<button id="secret" onclick="document.title = 'secret:' + confirm('Use password=hunter2 here?')">Secret</button>
<button id="prompt" onclick="document.title = 'prompt:' + prompt('Name?')">Prompt</button>
<form action="/done" onsubmit="return confirm('Send the form?')"><button id="submit">Send</button></form>`;

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(request.url === "/done" ? '<!doctype html><meta charset="utf-8"><title>done</title>' : PAGE);
});

/**
 * Electron's own box for a page dialog. The fixture shows none: a person answers with `answer`, and
 * `aborted` records that Electron closed the box with its internal cancel event.
 */
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

      const secret = agentDialog(await click(tabId, "#secret"));
      assert(!secret.message.includes("hunter2"), "The dialog text kept a secret.");
      assert.match(secret.message, /\[redacted\]/);
      assert.equal((await answer(tabId, secret.id, false)).success, true);
      recordCases("dialog-text-redacted");

      const prompt = await click(tabId, "#prompt");
      assert.equal(prompt.success, true, text(prompt));
      assert.equal(JSON.parse(text(prompt)).dialog, undefined, "The agent got a prompt dialog.");
      // Electron's page throws "prompt() is not supported", so no dialog opens.
      assert.match(text(prompt), /prompt\(\) is not supported/);
      recordCases("prompt-not-claimed");

      const submit = agentDialog(await click(tabId, "#submit"));
      const submitted = await answer(tabId, submit.id, true);
      assert.equal(submitted.success, true, text(submitted));
      assert.match(JSON.parse(text(submitted)).url, /\/done\??$/);
      recordCases("form-navigation-kept-after-accept");
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
      failure(await call("snapshot", { tabId, image: "never" }, "turn-2"), /only a person can answer it/);
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
      // A person's click: no agent tool runs.
      const clicked = contents.executeJavaScript("document.getElementById('confirm').click()", true);
      assert.equal((await box).aborted, false);
      (await box).answer(1);
      await clicked;
      assert.equal(await title(contents), "confirm:false");
      recordCases("person-dialog-stays-native");
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
      // The tab closes after its queue drains.
      const shown = await box;
      await waitUntil(async () => shown.aborted);
      recordCases("close-tab-with-open-dialog");
    }

    {
      const { tabId, contents } = await open();
      const box = nextBox();
      // A person's dialog. Electron keeps its box open after the page closes.
      void contents.executeJavaScript("document.getElementById('confirm').click()", true).catch(() => undefined);
      const shown = await box;
      await runCauseEffect(host.close(tabId));
      await waitUntil(async () => shown.aborted);
      recordCases("person-dialog-closed-with-tab");
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

/** The next box that Electron shows. */
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

/** Checks a state again after each turn of the event loop, until it holds. */
async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + STATE_WAIT_MS;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`State did not change in phase ${currentPhase}.`);
    await new Promise<void>((resolve) => setImmediate(resolve));
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
