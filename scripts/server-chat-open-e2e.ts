import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { argument, WAIT_MS } from "./channel-e2e-support";
import { type AutomationSession, assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

const NAME = "server-chat-open";
const ROOT = resolve(import.meta.dirname, "..");
const chat = argument("chat") ?? "Scale 1";
const other = argument("other") ?? "Chief";
const seconds = Number(argument("seconds") ?? "8");
assert.ok(Number.isFinite(seconds) && seconds > 0, "--seconds takes a number of seconds.");
const label = argument("label") ?? "current";
assert.match(label, /^\w[\w.-]*$/, "--label takes a folder name, not a path.");
const OUT = resolve(ROOT, ".openbot-build", NAME, label);
const logger = createOpenBotLogger(NAME);
const BOTTOM_TOLERANCE_PX = 2;

interface Frame {
  t: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  anchor: string | null;
  anchorY: number | null;
  loadingOlder: boolean;
}

interface OpenReport {
  frames: Frame[];
  awayFromBottom: Frame[];
  moves: number;
  lastMoveAt: number | null;
  olderPageAt: number | null;
}

const RECORDER = `(() => {
  const before = new Set([...document.querySelectorAll("[data-chat-search-message]")].map((row) => row.getAttribute("data-chat-search-message")));
  const frames = [];
  window.__chatOpenFrames = frames;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:-10px;top:-10px;width:1px;height:1px;pointer-events:none";
  document.body.append(probe);
  window.__chatOpenProbe = probe;
  let start = performance.now();
  window.__chatOpenStart = () => { start = performance.now(); };
  let last = "";
  const sample = () => {
    const element = document.querySelector(".conversation-scroll");
    if (!element) return;
    const top = element.getBoundingClientRect().top;
    let anchor = null;
    let anchorY = null;
    for (const row of element.querySelectorAll("[data-chat-search-message]")) {
      const box = row.getBoundingClientRect();
      if (box.bottom <= top + 4) continue;
      anchor = row.getAttribute("data-chat-search-message");
      anchorY = Math.round(box.top - top);
      break;
    }
    if (anchor === null || before.has(anchor)) return;
    const frame = {
      t: Math.round(performance.now() - start),
      scrollTop: Math.round(element.scrollTop),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      anchor,
      anchorY,
      loadingOlder: document.querySelector(".conversation-history-status") !== null,
    };
    const key = JSON.stringify({ ...frame, t: 0 });
    if (key !== last) frames.push(frame);
    last = key;
  };
  new ResizeObserver(sample).observe(probe);
  let wide = false;
  const tick = () => {
    if (!probe.isConnected) return;
    wide = !wide;
    probe.style.width = wide ? "2px" : "1px";
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

function testClient(): DevInstanceRecord {
  const instances = readDevInstanceRecords().filter(
    (record) => record.service === "test-client" && resolve(record.projectRoot) === ROOT,
  );
  assert.equal(
    instances.length,
    1,
    "Start `OPENBOT_DEV_CLIENT_TRANSPORT=webrtc OPENBOT_DEV_RTT_MS=600 bun run dev:test-client` in this worktree first.",
  );
  const [instance] = instances;
  assert.ok(instance);
  return instance;
}

function connect(instance: DevInstanceRecord): Promise<AutomationSession> {
  return connectToDevApp(instance.remoteDebuggingPort, logger, {
    expectedRendererPort: instance.rendererPort,
    ownerPid: instance.pid,
  });
}

async function chatButton(page: Page, name: string): Promise<void> {
  await page
    .waitForFunction(
      (prefix) =>
        [...document.querySelectorAll("button")].some((button) =>
          (button.getAttribute("aria-label") ?? "").startsWith(prefix),
        ),
      `${name},`,
      { polling: 100, timeout: WAIT_MS },
    )
    .catch((error: unknown) => {
      throw new Error(`Timed out: the sidebar shows the chat "${name}".`, { cause: error });
    });
}

async function openChat(page: Page, name: string): Promise<void> {
  await chatButton(page, name);
  await page.evaluate((prefix) => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      (candidate.getAttribute("aria-label") ?? "").startsWith(prefix),
    );
    if (!(button instanceof HTMLElement)) throw new Error(`No chat ${prefix}`);
    button.click();
  }, `${name},`);
}

async function settleOnOther(page: Page): Promise<void> {
  await openChat(page, other);
  await page
    .waitForFunction(
      () => {
        const element = document.querySelector(".conversation-scroll");
        if (!element || element.querySelector("[data-chat-search-message]") === null) return false;
        if (document.querySelector(".conversation-history-status") !== null) return false;
        const view = element.getBoundingClientRect();
        return [...element.querySelectorAll("img")].every((image) => {
          const box = image.getBoundingClientRect();
          return box.bottom <= view.top || box.top >= view.bottom || image.complete;
        });
      },
      undefined,
      { polling: 100, timeout: WAIT_MS },
    )
    .catch((error: unknown) => {
      throw new Error(`Timed out: the chat "${other}" settles.`, { cause: error });
    });
}

async function recordOpen(page: Page): Promise<OpenReport> {
  await settleOnOther(page);
  await page.evaluate(RECORDER);
  await page.evaluate("window.__chatOpenStart()");
  await openChat(page, chat);
  await page.waitForTimeout(seconds * 1000);
  const frames = await page.evaluate<Frame[]>("window.__chatOpenFrames");
  await page.evaluate("window.__chatOpenProbe.remove()");
  assert.ok(frames.length > 0, `The chat "${chat}" did not show any row within ${seconds} s.`);
  let moves = 0;
  let lastMoveAt: number | null = null;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const frame = frames[index];
    if (previous && frame && (previous.anchor !== frame.anchor || previous.anchorY !== frame.anchorY)) {
      moves += 1;
      lastMoveAt = frame.t;
    }
  }
  return {
    frames,
    awayFromBottom: frames.filter(
      (frame) => frame.scrollHeight - frame.clientHeight - frame.scrollTop > BOTTOM_TOLERANCE_PX,
    ),
    moves,
    lastMoveAt,
    olderPageAt: frames.find((frame) => frame.loadingOlder)?.t ?? null,
  };
}

const instance = testClient();
assertMutationAllowed({
  command: "server-chat-open reloads the test client and opens chats",
  allowMutations: process.argv.includes("--allow-mutations"),
  instanceNamed: true,
  target: instance.instanceId,
});
const session = await connect(instance);
try {
  const page = session.page;
  const server = await page.evaluate<string | null>(`(async () => {
    const servers = await window.openbot.servers.list();
    const remote = servers.find((server) => server.kind === "remote");
    if (!remote) return null;
    if (!remote.active) await window.openbot.servers.select(remote.id);
    return remote.name;
  })()`);
  assert.ok(server, "The test client has no remote server. Restart the test client after the host registers.");
  logger.info(`server: ${server}`);
  await page.reload();
  const first = await recordOpen(page);
  logger.info("first open", JSON.stringify({ ...first, frames: first.frames.length }));
  const again = await recordOpen(page);
  logger.info("open again", JSON.stringify({ ...again, frames: again.frames.length }));
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, "chat.png") });
  const failures = [
    ...(first.awayFromBottom.length === 0
      ? []
      : [`first open: ${first.awayFromBottom.length} frames not at the bottom`]),
    ...(again.awayFromBottom.length === 0
      ? []
      : [`open again: ${again.awayFromBottom.length} frames not at the bottom`]),
    ...(first.olderPageAt === null ? [] : [`first open: an older page loaded at ${first.olderPageAt} ms`]),
    ...(again.olderPageAt === null ? [] : [`open again: an older page loaded at ${again.olderPageAt} ms`]),
    ...(again.moves === 0 ? [] : [`open again: rows moved in ${again.moves} frames`]),
  ];
  writeFileSync(
    resolve(OUT, "report.json"),
    `${JSON.stringify({ label, server, chat, other, seconds, first, again, failures }, null, 2)}\n`,
  );
  logger.info(`report: ${resolve(OUT, "report.json")}`);
  assert.deepEqual(failures, [], failures.join("; "));
} finally {
  await session.close();
}
