// The setup page of a server in a container (src/main/server-setup-page.ts), the page that the Umbrel
// app opens (docs/umbrel.md). It runs the real page listener and the real `ServerMode` with a fake
// account service and host, then signs the server in with Chrome, as a user does, and checks the
// refusals that keep other programs on the network of the container out. The page is the
// `server-setup` entry of the renderer build, so build the renderer first (`bun run build`).
//
//   bun scripts/server-setup-page-e2e.ts [--renderer=<out/renderer>] [--browser-executable=<path>]
//
// Writes .openbot-build/server-setup-page-e2e/report.json and the screenshots beside it.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CentralAuthState, HostStatus } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { chromium, type Page } from "playwright-core";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { ServerMode, type ServerModeOptions } from "../src/main/server-mode";
import { ServerSetupPage } from "../src/main/server-setup-page";

const logger = createOpenBotLogger("server-setup-page-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/server-setup-page-e2e");
const browserExecutable = process.argv.find((value) => value.startsWith("--browser-executable="))?.split("=")[1];
const rendererRoot = resolve(
  process.argv.find((value) => value.startsWith("--renderer="))?.split("=")[1] ?? join(ROOT, "out/renderer"),
);
if (!existsSync(join(rendererRoot, "server-setup.html"))) {
  throw new Error(`${rendererRoot} has no server-setup.html. Build the renderer first: bun run build.`);
}

const EMAIL = "owner@example.com";
const CODE = "K7PQ-R2MX";
const WRONG_CODE = "22222222";
const CHALLENGE = "challenge-e2e";
/** No name comes from the page. The owner renames the server in Server Settings of the app. */
const SERVER_NAME = "OpenBot";

// The fake account service. It accepts one code, as the account service does.
let account: CentralAuthState = { status: "signed_out" };
/** The stored session. It stays when the account service cannot confirm it, as in the real manager. */
let session = false;
const sentCodes: string[] = [];
/** Each code that reached the account service. A refused request must not reach it. */
const verifiedCodes: string[] = [];
const centralAuth: ServerModeOptions["centralAuth"] = {
  getState: () => structuredClone(account),
  requestEmailCode: (email: string) =>
    Effect.sync(() => {
      sentCodes.push(email);
      account = {
        status: "code_sent",
        challengeId: CHALLENGE,
        email,
        expiresAt: Date.now() + 600_000,
        resendAvailableAt: Date.now() + 30_000,
      };
      return structuredClone(account);
    }),
  verifyEmailCode: (challengeId: string, code: string) =>
    Effect.sync(() => {
      verifiedCodes.push(code);
      if (account.status !== "code_sent") return structuredClone(account);
      if (challengeId !== CHALLENGE || code !== CODE) {
        account = { ...account, issue: { code: "invalid_sign_in_code", message: "The code is not valid." } };
        return structuredClone(account);
      }
      account = { status: "signed_in", user: { id: "user-e2e", email: account.email, name: null, avatarUrl: null } };
      session = true;
      // The entry point publishes the host when the account changes.
      setTimeout(() => void runCauseEffect(serverMode.publish()), 0);
      return structuredClone(account);
    }),
  hasSession: () => session,
  // The account service answers again: a stored session is confirmed.
  retry: () =>
    Effect.sync(() => {
      if (account.status === "error" && session) {
        account = { status: "signed_in", user: { id: "user-e2e", email: EMAIL, name: null, avatarUrl: null } };
      } else if (account.status === "error") {
        account = { status: "signed_out" };
      }
      return structuredClone(account);
    }),
  cancelCompanySignIn: () => Effect.sync(() => structuredClone(account)),
  canPersistSession: () => true,
  redeemServerClaim: () => Effect.succeed(null),
  logout: () =>
    Effect.sync(() => {
      account = { status: "signed_out" };
      session = false;
      return structuredClone(account);
    }),
  createMobileConnect: () => Effect.die(new Error("The setup page must not make a Mobile Connect code.")),
};

// The fake host. It is online about a second after its start, as a real publish takes time.
let hostStatus: HostStatus = {
  phase: "idle",
  configured: false,
  enabledOnLaunch: false,
  serverId: null,
  serverName: null,
  apiUrl: null,
  logoUrl: null,
  appearance: null,
  apiOnline: false,
  remoteDesktopReady: false,
  remoteDesktopScreenRecordingDenied: false,
  remoteDesktopUnattended: false,
  remoteDesktopActiveSessions: 0,
  remoteDesktopMaxSessions: 0,
  message: null,
};
const host: ServerModeOptions["host"] = {
  getStatus: () => structuredClone(hostStatus),
  configure: (input) =>
    Effect.sync(() => {
      hostStatus = { ...hostStatus, configured: true, serverName: input.serverName, serverId: "server-e2e" };
      return structuredClone(hostStatus);
    }),
  updateIdentity: (input) =>
    Effect.sync(() => {
      hostStatus = { ...hostStatus, serverName: input.serverName ?? hostStatus.serverName };
      return structuredClone(hostStatus);
    }),
  start: () =>
    Effect.sync(() => {
      hostStatus = { ...hostStatus, phase: "starting" };
      setTimeout(() => {
        hostStatus = { ...hostStatus, phase: "online", apiOnline: true };
      }, 1000);
      return structuredClone(hostStatus);
    }),
  getMobileConnectHost: () => null,
};

const runtime = await mkdtemp(join(tmpdir(), "openbot-setup-page-"));
const serverMode = new ServerMode({
  environment: { controlSocketPath: join(runtime, "control.sock"), setupPagePort: null },
  version: "0.0.0-e2e",
  centralAuth,
  host,
  memory: null,
  onError: (message, error) => logger.warn(message, error),
});
const port = await freePort();
const page = new ServerSetupPage({
  port,
  address: "127.0.0.1",
  rendererRoot,
  request: serverMode.setupRequest,
  onError: (message, error) => logger.warn(message, error),
});
await runCauseEffect(page.listen());
const origin = `http://127.0.0.1:${port}`;

interface Checks {
  page?: { status: number; policy: string };
  refusals?: Record<
    "noHeader" | "crossSite" | "textPlainPost" | "logout" | "claim" | "mobileConnect" | "pathEscape" | "sourceFile",
    number
  >;
  signIn?: {
    email: string;
    serverName: string | null;
    phase: HostStatus["phase"];
    appLink: string | null;
    language: string;
  };
  signedInRefusesSignIn?: number;
  oldChallengeRefused?: number;
  signedInRefusesCode?: number;
  unconfirmedSessionRefuses?: { start: number; verify: number; retry: string | number | undefined };
}
const checks: Checks = {};
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

try {
  // The page and its content security policy.
  const pageResponse = await fetch(`${origin}/`);
  assert.equal(pageResponse.status, 200);
  const policy = pageResponse.headers.get("content-security-policy") ?? "";
  assert.match(policy, /default-src 'none'/u);
  assert.match(policy, /script-src 'self'(;|$)/u);
  assert.match(policy, /form-action 'none'/u);
  checks.page = { status: pageResponse.status, policy };

  // Refusals: no setup header, a request of another site, a form post, and a request the page does not have.
  const refusals = {
    noHeader: (await fetch(`${origin}/api/status`)).status,
    crossSite: (
      await fetch(`${origin}/api/status`, { headers: { "x-openbot-setup": "1", "sec-fetch-site": "cross-site" } })
    ).status,
    textPlainPost: (
      await fetch(`${origin}/api/login/start`, {
        method: "POST",
        headers: { "x-openbot-setup": "1", "content-type": "text/plain" },
        body: `email=${EMAIL}`,
      })
    ).status,
    logout: (await fetch(`${origin}/api/logout`, { method: "POST", headers: { "x-openbot-setup": "1" } })).status,
    claim: (await fetch(`${origin}/api/login/claim`, { method: "POST", headers: { "x-openbot-setup": "1" } })).status,
    mobileConnect: (
      await fetch(`${origin}/api/mobile-connect`, { method: "POST", headers: { "x-openbot-setup": "1" } })
    ).status,
    // Only the page and the files in assets/: no other file of the build, no path out of it.
    pathEscape: (await fetch(`${origin}/assets/..%2F..%2Fpackage.json`)).status,
    sourceFile: (await fetch(`${origin}/index.html`)).status,
  };
  assert.deepEqual(refusals, {
    noHeader: 403,
    crossSite: 403,
    textPlainPost: 403,
    logout: 404,
    claim: 404,
    mobileConnect: 404,
    pathEscape: 404,
    sourceFile: 404,
  });
  assert.equal(sentCodes.length, 0, "A refused request sent a sign-in code.");
  checks.refusals = refusals;

  // The sign-in in Chrome: email, a wrong code, the right code, then the server is online.
  const browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  try {
    const context = await browser.newContext({ locale: "en-US", viewport: { width: 1000, height: 760 } });
    const tab = await context.newPage();
    const pageErrors: string[] = [];
    tab.on("pageerror", (error) => pageErrors.push(error.message));
    // The wrong code gets a 400 answer, which Chrome logs as a resource that did not load. That is expected.
    tab.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
        pageErrors.push(message.text());
      }
    });
    await tab.goto(`${origin}/`);
    await tab.getByRole("heading", { name: "Sign in to OpenBot" }).waitFor();
    await tab.getByLabel("Email").fill(EMAIL);
    await settledScreenshot(tab, join(OUT, "1-email.png"));
    await tab.getByRole("button", { name: "Send sign-in code" }).click();
    await tab.getByRole("heading", { name: "Check your inbox" }).waitFor();
    assert.deepEqual(sentCodes, [EMAIL]);

    // Another program cannot complete a challenge that is not the current one.
    const oldChallenge = await postForm("/api/login/verify", { challenge: "old-challenge", code: CODE });
    assert.equal(oldChallenge.status, 409);
    assert.deepEqual(await oldChallenge.json(), {
      error: "challenge_replaced",
      message: "The sign-in code could not be verified.",
    });
    assert.deepEqual(verifiedCodes, []);
    checks.oldChallengeRefused = oldChallenge.status;

    // The code input sends the code when it is full, as in the app.
    const codeInput = tab.getByLabel("One-time code", { exact: true });
    await codeInput.fill(WRONG_CODE);
    await tab.getByText("The code is not valid.").waitFor();
    await settledScreenshot(tab, join(OUT, "2-wrong-code.png"));

    await codeInput.fill(CODE.replace("-", ""));
    await tab.getByRole("heading", { name: `${SERVER_NAME} is online` }).waitFor({ timeout: 30_000 });
    await tab.getByText(`Signed in as ${EMAIL}`).waitFor();
    const appLink = await tab.getByRole("link", { name: "Open OpenBot" }).getAttribute("href");
    assert.equal(appLink, "https://openbot.run/app");
    await settledScreenshot(tab, join(OUT, "3-online.png"));
    assert.equal(hostStatus.serverName, SERVER_NAME);

    // A reload of a signed-in server shows the status, not a sign-in form.
    await tab.reload();
    await tab.getByRole("heading", { name: `${SERVER_NAME} is online` }).waitFor();
    assert.equal(await tab.getByLabel("Email").count(), 0);

    // Dark mode and a phone width.
    const dark = await browser.newContext({ colorScheme: "dark", viewport: { width: 390, height: 760 } });
    const phone = await dark.newPage();
    await phone.goto(`${origin}/`);
    await phone.getByRole("heading", { name: `${SERVER_NAME} is online` }).waitFor();
    await settledScreenshot(phone, join(OUT, "4-online-dark-phone.png"));
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, "The page scrolls sideways at phone width.");
    await dark.close();

    // The page in Polish takes its text from the catalog.
    const polish = await browser.newContext({ locale: "pl-PL" });
    const polishTab = await polish.newPage();
    await polishTab.goto(`${origin}/`);
    await polishTab.getByRole("heading", { name: `${SERVER_NAME} is online` }).waitFor();
    const language = await polishTab.evaluate(() => document.documentElement.lang);
    assert.equal(language, "pl");
    await polish.close();

    assert.deepEqual(pageErrors, [], "The page wrote errors.");
    checks.signIn = { email: EMAIL, serverName: hostStatus.serverName, phase: hostStatus.phase, appLink, language };
  } finally {
    await browser.close();
  }

  // A signed-in server refuses a new sign-in, and a code: another account or a wrong code would
  // replace or remove the session.
  const codesBefore = [...verifiedCodes];
  const again = await postForm("/api/login/start", { email: "other@example.com" });
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: "signed_in" });
  assert.deepEqual(sentCodes, [EMAIL]);
  checks.signedInRefusesSignIn = again.status;
  const code = await postForm("/api/login/verify", { challenge: "other-challenge", code: WRONG_CODE });
  assert.equal(code.status, 409);
  assert.deepEqual(await code.json(), { error: "signed_in" });
  assert.deepEqual(verifiedCodes, codesBefore);
  assert.equal(account.status, "signed_in");
  checks.signedInRefusesCode = code.status;

  // The account service did not confirm the stored session at the start. The session is still the
  // owner's: no sign-in and no code, only the retry, which confirms it.
  const signedIn = account;
  account = { status: "error", issue: { code: "auth_api_unavailable", message: "The account service is down." } };
  const unconfirmedStart = await postForm("/api/login/start", { email: "other@example.com" });
  assert.deepEqual(await unconfirmedStart.json(), { error: "account_error" });
  const unconfirmedVerify = await postForm("/api/login/verify", { challenge: CHALLENGE, code: CODE });
  assert.deepEqual(await unconfirmedVerify.json(), { error: "account_error" });
  assert.deepEqual(sentCodes, [EMAIL]);
  assert.deepEqual(verifiedCodes, codesBefore);
  assert.equal(session, true);
  const retried = await postForm("/api/retry", {});
  const retriedValues = await retried.json();
  assert.equal(retriedValues.account, "signed_in");
  assert.deepEqual(account, signedIn);
  checks.unconfirmedSessionRefuses = {
    start: unconfirmedStart.status,
    verify: unconfirmedVerify.status,
    retry: retriedValues.account,
  };

  const report = {
    ok: true,
    checks,
    screenshots: ["1-email.png", "2-wrong-code.png", "3-online.png", "4-online-dark-phone.png"],
  };
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  logger.info(`Setup page e2e passed. Report: ${join(OUT, "report.json")}`);
} catch (error) {
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ ok: false, checks, error: String(error) }, null, 2)}\n`);
  throw error;
} finally {
  await runCauseEffect(page.close());
  rmSync(runtime, { recursive: true, force: true });
}

/** A form post of the page script. */
function postForm(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "x-openbot-setup": "1", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** A screenshot after the step transitions end. A loop, such as the spinner, does not end, so it is not waited for. */
async function settledScreenshot(page: Page, path: string): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Number.POSITIVE_INFINITY),
        )
        .map((animation) => animation.finished),
    ),
  );
  await page.screenshot({ path });
}

/** A free port on the loopback address. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address ? resolvePort(address.port) : reject(new Error("No port.")),
      );
    });
  });
}
