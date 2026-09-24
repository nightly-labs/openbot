// The app shows the workspace only to a signed-in account, and the account
// service is the Auth API. A bench against a missing API measures the
// "Connecting to OpenBot" screen, so `dev:bench` signs its profile in to the
// local development API: this worktree's running `dev:api`, or one the bench
// starts and stops itself.
//
// Sign-in uses the development code that the local API returns in place of an
// email. An API that does not expose it is not a development API, and the bench
// stops rather than send a real email.

import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { withoutElectronRuntimeFlags } from "../electron-spawn-env";
import { isSameWorktree, readDevStackRecords } from "./stack-registry";

const API_READY_TIMEOUT_MS = 180_000;
const API_STOP_TIMEOUT_MS = 20_000;
// A reserved domain: nothing is ever delivered to it.
export const BENCH_ACCOUNT_EMAIL = "openbot-bench@example.com";

export interface BenchAuthApi {
  url: string;
  stop: () => Promise<void>;
}

const wait = (milliseconds: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

async function isLive(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function worktreeApiPort(projectRoot: string, supervisorPid?: number): number | null {
  for (const record of readDevStackRecords()) {
    if (!isSameWorktree(record, projectRoot) || !record.services.includes("api")) continue;
    if (supervisorPid !== undefined && record.supervisorPid !== supervisorPid) continue;
    const port = record.ports.find((entry) => entry.name === "api")?.port;
    if (port !== undefined) return port;
  }
  return null;
}

function stopStarted(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      // Only the supervisor this run started, and its group, which holds the
      // Vite server it spawned.
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      resolveStop();
    }, API_STOP_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}

export async function ensureBenchAuthApi(
  projectRoot: string,
  logDirectory: string,
  logger: Logger,
): Promise<BenchAuthApi> {
  const running = worktreeApiPort(projectRoot);
  if (running !== null && (await isLive(running))) {
    logger.info(`using this worktree's Auth API on :${running}`);
    return { url: `http://127.0.0.1:${running}`, stop: async () => undefined };
  }
  await mkdir(logDirectory, { recursive: true });
  const logPath = join(logDirectory, "auth-api.log");
  const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
  logger.info(`starting the Auth API (log: ${logPath})`);
  const child = spawn("bun", ["scripts/dev-services.ts", "api"], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: withoutElectronRuntimeFlags(process.env),
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const supervisorPid = child.pid;
  if (supervisorPid === undefined) throw new Error("The Auth API supervisor did not start.");
  const deadline = Date.now() + API_READY_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`The Auth API stopped during startup. See ${logPath}.`);
    const port = worktreeApiPort(projectRoot, supervisorPid);
    if (port !== null && (await isLive(port))) {
      logger.info(`Auth API ready on :${port}`);
      return { url: `http://127.0.0.1:${port}`, stop: () => stopStarted(child) };
    }
    if (Date.now() > deadline) {
      await stopStarted(child);
      throw new Error(`The Auth API did not become ready in ${API_READY_TIMEOUT_MS} ms. See ${logPath}.`);
    }
    await wait(500);
  }
}

interface SignInResult {
  status: string;
  issue: string | null;
  signedInNow: boolean;
}

// Runs in the app window, through the same preload API as the sign-in screen.
const SIGN_IN_EXPRESSION = `(async () => {
  const auth = window.openbot.auth;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let state = await auth.getState();
  for (let tries = 0; tries < 240 && (state.status === "loading" || state.status === "signing_in"); tries += 1) {
    await pause(250);
    state = await auth.getState();
  }
  if (state.status === "error") state = await auth.retry();
  if (state.status === "signed_in") return { status: "signed_in", issue: null, signedInNow: false };
  let challenge = await auth.requestEmailCode(${JSON.stringify(BENCH_ACCOUNT_EMAIL)});
  const retryAfter = challenge.status === "error" ? challenge.issue.retryAfterSeconds : undefined;
  if (retryAfter !== undefined && retryAfter > 0 && retryAfter <= 60) {
    await pause(retryAfter * 1000);
    challenge = await auth.requestEmailCode(${JSON.stringify(BENCH_ACCOUNT_EMAIL)});
  }
  if (challenge.status !== "code_sent" || !challenge.developmentCode) {
    return { status: challenge.status, issue: challenge.issue?.message ?? "no development code", signedInNow: false };
  }
  const verified = await auth.verifyEmailCode(challenge.challengeId, challenge.developmentCode);
  return { status: verified.status, issue: verified.issue?.message ?? null, signedInNow: true };
})()`;

export async function signInBenchAccount(page: Page, logger: Logger): Promise<void> {
  const result = await page.evaluate<SignInResult>(SIGN_IN_EXPRESSION);
  if (result.status !== "signed_in") {
    throw new Error(`The bench account could not sign in (${result.status}): ${result.issue ?? "no detail"}.`);
  }
  if (result.signedInNow) logger.info(`signed in as ${BENCH_ACCOUNT_EMAIL}`);
}
