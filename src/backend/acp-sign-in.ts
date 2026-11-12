import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Fiber } from "effect";
import { cliSpawnTarget } from "./cli";
import {
  type ProviderClientOperationError,
  ProviderSignInError,
  providerFailure,
  signInReason,
} from "./provider-client-effects";
import { type ProviderTempOptions, spawnWithProviderTemp } from "./provider-temp";
import { stopProcessTree } from "./windows-process-tree";

/** The messages this client sends: its requests, and a refusal for each request the server makes. */
type AcpMessage =
  | { id: number; method: "initialize" | "logout" | "authenticate" | AcpExtensionMethod; params: DynamicRecord }
  | { id: unknown; error: { code: number; message: string } };

/** A method of the agent's own, outside ACP. Its name starts with `_`. */
export type AcpExtensionMethod = `_${string}`;

/** The server's reason for a refused call, redacted and short, or `null` when it gave none. */
function serverReason(error: unknown): string | null {
  if (!isDynamicRecord(error)) return null;
  const details = isDynamicRecord(error.data) ? error.data.details : undefined;
  const text = typeof details === "string" ? details : error.message;
  return typeof text === "string" ? signInReason(text) : null;
}

/**
 * The command line of an ACP server, or a function that makes it from the environment of the process.
 * Antigravity takes its state folder as a flag, not from the environment.
 */
export type AcpArgv = readonly string[] | ((env: Readonly<Record<string, string | undefined>>) => readonly string[]);

/** The command line of an ACP server for the environment `env`. */
function acpArgv(argv: AcpArgv, env: Readonly<Record<string, string | undefined>>): readonly string[] {
  return typeof argv === "function" ? argv(env) : argv;
}

/**
 * Whether OpenBot, not the Gemini server, opens the Google sign-in page (`openGoogleSignIn`).
 *
 * The server opens the page with the `open` or `xdg-open` command that it finds on `PATH`, and OpenBot
 * puts its own command first. On Windows, the server starts `rundll32` with the page as an argument,
 * by its absolute path, so a sign-in at this computer lets the server open the page itself.
 * `onHost`: the user is at another device, and the page must not open here. On Windows that
 * sign-in is refused (`startAcpAuthentication`).
 */
export function googleSignInByOpenBot(onHost: boolean): boolean {
  return onHost || process.platform !== "win32";
}

/**
 * A sign-in that is an ACP `authenticate` call, for a server that has no login command.
 *
 * The call runs in a process of its own, not in the client that serves turns: the server opens the
 * browser and waits there until the user finishes, and a status probe must never wait on that. The
 * server keeps what it signed in with, so the next process it starts is signed in already.
 *
 * With `logout`, a server that advertises ACP `logout` first removes what it kept. Its `authenticate`
 * then opens the browser, so a Reconnect is a new sign-in, not a check of the saved one.
 * With `logoutOnly`, the call is a sign-out only.
 *
 * `done` settles when the call answers, and the process is stopped then. It rejects when the call
 * fails, the process ends first, or `timeoutMs` passes.
 */
export const startAcpAuthentication = Effect.fnUntraced(function* (options: {
  executable: string;
  argv: AcpArgv;
  env: Record<string, string>;
  /** The sign-in method. A `logoutOnly` call sends no `authenticate`, and ignores it. */
  methodId: string;
  timeoutMs: number;
  /** Signs the server out before `authenticate`, when it advertises ACP `logout`. */
  logout?: boolean;
  /** Called when the server answered `logout`: what it kept is gone, whether the sign-in ends or not. */
  onLoggedOut?: () => void;
  /**
   * A sign-out, for a CLI that has no sign-out command: `done` settles when the server answers
   * `logout`, with no `authenticate` after it. It rejects when the server does not advertise `logout`.
   */
  logoutOnly?: boolean;
  /**
   * With `logoutOnly`, the agent's own sign-out method, which it does not advertise, in place of ACP
   * `logout`.
   */
  signOutMethod?: AcpExtensionMethod | undefined;
  /**
   * Gemini gives its Google page to OpenBot's `open` command instead of a browser, and OpenBot opens
   * it, so a launch that fails shows an error. When the server opened it itself, a failure showed
   * nothing (#3520). Without it, the server opens the page itself (`googleSignInByOpenBot`). On
   * Windows the call fails at once: the server opens the page here, and OpenBot cannot catch it.
   */
  openGoogleSignIn?: (url: string) => Promise<void>;
  /** A temporary folder of its own for the process (`provider-temp.ts`). */
  privateTemp?: ProviderTempOptions | undefined;
}) {
  // A Windows CLI opens the page on this computer, so a user at another device cannot sign in. The
  // refusal comes before the process starts, so a Reconnect does not sign the account out first.
  if (options.openGoogleSignIn && process.platform === "win32")
    return yield* providerFailure(
      new ProviderSignInError({ message: sourceText("error.provider.antigravityRemoteWindowsSignIn") }),
    );
  const env = { ...process.env, ...options.env };
  const opener = options.openGoogleSignIn
    ? yield* Effect.acquireRelease(
        Effect.tryPromise({ try: () => makeOpenerFolder(), catch: providerFailure }),
        (folder) => Effect.promise(() => rm(folder, { recursive: true, force: true })),
      )
    : null;
  // Cursor's Windows launcher is a `.cmd` file, which starts only through `cmd.exe`.
  const target = cliSpawnTarget(options.executable, acpArgv(options.argv, env));
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        spawnWithProviderTemp(options.privateTemp, (tempEnv) =>
          spawn(target.command, target.args, {
            cwd: process.cwd(),
            env: {
              ...env,
              ...(opener ? { PATH: [opener, env.PATH].filter(Boolean).join(delimiter) } : {}),
              ...tempEnv,
            },
            windowsVerbatimArguments: target.windowsVerbatimArguments,
            // Only Gemini delegates the browser launch. Other servers still open it themselves.
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
            windowsHide: process.platform === "win32",
          }),
        ),
      catch: providerFailure,
    }),
    (child) => stopProcessTree(child).pipe(Effect.orDie),
  );
  child.stderr.resume();
  const done = yield* Effect.forkScoped(
    Effect.callback<void, ProviderClientOperationError>((resume) => {
      let settled = false;
      const settle = (error: Error | null) => {
        if (settled) return;
        settled = true;
        resume(error ? Effect.fail(providerFailure(error)) : Effect.void);
      };
      const fail = (error: Error) => settle(error);
      const openGoogleSignIn = options.openGoogleSignIn;
      let opened = false;
      // A failed sign-out says so, whatever stopped it.
      const signInFailed = (message: string) =>
        fail(
          new ProviderSignInError({
            message: options.logoutOnly ? sourceText("error.provider.acpSignOutFailed") : message,
          }),
        );
      const browserFailed = () =>
        signInFailed(
          sourceText(
            process.platform === "linux"
              ? "error.provider.geminiBrowserUnavailable"
              : "error.provider.geminiBrowserOpenFailed",
          ),
        );
      // The page holds the sign-in's OAuth state. It is registered as a secret and never logged.
      const readSignInPage = () => {
        if (settled || opened || !opener || !openGoogleSignIn) return;
        void readFile(join(opener, OPENER_PAGE), "utf8").then(
          (text) => {
            // A line with no end is still being written.
            const end = text.indexOf("\n");
            if (settled || opened || end < 0) return;
            const url = URL.parse(text.slice(0, end).trim());
            if (
              url?.origin !== "https://accounts.google.com" ||
              !GOOGLE_SIGN_IN_PATHS.has(url.pathname) ||
              url.username ||
              url.password
            )
              return browserFailed();
            opened = true;
            registerSecretValue(url.toString());
            void Promise.resolve()
              .then(() => {
                if (!settled) return openGoogleSignIn(url.toString());
              })
              .catch(browserFailed);
          },
          () => undefined,
        );
      };
      const poll = opener ? setInterval(readSignInPage, OPENER_POLL_MS) : undefined;
      poll?.unref?.();
      const timer = setTimeout(() => signInFailed(sourceText("error.provider.acpSignInTimedOut")), options.timeoutMs);
      timer.unref?.();
      const send = (message: AcpMessage) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
      child.once("error", fail);
      const exited = () => signInFailed(sourceText("error.provider.acpSignInStopped"));
      child.once("exit", exited);
      child.stdin.on("error", () => undefined);
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (!isDynamicRecord(message)) return;
        // A request from the server gets a refusal, so it does not wait on a client that has no answer.
        if (typeof message.method === "string" && message.id !== undefined) {
          send({ id: message.id, error: { code: -32601, message: "Method not found" } });
          return;
        }
        if (message.error !== undefined && (message.id === 1 || message.id === 2 || message.id === 3)) {
          const reason = serverReason(message.error);
          // A refused sign-out keeps the server's reason, such as a token that the CLI did not save.
          if (options.logoutOnly && reason)
            return fail(
              new ProviderSignInError({ message: sourceText("error.provider.acpSignOutFailedReason", { reason }) }),
            );
          signInFailed(
            reason
              ? sourceText("error.provider.acpSignInFailedReason", { reason })
              : sourceText("error.provider.acpSignInFailed"),
          );
        } else if (message.id === 1) {
          // A server without the method would refuse it with a reason that the user cannot act on.
          const result = isDynamicRecord(message.result) ? message.result : undefined;
          const methods = result?.authMethods;
          if (
            !options.logoutOnly &&
            Array.isArray(methods) &&
            !methods.some((method) => isDynamicRecord(method) && method.id === options.methodId)
          )
            return signInFailed(sourceText("error.provider.acpSignInMethodMissing"));
          // A client must not call `logout` unless the server advertises it.
          const capabilities = isDynamicRecord(result?.agentCapabilities) ? result.agentCapabilities : undefined;
          const auth = isDynamicRecord(capabilities?.auth) ? capabilities.auth : undefined;
          const canLogOut = isDynamicRecord(auth?.logout);
          if (options.logoutOnly && options.signOutMethod) send({ id: 3, method: options.signOutMethod, params: {} });
          else if (options.logoutOnly && !canLogOut) signInFailed(sourceText("error.provider.acpSignOutFailed"));
          else if ((options.logout || options.logoutOnly) && canLogOut) send({ id: 3, method: "logout", params: {} });
          else send({ id: 2, method: "authenticate", params: { methodId: options.methodId } });
        } else if (message.id === 3) {
          options.onLoggedOut?.();
          if (options.logoutOnly) settle(null);
          else send({ id: 2, method: "authenticate", params: { methodId: options.methodId } });
        } else if (message.id === 2) {
          settle(null);
        }
      });
      send({
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
        },
      });
      return Effect.sync(() => {
        clearTimeout(timer);
        clearInterval(poll);
        settled = true;
        lines.close();
        child.removeListener("exit", exited);
        child.stdin.end();
      });
    }).pipe(Effect.ensuring(stopProcessTree(child).pipe(Effect.orDie))),
    { startImmediately: true },
  );
  return { child, done: Fiber.join(done) };
});

/** How often the page file is read while the server has not opened its page. */
const OPENER_POLL_MS = 250;

/** The file that OpenBot's `open` command writes the page to. */
const OPENER_PAGE = "page";

/** The Google sign-in pages that Antigravity opens: 1.5 uses the first, 1.4 the second. */
const GOOGLE_SIGN_IN_PATHS = new Set(["/o/oauth2/auth", "/o/oauth2/v2/auth"]);

/**
 * A private folder with an `open` (macOS) and an `xdg-open` (Linux) command that write their first
 * argument to the file `page` there, in place of a browser.
 */
async function makeOpenerFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "openbot-sign-in-"));
  const page = join(folder, OPENER_PAGE).replaceAll("'", `'\\''`);
  const script = `#!/bin/sh\nprintf '%s\\n' "$1" >> '${page}'\n`;
  for (const name of ["open", "xdg-open"]) await writeFile(join(folder, name), script, { mode: 0o700 });
  return folder;
}
