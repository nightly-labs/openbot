import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { app, BrowserWindow, type WebContents, webContents } from "electron";
import { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams, DynamicToolResult } from "../src/backend/protocol";
import { LESSONS, LessonCalendar, TARGET_LESSON } from "./browser-lesson-calendar-fixture";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

const cases: string[] = [];
// The refusal texts that the agent reads, for the report. They hold fixture data only.
const refusals: Record<string, string> = {};
const THREAD_ID = "fixture-thread";
const SHARED_LAYOUT_SELECTOR = 'div[data-mh="event-7"]';
const SHARED_LAYOUT_LESSONS = LESSONS.filter((lesson) => lesson.layout === "event-7");
const calendar = new LessonCalendar();
const server = createServer((request, response) => {
  if (!calendar.handle(request, response)) {
    response.statusCode = 404;
    response.end();
  }
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
      width: 1280,
      height: 900,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"));
    const host = browser;

    const call = (tool: string, args: DynamicToolCallParams["arguments"]): Promise<DynamicToolResult> =>
      Effect.runPromise(
        host.handleDynamicTool({
          namespace: "openbot_browser",
          tool,
          arguments: args,
          ownerAgentId: "fixture-agent",
          threadId: THREAD_ID,
          turnId: "fixture-turn",
          callId: `ambiguous-${++sequence}`,
        } satisfies DynamicToolCallParams),
      );
    const text = (result: DynamicToolResult): string => {
      const item = result.contentItems.find((content) => content.type === "inputText");
      assert(item?.type === "inputText", "Missing tool result text.");
      return item.text;
    };
    const refusal = (result: DynamicToolResult): string => {
      assert.equal(result.success, false, "The ambiguous target was not refused.");
      return text(result);
    };
    const candidateLines = (message: string) => message.split("\n").filter((line) => /^\d+\. /u.test(line));
    const clicks = (contents: WebContents) => contents.executeJavaScript("window.fixtureClicks", true);

    const tab = await runCauseEffect(host.open(`${origin}/calendar`, THREAD_ID, "fixture-agent"));
    const tabId = tab.id;
    const contents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
    assert(contents, "Missing fixture contents.");
    await contents.executeJavaScript(
      `(() => {
        const card = document.querySelector('[meta\\\\:id="L-1043"]');
        const hidden = document.createElement('span');
        hidden.hidden = true;
        hidden.textContent = 'hidden-fixture-note';
        const field = document.createElement('input');
        field.type = 'password';
        field.value = 'fixture-field-secret';
        card.append(hidden, field);
        return true;
      })()`,
      true,
    );

    phase("cases");

    {
      const message = refusal(
        await call("click", { tabId, target: { kind: "css", selector: SHARED_LAYOUT_SELECTOR } }),
      );
      refusals.css = message;
      assert.match(message, /CSS selector is ambiguous \(at least 5 matches\)/u);
      assert.match(message, /No input was sent/u);
      assert.equal(await clicks(contents), 0, "The refused click reached the page.");
      assert.deepEqual(calendar.registrations, []);
      recordCases("css-ambiguous-sends-no-input");

      const lines = candidateLines(message);
      assert.equal(lines.length, SHARED_LAYOUT_LESSONS.length, message);
      for (const lesson of SHARED_LAYOUT_LESSONS) {
        const line = lines.find((one) => one.includes(lesson.date) && one.includes(lesson.time));
        assert(line, `No candidate names ${lesson.id}: ${message}`);
        assert(line.includes(lesson.title) && line.includes(lesson.location), line);
      }
      // A card is not actionable, so it has no ref, and the error says how to get one.
      assert(!message.includes("ref="), message);
      assert.match(message, /Take a fresh snapshot/u);

      // Five of the six buttons are candidates. The item of a candidate stops before another
      // "Register" button, so it does not take in the lesson that the capped list leaves out.
      const buttons = refusal(
        await call("click", { tabId, target: { kind: "css", selector: `${SHARED_LAYOUT_SELECTOR} button` } }),
      );
      refusals.cssButtons = buttons;
      const buttonLines = candidateLines(buttons);
      assert.equal(buttonLines.length, 5, buttons);
      for (const [index, lesson] of SHARED_LAYOUT_LESSONS.entries()) {
        const line = buttonLines[index] ?? "";
        assert(line.includes(`in "`) && line.includes(lesson.date) && line.includes(lesson.location), line);
        for (const other of LESSONS)
          if (other.id !== lesson.id) assert(!line.includes(`${other.date} · ${other.time}`), line);
      }
      assert.equal(await clicks(contents), 0, "The refused click reached the page.");
      recordCases("css-candidates-name-each-item");

      assert(!message.includes("hidden-fixture-note"), "A candidate showed hidden text.");
      assert(!message.includes("fixture-field-secret"), "A candidate showed a field value.");
      recordCases("candidate-text-hides-hidden-text-and-field-values");
    }

    {
      const snapshot = await call("snapshot", { tabId, image: "never" });
      assert.equal(snapshot.success, true, text(snapshot));
      const message = refusal(
        await call("click", { tabId, target: { kind: "role", role: "button", name: "Register", exact: true } }),
      );
      refusals.role = message;
      assert.match(message, /Target is ambiguous \(at least 5 matches\)/u);
      assert.equal(await clicks(contents), 0, "The refused click reached the page.");
      const lines = candidateLines(message);
      assert.equal(lines.length, 5, message);
      for (const line of lines) assert.match(line, /^\d+\. ref=\d+:main:\d+ button "Register" in "/u);
      assert(!message.includes("Take a fresh snapshot"), message);
      recordCases("role-candidates-have-refs-and-items");

      const intended = lines.find(
        (line) =>
          line.includes(TARGET_LESSON.date) &&
          line.includes(TARGET_LESSON.time) &&
          line.includes(TARGET_LESSON.location),
      );
      const ref = intended && /ref=(\d+):(\S+)/u.exec(intended);
      // The first five buttons are Monday to Thursday: the target lesson is among them.
      assert(ref?.[1], `No candidate names the intended lesson: ${message}`);
      const clicked = await call("click", {
        tabId,
        target: { kind: "ref", ref: `${ref[1]}:${ref[2]}`, revision: Number(ref[1]) },
      });
      assert.equal(clicked.success, true, text(clicked));
      await waitUntil(async () => calendar.registrations.length > 0);
      assert.deepEqual(calendar.registrations, [TARGET_LESSON.id]);
      const status = String(await contents.executeJavaScript("document.getElementById('status').textContent", true));
      assert.match(status, new RegExp(`${TARGET_LESSON.title}, ${TARGET_LESSON.date}`, "u"));
      recordCases("candidate-ref-registers-intended-lesson");

      const clicksBefore = await clicks(contents);
      refusal(await call("click", { tabId, target: { kind: "role", role: "button", name: "Register", exact: true } }));
      assert.equal(await clicks(contents), clicksBefore, "The refused retry reached the page.");
      assert.deepEqual(calendar.registrations, [TARGET_LESSON.id], "A refused retry booked again.");
      recordCases("refused-retry-does-not-replay");
    }

    {
      const unique = await call("click", {
        tabId,
        target: { kind: "css", selector: 'div.event[meta\\:id="L-1042"] button' },
      });
      assert.equal(unique.success, true, text(unique));
      await waitUntil(async () => calendar.registrations.length > 1);
      assert.deepEqual(calendar.registrations, [TARGET_LESSON.id, "L-1042"]);
      recordCases("unique-css-target-acts");
    }

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      cases,
      registrations: calendar.registrations,
      refusals,
      scope:
        "Owned hidden native process, temporary profile, and a loopback lesson calendar. BrowserHost tool calls only. No provider calls.",
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

/** Checks a state again after each turn of the event loop, until it holds. */
async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 10_000;
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
