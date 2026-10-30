// Builds the page that the iOS share extension runs (`bun scripts/mobile-share-sender.ts`), opens it
// from a file in Chrome as the extension opens it in its web view, and drives it through the bridge
// contract of `apps/mobile/plugins/share-extension/ShareSender.swift`:
// 1. The page runs under its Content Security Policy and offers `openbotShareSend`.
// 2. Every account service request goes through the bridge, with the session as a bearer token. The
//    page makes no request of its own.
// 3. A ticket that the account service refuses fails the share at `connect`, before any file is read,
//    and the page ends the session it made.
// 4. With a ticket, the page opens the Signal socket that the ticket names and sends the ticket there.
//
// No host takes part, so the WebRTC path after Signal and the message request are not covered here.
// Run: bun run test:mobile-share-sender
// It writes .openbot-build/mobile-share-sender-e2e/report.json and exits non-zero on a failure.
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "mobile-share-sender-e2e");
const PAGE = join(OUT, "share-sender.html");
const API_URL = "https://api.openbot.test/";
const SESSION_TOKEN = "share-e2e-session-token";
const SESSION_ID = "share-e2e-session";
/** The page goes into the extension bundle. The source translations once made it 2.4 MB. */
const PAGE_SIZE_LIMIT = 1_500_000;
const SIGNAL_WAIT_MS = 20_000;

const logger = createOpenBotLogger("mobile-share-sender-e2e");
const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

interface BridgeFetch {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

function shareRequest(hostId: string) {
  return {
    apiUrl: API_URL,
    sessionToken: SESSION_TOKEN,
    hostId,
    hostPublicKey: "share-e2e-host-key",
    hosted: false,
    agentId: "share-e2e-agent",
    text: "A shared link https://openbot.run",
    files: [{ name: "photo.png", mimeType: "image/png" }],
    clientMessageId: "share-e2e-message",
    timezone: "Europe/Warsaw",
  };
}

/** The call that `ShareSender.swift` makes, as a page script. */
function sendScript(hostId: string): string {
  return `window.openbotShareSend(${JSON.stringify(shareRequest(hostId))})`;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const build = spawnSync("bun", [join(ROOT, "scripts", "mobile-share-sender.ts"), PAGE], { stdio: "inherit" });
  check("the page builds", build.status === 0, { status: build.status });
  if (build.status !== 0) return;
  const size = statSync(PAGE).size;
  check("the page stays small", size < PAGE_SIZE_LIMIT, { size });

  // A Signal that keeps the first frame of each socket.
  const frames: string[] = [];
  const signal = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("Signal", { status: 426 })),
    websocket: {
      message(socket, message) {
        frames.push(String(message));
        socket.close(1000, "share e2e");
      },
    },
  });

  const fetches: BridgeFetch[] = [];
  const fileReads: number[] = [];
  const directRequests: string[] = [];
  const pageErrors: string[] = [];
  let ticketAnswer: "refuse" | "signal" = "refuse";

  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith("file:")) directRequests.push(request.url());
    });
    // The account service as the extension answers it, after its own origin check.
    await page.exposeFunction("openbotBridge", (message: unknown) => {
      if (!isDynamicRecord(message)) return null;
      if (message.type === "file") {
        fileReads.push(Number(message.index));
        return "iVBORw0KGgo=";
      }
      if (message.type !== "fetch" || !isString(message.url) || !isString(message.method)) return null;
      const headers = isDynamicRecord(message.headers) ? message.headers : {};
      fetches.push({
        url: message.url,
        method: message.method,
        headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])),
        body: isString(message.body) ? message.body : null,
      });
      const path = new URL(message.url).pathname;
      const json = (status: number, body: unknown) => ({
        status,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const expiresAt = Date.now() + 60_000;
      if (path === "/v2/remote/sessions/") return json(200, { sessionId: SESSION_ID, hostId: "host", expiresAt });
      if (path === `/v2/remote/sessions/${SESSION_ID}/ticket`) {
        return ticketAnswer === "refuse"
          ? json(404, { error: "membership_not_found", code: "membership_not_found" })
          : json(200, { ticket: "share-e2e-ticket", expiresAt, signalUrl: `ws://127.0.0.1:${signal.port}/` });
      }
      if (path === `/v2/remote/sessions/${SESSION_ID}/end`) return json(200, {});
      return json(404, { error: "not_found" });
    });
    // WebKit gives the page `window.webkit.messageHandlers.openbot`, whose `postMessage` returns the reply.
    await page.addInitScript(
      "window.webkit = { messageHandlers: { openbot: { postMessage: (message) => window.openbotBridge(message) } } };",
    );
    await page.goto(pathToFileURL(PAGE).href);
    const offered = await page.evaluate("typeof window.openbotShareSend");
    check("the page offers openbotShareSend under its CSP", offered === "function", { offered, pageErrors });

    // 2 and 3: a refused ticket.
    const refused = await page.evaluate(sendScript("host-refused"));
    check(
      "a refused ticket fails at connect, and may be given to the app",
      isDynamicRecord(refused) && refused.ok === false && refused.stage === "connect" && refused.unconfirmed === false,
      refused,
    );
    const create = fetches.find((item) => item.url === new URL("/v2/remote/sessions/", API_URL).href);
    check(
      "the session request goes through the bridge with the bearer token",
      create?.method === "POST" &&
        create.headers.authorization === `Bearer ${SESSION_TOKEN}` &&
        create.body === JSON.stringify({ hostId: "host-refused" }),
      create,
    );
    check("no file is read before the connection", fileReads.length === 0, fileReads);
    check(
      "the page ends the session it made",
      fetches.some((item) => item.url.endsWith(`/v2/remote/sessions/${SESSION_ID}/end`) && item.method === "POST"),
      fetches.map((item) => `${item.method} ${new URL(item.url).pathname}`),
    );

    // 4: a ticket that names a Signal.
    ticketAnswer = "signal";
    const pending = page.evaluate(sendScript("host-signal"));
    pending.catch(() => undefined);
    const deadline = Date.now() + SIGNAL_WAIT_MS;
    while (frames.length === 0 && Date.now() < deadline) await Bun.sleep(100);
    check(
      "the page opens the Signal socket and sends the ticket",
      frames.some((frame) => frame.includes("share-e2e-ticket")),
      frames.map((frame) => frame.slice(0, 200)),
    );
    check("the page makes no request of its own", directRequests.length === 0, directRequests);
    check("the page throws no error", pageErrors.length === 0, pageErrors);
  } finally {
    await browser.close();
    signal.stop(true);
  }
}

try {
  await main();
} catch (error) {
  check("the run finishes", false, error instanceof Error ? error.message : String(error));
}
const passed = checks.every((item) => item.passed);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ passed, checks }, null, 2)}\n`);
for (const item of checks) logger.info(`${item.passed ? "pass" : "FAIL"} ${item.name}`);
if (!passed) process.exit(1);
