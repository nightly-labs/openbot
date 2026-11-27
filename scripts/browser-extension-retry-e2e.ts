import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, type Worker } from "playwright-core";
import { argument, writeReport } from "./channel-e2e-support";

const NAME = "browser-extension-retry-e2e";
const EXTENSION = resolve(import.meta.dirname, "../apps/browser-extension");
const WAIT_MS = 30_000;
const BURST = 12;
const browserExecutable = argument("browser-executable");

type ListAnswer = "empty" | "revoked";

interface Phase {
  name: string;
  answer: ListAnswer;
  statusMessages: number;
  tabChanges: number;
  lists: number;
  lastReason: string;
  sendLists: number;
  sendReached: boolean;
}

let answer: ListAnswer = "empty";
let lists = 0;
const mock = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/v2/remote/hosts/" && request.method === "GET") {
      lists += 1;
      return answer === "empty"
        ? Response.json({ hosts: [] })
        : Response.json({ error: "session_invalid" }, { status: 401 });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  },
});
const apiUrl = `http://127.0.0.1:${mock.port}`;

const build = spawnSync("bun", ["run", "build", "--", "--mode", "development"], {
  cwd: EXTENSION,
  env: { ...process.env, VITE_OPENBOT_API_URL: apiUrl, VITE_OPENBOT_X_RULES_URL: `${apiUrl}/x-rules` },
  stdio: "inherit",
});
assert.equal(build.status, 0, "The extension build failed.");
const dist = resolve(EXTENSION, "dist");
const profile = mkdtempSync(resolve(tmpdir(), "openbot-extension-retry-"));
const context = await chromium.launchPersistentContext(profile, {
  ...(browserExecutable ? { executablePath: browserExecutable } : { channel: "chromium" }),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const phases: Phase[] = [];
let passed = false;

async function until<T>(label: string, read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

function signIn(worker: Worker, token: string): Promise<void> {
  const session = { token, user: { id: "retry-e2e-user", email: "retry-e2e@example.com" } };
  return worker.evaluate(`chrome.storage.local.set({ "openbot.session.v1": ${JSON.stringify(session)} })`);
}

function askStatus(worker: Worker): Promise<string> {
  return worker.evaluate<string>(
    'chrome.runtime.sendMessage({ kind: "openbot-x-offscreen", action: "status" }).then((value) => String(value?.reason ?? ""))',
  );
}

const SEND_PAYLOAD = {
  message: "Reply to this post.",
  pageUrl: "https://x.com/openbot/status/123456789012345678",
  posts: [
    {
      authorName: "OpenBot",
      handle: "@openbot",
      time: "2026-11-27T00:00:00.000Z",
      url: "https://x.com/openbot/status/123456789012345678",
      text: "A post.",
      article: "",
      media: [],
    },
  ],
  replyTo: 0,
};

function askSend(worker: Worker): Promise<boolean> {
  const message = { kind: "openbot-x-offscreen", action: "send", payload: SEND_PAYLOAD, clientMessageId: "retry-e2e" };
  return worker.evaluate<boolean>(
    `chrome.runtime.sendMessage(${JSON.stringify(message)}).then((value) => value?.reached === true)`,
  );
}

async function runPhase(worker: Worker, name: string, token: string, listAnswer: ListAnswer): Promise<Phase> {
  answer = listAnswer;
  await signIn(worker, token);
  const before = lists;
  const tab = await context.newPage();
  for (let index = 0; index < BURST; index += 1)
    await tab.goto(`data:text/html,<title>${name} ${index}</title>`, { waitUntil: "load" });
  await tab.close();
  let lastReason = "";
  for (let index = 0; index < BURST; index += 1) lastReason = await askStatus(worker);
  const beforeSend = lists;
  const sendReached = await askSend(worker);
  const phase = {
    name,
    answer: listAnswer,
    statusMessages: BURST,
    tabChanges: BURST + 1,
    lists: beforeSend - before,
    lastReason,
    sendLists: lists - beforeSend,
    sendReached,
  };
  phases.push(phase);
  return phase;
}

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: WAIT_MS }));
  await signIn(worker, "retry-e2e-token-1");
  const opener = await context.newPage();
  await opener.goto("data:text/html,<title>open</title>");
  await until(
    "the offscreen page",
    () => worker.evaluate<boolean>("chrome.offscreen.hasDocument()"),
    (open) => open,
  );
  await opener.close();
  lists = 0;

  const empty = await runPhase(worker, "no servers", "retry-e2e-token-1", "empty");
  assert.ok(empty.lists <= 1, `An account with no servers listed ${empty.lists} times, expected at most 1.`);
  assert.match(empty.lastReason, /^server-failed/u);
  assert.equal(empty.sendLists, 1, "A send must look for the server again after a failure.");
  assert.equal(empty.sendReached, false);

  const newToken = await runPhase(worker, "new session", "retry-e2e-token-2", "empty");
  assert.equal(newToken.lists, 1, "A new session must list the servers again once.");

  const revoked = await runPhase(worker, "revoked session", "retry-e2e-token-3", "revoked");
  assert.equal(revoked.lists, 1, `A revoked session listed ${revoked.lists} times, expected 1.`);
  assert.match(revoked.lastReason, /^server-failed/u);
  assert.equal(revoked.sendLists, 0, "A send with a refused session must wait for a new sign-in.");
  passed = true;
} finally {
  const path = writeReport(NAME, { burst: BURST, phases, passed });
  process.stdout.write(`${path}\n`);
  await context.close().catch(() => undefined);
  rmSync(profile, { recursive: true, force: true });
  await mock.stop(true);
}
