import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText, registerSecretValue } from "@openbot/logging";
import { Effect, Fiber } from "effect";
import { cliSpawnTarget } from "./cli";
import { type ProviderClientOperationError, ProviderSignInError, providerFailure } from "./provider-client-effects";
import { type ProviderTempOptions, spawnWithProviderTemp } from "./provider-temp";
import { stopProcessTree } from "./windows-process-tree";

/** The messages this client sends: its requests, and a refusal for each request the server makes. */
type AcpMessage =
  | { id: number; method: "initialize" | "logout" | "authenticate"; params: DynamicRecord }
  | { id: unknown; error: { code: number; message: string } };

/** The most characters of the server's own reason that a failed sign-in shows. */
const SERVER_REASON_LIMIT = 200;

/** The server's reason for a refused call, redacted and short, or `null` when it gave none. */
function serverReason(error: unknown): string | null {
  if (!isDynamicRecord(error)) return null;
  const details = isDynamicRecord(error.data) ? error.data.details : undefined;
  const text = typeof details === "string" ? details : error.message;
  if (typeof text !== "string") return null;
  const reason = redactText(text.trim().replace(/\s+/gu, " "));
  if (!reason) return null;
  const characters = Array.from(reason);
  return characters.length > SERVER_REASON_LIMIT ? `${characters.slice(0, SERVER_REASON_LIMIT - 1).join("")}…` : reason;
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
 *
 * `done` settles when the call answers, and the process is stopped then. It rejects when the call
 * fails, the process ends first, or `timeoutMs` passes.
 */
export const startAcpAuthentication = Effect.fnUntraced(function* (options: {
  executable: string;
  argv: readonly string[];
  env: Record<string, string>;
  methodId: string;
  timeoutMs: number;
  /** Signs the server out before `authenticate`, when it advertises ACP `logout`. */
  logout?: boolean;
  /** Called when the server answered `logout`: what it kept is gone, whether the sign-in ends or not. */
  onLoggedOut?: () => void;
  /**
   * Gemini prints its Google page instead of opening it, and OpenBot opens it, so a launch that fails
   * shows an error. When the server opened it itself, a failure showed nothing (#3520).
   */
  openGoogleSignIn?: (url: string) => Promise<void>;
  /** A temporary folder of its own for the process (`provider-temp.ts`). */
  privateTemp?: ProviderTempOptions | undefined;
}) {
  // Cursor's Windows launcher is a `.cmd` file, which starts only through `cmd.exe`.
  const target = cliSpawnTarget(options.executable, options.argv);
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        spawnWithProviderTemp(options.privateTemp, (tempEnv) =>
          spawn(target.command, target.args, {
            cwd: process.cwd(),
            env: {
              ...process.env,
              ...options.env,
              ...(options.openGoogleSignIn ? { BROWSER: "true" } : {}),
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
  if (!options.openGoogleSignIn) child.stderr.resume();
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
      let output = "";
      let opened = false;
      const signInFailed = (message: string) => fail(new ProviderSignInError({ message }));
      const browserFailed = () =>
        signInFailed(
          sourceText(
            process.platform === "linux"
              ? "error.provider.geminiBrowserUnavailable"
              : "error.provider.geminiBrowserOpenFailed",
          ),
        );
      const readSignInLink = (chunk: Buffer) => {
        if (settled || opened || !openGoogleSignIn) return;
        output += chunk.toString("utf8");
        // Sign-in output contains OAuth state. Keep it bounded and never log it.
        if (output.length > 64 * 1024) return browserFailed();
        const match = /^Open the following link to authenticate the ACP server: (\S+)\r?\n/mu.exec(output);
        if (!match?.[1]) return;
        const url = URL.parse(match[1]);
        if (
          url?.origin !== "https://accounts.google.com" ||
          url.pathname !== "/o/oauth2/v2/auth" ||
          url.username ||
          url.password
        )
          return browserFailed();
        opened = true;
        output = "";
        registerSecretValue(url.toString());
        void Promise.resolve()
          .then(() => {
            if (!settled) return openGoogleSignIn(url.toString());
          })
          .catch(browserFailed);
      };
      child.stderr?.on("data", readSignInLink);
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
            Array.isArray(methods) &&
            !methods.some((method) => isDynamicRecord(method) && method.id === options.methodId)
          )
            return signInFailed(sourceText("error.provider.acpSignInMethodMissing"));
          // A client must not call `logout` unless the server advertises it.
          const capabilities = isDynamicRecord(result?.agentCapabilities) ? result.agentCapabilities : undefined;
          const auth = isDynamicRecord(capabilities?.auth) ? capabilities.auth : undefined;
          if (options.logout && isDynamicRecord(auth?.logout)) send({ id: 3, method: "logout", params: {} });
          else send({ id: 2, method: "authenticate", params: { methodId: options.methodId } });
        } else if (message.id === 3) {
          options.onLoggedOut?.();
          send({ id: 2, method: "authenticate", params: { methodId: options.methodId } });
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
        settled = true;
        output = "";
        child.stderr?.removeListener("data", readSignInLink);
        lines.close();
        child.removeListener("exit", exited);
        child.stdin.end();
      });
    }).pipe(Effect.ensuring(stopProcessTree(child).pipe(Effect.orDie))),
    { startImmediately: true },
  );
  return { child, done: Fiber.join(done) };
});
