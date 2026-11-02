import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import type { BrowserSignInCookie } from "@openbot/contracts/team-protocol/browser-sign-in-v1";
import { redactText } from "@openbot/logging";
import { app, BrowserWindow, session, type WebContents, webContents } from "electron";
import { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { LocalSignInWindows } from "../src/main/local-sign-in-window";

/** Electron reports the OS sandbox of a process on macOS and Windows only. */
function assertSandboxed(contents: WebContents, name: string): void {
  if (process.platform === "linux") return;
  const metric = app.getAppMetrics().find((entry) => entry.pid === contents.getOSProcessId());
  assert.equal(metric?.sandboxed, true, `${name} is not in a sandbox.`);
}

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

const cases: string[] = [];
// Fixture values only. The report and the receipts carry cookie names, never values.
const SESSION_VALUE = "fixture-session";

// `/sign-in` is the site's sign-in page on this computer; `/home` tells the server's tab whether it is signed in.
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://fixture");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (url.pathname === "/sign-in") {
    response.setHeader("Set-Cookie", [
      `session=${SESSION_VALUE}; Path=/; HttpOnly`,
      "pref=dark; Path=/; Max-Age=3600; SameSite=Lax",
      "__cf_bm=fixture; Path=/",
      "cf_clearance=fixture; Path=/",
    ]);
    const other = url.searchParams.get("other") ?? "";
    response.end(
      `<!doctype html><meta charset="utf-8"><title>Sign in</title><script>document.cookie = "js=1; path=/";</script><iframe src="${other}/other"></iframe>`,
    );
    return;
  }
  // A sign-in on an address with no sign-in word: the password field shows the step.
  if (url.pathname === "/welcome") {
    response.end(
      `<!doctype html><meta charset="utf-8"><title>Welcome</title><form method="post" action="/account"><input type="password" name="secret" value="fixture"></form>`,
    );
    return;
  }
  if (url.pathname === "/account" && request.method === "POST") {
    response.writeHead(302, { "Set-Cookie": `session=${SESSION_VALUE}; Path=/; HttpOnly`, Location: "/feed" });
    response.end();
    return;
  }
  if (url.pathname === "/other") {
    response.setHeader("Set-Cookie", "other=fixture; Path=/; SameSite=None; Secure");
    response.end("<!doctype html><title>Other</title>");
    return;
  }
  const signedIn = (request.headers.cookie ?? "").split("; ").includes(`session=${SESSION_VALUE}`);
  response.end(`<!doctype html><meta charset="utf-8"><title>${signedIn ? "signed-in" : "signed-out"}</title>`);
});

let browser: BrowserHost | undefined;
let window: BrowserWindow | undefined;
const signIns = new LocalSignInWindows();
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
    // Another host name for the same server: a site that the tab does not show.
    const otherOrigin = `http://localhost:${address.port}`;
    await app.whenReady();
    phase("electron-ready");
    window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    browser = new BrowserHost(window, join(fixtureRoot, "downloads"), join(fixtureRoot, "tabs.json"), {
      browserProfile: (agentId) => (agentId === "own-session-agent" ? { kind: "agent" } : { kind: "shared" }),
    });
    const host = browser;
    const target = { serverId: "fixture-server", tabId: "" };

    phase("cases");
    const tab = await runCauseEffect(host.open(`${origin}/home`, "fixture-thread", "fixture-agent"));
    target.tabId = tab.id;
    const tabContents = webContents.getAllWebContents().find((item) => item.getURL() === tab.url);
    assert(tabContents, "Missing the tab contents.");
    assert.equal(tabContents.getTitle(), "signed-out");

    // 1. The window opens on its own session, with the embedded browser's sandbox.
    const created = nextWindow();
    const opened = runCauseEffect(signIns.open(target, `${origin}/sign-in?other=${encodeURIComponent(otherOrigin)}`));
    const signInWindow = await created;
    const contents = signInWindow.webContents;
    await loaded(contents);
    const signInSession = contents.session;
    assert.notEqual(signInSession, session.defaultSession, "The sign-in used the app session.");
    assert.notEqual(signInSession, tabContents.session, "The sign-in used the server browser session.");
    assert.equal(signInSession.isPersistent(), false, "The sign-in session is on disk.");
    assertSandboxed(contents, "The sign-in page");
    assert.equal(await contents.executeJavaScript("typeof require"), "undefined");
    assert.deepEqual(await signInSession.cookies.get({ name: "session", url: origin }).then(names), ["session"]);
    assert.deepEqual(await session.defaultSession.cookies.get({ url: origin }).then(names), []);
    assert.deepEqual(await tabContents.session.cookies.get({ url: origin }).then(names), []);
    recordCases("window-own-memory-session", "window-sandboxed", "app-and-tab-sessions-untouched");

    // 2. Permissions other than a clipboard write are refused.
    assert.equal(
      await contents.executeJavaScript(
        "navigator.permissions.query({ name: 'geolocation' }).then((state) => state.state)",
      ),
      "denied",
    );
    recordCases("permission-refused");

    // 3. A popup of a web page opens on the same session with the same rules; another scheme does not.
    const popupCreated = nextWindow();
    await contents.executeJavaScript(`void window.open(${JSON.stringify(`${origin}/home`)}); true`, true);
    const popup = await popupCreated;
    assert.equal(popup.webContents.session, signInSession, "The popup has another session.");
    // The script runs when the renderer process of the popup is ready, so its metric then exists.
    assert.equal(await popup.webContents.executeJavaScript("typeof require"), "undefined");
    assertSandboxed(popup.webContents, "The popup");
    assert.equal(await contents.executeJavaScript("window.open('about:blank') === null", true), true);
    recordCases("popup-same-session", "popup-other-scheme-refused");

    assert.deepEqual(
      await signInSession.cookies.get({ name: "other" }).then(names),
      ["other"],
      "No other-site cookie.",
    );
    // 4. Collect keeps the cookies of the tab's site only, without the address-bound ones.
    const collected = await runCauseEffect(signIns.collect());
    assert.deepEqual(names(collected), ["js", "pref", "session"]);
    const byName = new Map(collected.map((cookie) => [cookie.name, cookie]));
    assert.equal(byName.get("session")?.domain, "127.0.0.1", "A host-only cookie got a domain.");
    assert.equal(byName.get("session")?.httpOnly, true);
    assert.equal(byName.get("session")?.expirationDate, null);
    assert.equal(byName.get("pref")?.sameSite, "lax");
    assert.equal(Number.isInteger(byName.get("pref")?.expirationDate), true);
    assert.deepEqual(signIns.target(), { ...target, host: "127.0.0.1" });
    recordCases("collect-site-only", "collect-drops-address-bound", "collect-keeps-attributes");

    // 5. A closed window keeps the sign-in, so Done can still send it; it opens again on the same session.
    const popupClosed = closed(popup);
    popup.close();
    await popupClosed;
    const windowClosed = closed(signInWindow);
    signInWindow.close();
    await windowClosed;
    await opened;
    assert.deepEqual(names(await runCauseEffect(signIns.collect())), ["js", "pref", "session"]);
    const reopenedCreated = nextWindow();
    const reopened = runCauseEffect(signIns.open(target, `${origin}/home`));
    const reopenedWindow = await reopenedCreated;
    assert.equal(reopenedWindow.webContents.session, signInSession, "Reopen made a new session.");
    recordCases("closed-window-keeps-sign-in", "reopen-same-session");

    // 6. The host sets only the cookies of the tab's site, and loads the page again signed in.
    const foreign: BrowserSignInCookie = {
      name: "foreign",
      value: "fixture",
      domain: ".example.com",
      path: "/",
      secure: false,
      httpOnly: false,
      sameSite: "lax",
      expirationDate: null,
    };
    assert.equal(await runCauseEffect(host.importSignIn(tab.id, [foreign])), 0, "A foreign cookie was set.");
    // The domain text fits the tab's host, but the URL made from it points to another host.
    const crafted = { ...foreign, name: "crafted", domain: "localhost#.127.0.0.1" };
    assert.equal(await runCauseEffect(host.importSignIn(tab.id, [crafted])), 0, "A crafted domain was set.");
    const reloaded = loaded(tabContents);
    assert.equal(await runCauseEffect(host.importSignIn(tab.id, collected)), 3);
    await reloaded;
    assert.equal(tabContents.getTitle(), "signed-in");
    assert.deepEqual(await tabContents.session.cookies.get({ url: origin }).then(names), ["js", "pref", "session"]);
    assert.deepEqual(await tabContents.session.cookies.get({ name: "foreign" }).then(names), []);
    assert.deepEqual(await tabContents.session.cookies.get({ name: "crafted" }).then(names), []);
    recordCases(
      "import-refuses-other-site",
      "import-refuses-crafted-domain",
      "import-sets-site-cookies",
      "import-reloads-signed-in",
    );

    // 6b. A tab of an agent with a browser session of its own gets the sign-in in that session.
    const before = new Set(webContents.getAllWebContents());
    const ownTab = await runCauseEffect(host.open(`${origin}/home`, "own-session-thread", "own-session-agent"));
    const ownContents = webContents.getAllWebContents().find((item) => !before.has(item));
    assert(ownContents, "Missing the own-session tab contents.");
    assert.notEqual(ownContents.session, tabContents.session, "The agent tab uses the shared session.");
    const own: BrowserSignInCookie = { ...foreign, name: "own", domain: "127.0.0.1" };
    assert.equal(await runCauseEffect(host.importSignIn(ownTab.id, [own])), 1);
    assert.deepEqual(await ownContents.session.cookies.get({ name: "own" }).then(names), ["own"]);
    assert.deepEqual(
      await tabContents.session.cookies.get({ name: "own" }).then(names),
      [],
      "Went to the shared session.",
    );
    await runCauseEffect(host.close(ownTab.id));
    recordCases("import-uses-agent-session");

    // 7. Discard closes every window of the sign-in and removes what it kept.
    await runCauseEffect(signIns.discard());
    await reopened;
    assert.equal(reopenedWindow.isDestroyed(), true);
    assert.equal(signIns.target(), null);
    assert.deepEqual(await signInSession.cookies.get({}).then(names), []);
    assert.deepEqual(await runCauseEffect(signIns.collect()), []);
    recordCases("discard-closes-window", "discard-clears-session");

    // 8. A sign-in for another tab discards the one that is open.
    const firstCreated = nextWindow();
    const first = runCauseEffect(signIns.open(target, `${origin}/sign-in`));
    const firstWindow = await firstCreated;
    const firstSession = firstWindow.webContents.session;
    const secondCreated = nextWindow();
    const second = runCauseEffect(signIns.open({ ...target, tabId: "other-tab" }, `${origin}/home`));
    assert.equal(await first, "closed");
    assert.equal(firstWindow.isDestroyed(), true);
    const secondWindow = await secondCreated;
    assert.notEqual(secondWindow.webContents.session, firstSession, "The other tab reused the sign-in session.");
    assert.deepEqual(signIns.target(), { ...target, tabId: "other-tab", host: "127.0.0.1" });
    await runCauseEffect(signIns.discard());
    await second;
    recordCases("other-tab-replaces-sign-in");

    // 9. A sign-in step, then a cookie that the page cannot read, then a page after the sign-in, ends the
    // wait. The window stays open, and a new cookie is necessary to end the next wait.
    const autoTarget = { ...target, tabId: "auto-tab" };
    const autoCreated = nextWindow();
    const autoOpened = runCauseEffect(signIns.open(autoTarget, `${origin}/welcome`));
    const autoWindow = await autoCreated;
    const autoContents = autoWindow.webContents;
    await loaded(autoContents);
    await submitWhenSignInSeen(autoContents);
    assert.equal(await autoOpened, "signed-in");
    assert.equal(autoWindow.isDestroyed(), false, "The window closed after the sign-in.");
    assert.equal(new URL(autoContents.getURL()).pathname, "/feed");
    assert.deepEqual(await autoContents.session.cookies.get({ name: "session" }).then(names), ["session"]);
    recordCases("auto-sign-in-ends-wait", "auto-sign-in-keeps-window");

    const again = runCauseEffect(signIns.open(autoTarget, `${origin}/welcome`));
    assert.equal(autoWindow.isDestroyed(), false);
    await Promise.all([loaded(autoContents), autoContents.loadURL(`${origin}/welcome`)]);
    await submitWhenSignInSeen(autoContents);
    assert.equal(await again, "signed-in");
    recordCases("auto-sign-in-waits-again");

    const autoClosed = closed(autoWindow);
    const ended = runCauseEffect(signIns.open(autoTarget, `${origin}/feed`));
    autoWindow.close();
    await autoClosed;
    assert.equal(await ended, "closed");
    await runCauseEffect(signIns.discard());
    recordCases("auto-sign-in-close-ends-wait");

    const report = {
      status: "passed",
      runId,
      sourceSha: argument("source-sha"),
      harnessRuntime: argument("harness-runtime"),
      bunVersion: argument("bun-version"),
      electron: process.versions.electron,
      cases,
      scope:
        "Owned hidden native process, temporary profile, and loopback pages on two host names. The sign-in window on this computer and BrowserHost.importSignIn. No Team API transport, no remote host, no real site.",
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
    await runCauseEffect(signIns.discard());
    if (browser) await runCauseEffect(browser.destroy());
    if (window && !window.isDestroyed()) window.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.exit(Number(process.exitCode ?? 0));
  }
}

function names(cookies: readonly { name: string }[]): string[] {
  return cookies.map((cookie) => cookie.name).sort();
}

function nextWindow(): Promise<BrowserWindow> {
  return new Promise((resolve) => app.once("browser-window-created", (_event, created) => resolve(created)));
}

function loaded(contents: WebContents): Promise<void> {
  return new Promise((resolve) => contents.once("did-finish-load", () => resolve()));
}

/**
 * The window checks the page when it stops changing. The submit waits for that check, so the cookie
 * comes after the sign-in step: the check sees the password field and the page does not change.
 */
async function submitWhenSignInSeen(contents: WebContents): Promise<void> {
  await new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (!signIns.signInSeen()) return;
      clearInterval(poll);
      resolve();
    }, 50);
  });
  const navigated = new Promise<void>((resolve) => contents.once("did-navigate", () => resolve()));
  await contents.executeJavaScript("document.forms[0].submit(); true");
  await navigated;
}

function closed(window: BrowserWindow): Promise<void> {
  return new Promise((resolve) => window.once("closed", () => resolve()));
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
