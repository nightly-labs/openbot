// `bun run dev:extension`: a Chrome window with the browser extension (`apps/browser-extension`) for this
// worktree's `bun run dev` stack. It builds the extension for the stack's Auth API, starts Chrome for
// Testing with the extension in its own profile, signs the side panel in to the dev host's account, and
// leaves Chrome open. The profile stays in `.openbot-build/dev-extension-chrome`, so the next start is
// already signed in. Run it again after an extension change: it rebuilds the extension and reloads it in
// the open Chrome.
//
// `--fresh` starts with an empty profile. `--email=<address>` signs in another account (default: the
// dev host's). `--browser=<path>` names the browser; branded Google Chrome does not load an unpacked
// extension from the command line, so the default is Playwright's Chromium (`bunx playwright install
// chromium`).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { chromium } from "playwright-core";
import { argument } from "./channel-e2e-support";
import { readDevStackRecords } from "./dev-automation/stack-registry";

const ROOT = resolve(import.meta.dirname, "..");
const EXTENSION = resolve(ROOT, "apps/browser-extension");
const PROFILE = resolve(ROOT, ".openbot-build/dev-extension-chrome");
const WAIT_MS = 60_000;
const english = translateFor("en");
const email = argument("email") ?? "openbot-dev-host@example.com";

// 1. The Auth API of this worktree's stack.
const stack = readDevStackRecords().find((record) => resolve(record.projectRoot) === ROOT);
const apiPort = stack?.ports.find((port) => port.name === "api")?.port;
assert.ok(apiPort, "Start this worktree's dev stack first: bun run dev");
const authApi = `http://localhost:${apiPort}`;

// 2. A development build: it may reach `localhost`, and it talks to the stack's Auth API.
const build = spawnSync("bun", ["run", "build", "--", "--mode", "development"], {
  cwd: EXTENSION,
  env: { ...process.env, VITE_OPENBOT_API_URL: authApi },
  stdio: "inherit",
});
assert.equal(build.status, 0, "The extension build failed.");
const dist = resolve(EXTENSION, "dist");

/** Playwright's Chromium: the installed revision, else the newest one in its cache. */
function browserPath(): string {
  const named = argument("browser");
  if (named) return named;
  const own = chromium.executablePath();
  if (existsSync(own)) return own;
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === "darwin"
      ? join(homedir(), "Library/Caches/ms-playwright")
      : process.platform === "win32"
        ? join(process.env.LOCALAPPDATA ?? homedir(), "ms-playwright")
        : join(homedir(), ".cache/ms-playwright"));
  const revisions = existsSync(cache)
    ? readdirSync(cache)
        .filter((entry) => /^chromium-\d+$/.test(entry))
        .sort((left, right) => Number(right.slice(9)) - Number(left.slice(9)))
    : [];
  const inside =
    process.platform === "darwin"
      ? [
          "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        ]
      : process.platform === "win32"
        ? ["chrome-win64/chrome.exe", "chrome-win/chrome.exe"]
        : ["chrome-linux64/chrome", "chrome-linux/chrome"];
  for (const revision of revisions)
    for (const path of inside) if (existsSync(join(cache, revision, path))) return join(cache, revision, path);
  throw new Error("No Chromium found. Run `bunx playwright install chromium`, or pass --browser=<path>.");
}

// 3. Chrome, started as a person starts it, so the extension sees downloads as it does in use. A Chrome
// that this profile has open already is reused.
const portFile = resolve(PROFILE, "DevToolsActivePort");
async function openChrome(): Promise<string | null> {
  if (!existsSync(portFile)) return null;
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const reachable = await fetch(`http://127.0.0.1:${port}/json/version`).then(
    (response) => response.ok,
    () => false,
  );
  return reachable ? `http://127.0.0.1:${port}` : null;
}
let endpoint = await openChrome();
const reused = endpoint !== null;
if (reused) assert.ok(!process.argv.includes("--fresh"), "Close the dev extension's Chrome before --fresh.");
else {
  if (process.argv.includes("--fresh")) rmSync(PROFILE, { recursive: true, force: true });
  const downloadsDirectory = resolve(PROFILE, "downloads");
  mkdirSync(resolve(PROFILE, "Default"), { recursive: true });
  mkdirSync(downloadsDirectory, { recursive: true });
  const preferences = resolve(PROFILE, "Default", "Preferences");
  if (!existsSync(preferences))
    writeFileSync(
      preferences,
      // Developer mode: without it, Chrome turns an unpacked extension off when it reloads.
      JSON.stringify({
        download: { default_directory: downloadsDirectory, prompt_for_download: false },
        extensions: { ui: { developer_mode: true } },
      }),
    );
  rmSync(portFile, { force: true });
  const chrome = spawn(
    browserPath(),
    [
      `--user-data-dir=${PROFILE}`,
      // A free port, which Chrome writes to `DevToolsActivePort`. The dev app owns 9333 and up.
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      // Chrome 137 and later ignore `--load-extension` without this.
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      "--window-size=1400,900",
    ],
    { detached: true, stdio: "ignore" },
  );
  chrome.unref();
  const deadline = Date.now() + WAIT_MS;
  while (!endpoint) {
    assert.ok(Date.now() < deadline, "Chrome did not start. Close a Chrome that uses this profile, or pass --fresh.");
    await new Promise((next) => setTimeout(next, 200));
    endpoint = await openChrome();
  }
}
const downloads = resolve(PROFILE, "downloads");
assert.ok(endpoint, "Chrome did not start.");
// On macOS a Chrome whose last window closed keeps running, and with no window Playwright cannot
// connect. A new window comes first.
if (reused) {
  // Each target in the list has an "id".
  const targets = await (await fetch(`${endpoint}/json/list`)).text();
  if (!targets.includes('"id"')) await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" });
}
const browser = await chromium.connectOverCDP(endpoint);
try {
  const context = browser.contexts()[0];
  assert.ok(context, "Chrome has no window.");
  // A component extension of Chrome also has a `background.js`; this extension's comes from `dist`.
  const ours = (worker: { url(): string }) =>
    worker.url().endsWith("/background.js") &&
    !worker.url().startsWith("chrome-extension://admccjkmockfdflocgggjfgdacdodkdf/");
  const worker =
    context.serviceWorkers().find(ours) ??
    (await context.waitForEvent("serviceworker", { predicate: ours, timeout: WAIT_MS }));
  const extensionId = new URL(worker.url()).host;
  {
    // Chrome loads the new build from `dist`, as the Reload button of chrome://extensions does. A new
    // start needs it too: a profile keeps the service worker of the build that it ran last, and Chrome
    // starts that one again while the manifest version is the same. Chrome turns an unpacked extension
    // off when it reloads outside developer mode, so the page turns developer mode and the extension on
    // first. The wait starts first: the new worker starts at once.
    // The reload closes the extension's pages; a window with only the panel page would close with them.
    await context.newPage();
    const restarted = context.waitForEvent("serviceworker", {
      predicate: (next) => ours(next) && next !== worker,
      timeout: WAIT_MS,
    });
    const extensions = await context.newPage();
    await extensions.goto("chrome://extensions");
    await extensions.evaluate(`(async () => {
      await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
      await chrome.management.setEnabled(${JSON.stringify(extensionId)}, true);
      await chrome.developerPrivate.reload(${JSON.stringify(extensionId)}, { failQuietly: false });
    })()`);
    await extensions.close();
    await restarted;
  }

  // 4. The side panel page in a tab, signed in to the stack, unless the profile is signed in already.
  const panel =
    context.pages().find((page) => page.url() === "about:blank" || page.url().endsWith("/sidepanel.html")) ??
    (await context.newPage());
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const serverMenu = panel.getByRole("button", { name: english("extension.home.serverMenu") });
  const signInButton = panel.getByRole("button", { name: english("extension.signIn.withWeb") });
  await Promise.race([serverMenu.waitFor({ timeout: WAIT_MS }), signInButton.waitFor({ timeout: WAIT_MS })]);
  if (await signInButton.isVisible()) {
    const web = await context.newPage();
    await web.goto(`${authApi}/app`);
    const emailField = web.getByRole("textbox", { name: english("account.login.email") });
    // The web app of this profile may be signed in already.
    if (
      await emailField.waitFor({ timeout: 15_000 }).then(
        () => true,
        () => false,
      )
    ) {
      await emailField.fill(email);
      await web.getByRole("button", { name: english("account.login.sendCode") }).click();
      const codeLine = web.getByText(/^Development code: /);
      await codeLine.waitFor({ timeout: WAIT_MS });
      const code = (await codeLine.textContent())?.replace(/^Development code: /, "").replace(/[^A-Za-z0-9]/g, "");
      assert.ok(code, "The web app shows no development code.");
      await web.keyboard.type(code);
      await web.waitForFunction(() => !document.querySelector(".account-login-screen"), null, { timeout: WAIT_MS });
    }
    await web.close();
    // "Sign in with openbot.run" opens the web app's window, which asks to allow the extension once.
    const opened = context.waitForEvent("page", {
      predicate: (page) => page.url().includes("extension=") && !page.url().includes("silent=1"),
      timeout: WAIT_MS,
    });
    await signInButton.click();
    const allowWindow = await Promise.race([opened, serverMenu.waitFor({ timeout: WAIT_MS }).then(() => null)]);
    if (allowWindow) {
      await allowWindow.getByRole("button", { name: english("webClient.extension.allow") }).click({ timeout: WAIT_MS });
    }
    await serverMenu.waitFor({ timeout: WAIT_MS });
  }
  // Playwright took the downloads over when it connected; Chrome gets them back.
  await (await browser.newBrowserCDPSession()).send("Browser.setDownloadBehavior", { behavior: "default" });
  process.stdout.write(
    [
      "",
      `Chrome is open with OpenBot (Dev), signed in as ${email} to ${authApi}.`,
      `The side panel page is open in a tab. Click the OpenBot icon to open it in the side panel.`,
      `Profile: ${PROFILE} (--fresh starts over). Downloads go to ${downloads}.`,
      "After an extension change, run this again: it rebuilds and reloads the extension in this Chrome.",
    ].join("\n") + "\n",
  );
} finally {
  // Only the connection ends; Chrome stays open.
  await browser.close();
}
