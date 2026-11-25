import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { dirname, join } from "node:path";
import type { BrowserTab } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { app, BrowserWindow } from "electron";
import { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

app.commandLine.appendSwitch("ignore-certificate-errors");

const USERNAME = "fixture-user";
const PASSWORD = "fixture-password";
const WRONG_PASSWORD = "fixture-wrong";
const cases: string[] = [];
const requests: { path: string; authorization: "none" | "right" | "wrong" }[] = [];
let currentPhase = "entry";

function authorization(request: IncomingMessage): "none" | "right" | "wrong" {
  const header = request.headers.authorization;
  if (!header) return "none";
  return header === `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}` ? "right" : "wrong";
}

function page(response: ServerResponse, status: number, title: string, body = "", headers = {}): void {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
  response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title>${body}`);
}

function site(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", "https://fixture");
  const sent = authorization(request);
  requests.push({ path: url.pathname, authorization: sent });
  if (url.pathname === "/open") {
    page(response, 200, "open", url.searchParams.has("image") ? '<img src="/image">' : "");
    return;
  }
  const realm = url.pathname === "/other" ? "Other" : url.pathname === "/image" ? "Image" : "Files";
  if (sent === "right" && url.pathname === "/files") {
    page(response, 200, "files-open");
    return;
  }
  page(response, 401, "unauthorized", "", { "WWW-Authenticate": `Basic realm="${realm}"` });
}

let browser: BrowserHost | undefined;
let window: BrowserWindow | undefined;
let secureServer: ReturnType<typeof createHttpsServer> | undefined;
const plain = createHttpServer(site);

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
    const keyPath = join(fixtureRoot, "key.pem");
    const certificatePath = join(fixtureRoot, "certificate.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-keyout",
        keyPath,
        "-out",
        certificatePath,
      ],
      { stdio: "ignore" },
    );
    secureServer = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certificatePath) }, site);
    const secureOrigin = `https://127.0.0.1:${await listen(secureServer)}`;
    const plainOrigin = `http://127.0.0.1:${await listen(plain)}`;
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
    const tabOf = (tabId: string) => host.listTabs().find((tab) => tab.id === tabId);
    const changed = (test: () => boolean) =>
      new Promise<void>((resolve) => {
        if (test()) {
          resolve();
          return;
        }
        const stop = host.onChanged(() => {
          if (!test()) return;
          stop();
          resolve();
        });
      });
    const settled = (tabId: string, test: (tab: BrowserTab) => boolean) =>
      changed(() => {
        const tab = tabOf(tabId);
        return tab !== undefined && !tab.loading && test(tab);
      });

    phase("cases");
    const tab = await runCauseEffect(host.open(`${secureOrigin}/files`, "fixture-thread", "fixture-agent"));
    await settled(tab.id, (current) => current.httpSignIn !== undefined && current.title === "unauthorized");
    assert.deepEqual(tabOf(tab.id)?.httpSignIn, { origin: secureOrigin });
    recordCases("https-prompt-shows-and-page-loads");

    const snapshot = await runCauseEffect(host.snapshot(tab.id));
    assert.equal(snapshot.challenge?.vendor, "http-sign-in");
    assert.equal(snapshot.challenge?.status, "needs-user");
    assert.match(snapshot.challenge?.next ?? "", /request_takeover/u);
    recordCases("snapshot-tells-agent-to-ask-for-takeover");

    const beforeWrong = requests.length;
    await runCauseEffect(host.answerHttpSignIn({ tabId: tab.id, username: USERNAME, password: WRONG_PASSWORD }));
    await settled(tab.id, (current) => current.httpSignIn?.refused === true);
    assert.deepEqual(tabOf(tab.id)?.httpSignIn, { origin: secureOrigin, refused: true });
    const wrongTries = requests.slice(beforeWrong).filter((entry) => entry.authorization === "wrong");
    assert.equal(wrongTries.length, 1, "The host sent the wrong answer more than once.");
    recordCases("wrong-answer-sent-once-and-refused");

    const beforeRight = requests.length;
    await runCauseEffect(host.answerHttpSignIn({ tabId: tab.id, username: USERNAME, password: PASSWORD }));
    await settled(tab.id, (current) => current.title === "files-open");
    assert.equal(tabOf(tab.id)?.httpSignIn, undefined);
    assert.ok(requests.slice(beforeRight).some((entry) => entry.path === "/files" && entry.authorization === "right"));
    recordCases("right-answer-signs-in-and-closes-prompt");

    await assert.rejects(
      runCauseEffect(host.answerHttpSignIn({ tabId: tab.id, username: USERNAME, password: PASSWORD })),
      (error: unknown) => String(error).includes(sourceText("error.backend.browserHttpSignInInactive")),
    );
    recordCases("answer-without-prompt-refused");

    const other = await runCauseEffect(host.open(`${secureOrigin}/other`, "fixture-thread", "fixture-agent"));
    await settled(other.id, (current) => current.httpSignIn !== undefined);
    const beforeCancel = requests.length;
    await runCauseEffect(host.answerHttpSignIn({ tabId: other.id, cancel: true }));
    await settled(other.id, (current) => current.httpSignIn === undefined);
    assert.equal(tabOf(other.id)?.title, "unauthorized");
    assert.equal(requests.length, beforeCancel, "A cancel loaded the page again.");
    recordCases("cancel-closes-prompt-and-keeps-page");

    await runCauseEffect(host.loadUrl(other.id, `${secureOrigin}/other`));
    await settled(other.id, (current) => current.httpSignIn !== undefined);
    await runCauseEffect(host.loadUrl(other.id, `${secureOrigin}/open`));
    await settled(other.id, (current) => current.title === "open");
    assert.equal(tabOf(other.id)?.httpSignIn, undefined);
    recordCases("navigation-closes-prompt");

    const plainTab = await runCauseEffect(host.open(`${plainOrigin}/files`, "fixture-thread", "fixture-agent"));
    await settled(plainTab.id, (current) => current.title === "unauthorized");
    assert.equal(tabOf(plainTab.id)?.httpSignIn, undefined);
    recordCases("plain-http-prompt-not-shown");

    const imageTab = await runCauseEffect(host.open(`${secureOrigin}/open?image`, "fixture-thread", "fixture-agent"));
    await changed(() => requests.some((entry) => entry.path === "/image"));
    await settled(imageTab.id, (current) => current.title === "open");
    assert.equal(tabOf(imageTab.id)?.httpSignIn, undefined);
    recordCases("subresource-prompt-not-shown");

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      cases,
      scope:
        "Owned hidden native process, temporary profile, and loopback HTTP and HTTPS fixture sites with HTTP Basic sign-in. BrowserHost only: no Team API transport, no renderer, no real site.",
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
    for (const server of [secureServer, plain]) {
      if (!server?.listening) continue;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    app.exit(Number(process.exitCode ?? 0));
  }
}

async function listen(server: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object", "Fixture server address missing.");
  return address.port;
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
