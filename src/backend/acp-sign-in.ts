import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
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

const logger = createOpenBotLogger("acp-sign-in");

type AcpMessage =
  | { id: number; method: "initialize" | "logout" | "authenticate" | AcpExtensionMethod; params: DynamicRecord }
  | { id: unknown; error: { code: number; message: string } };

export type AcpExtensionMethod = `_${string}`;

function serverText(error: unknown): string | null {
  if (!isDynamicRecord(error)) return null;
  const details = isDynamicRecord(error.data) ? error.data.details : undefined;
  const text = typeof details === "string" ? details : error.message;
  return typeof text === "string" ? text : null;
}

const AGY_NO_BROWSER = "No browser is available here";

const NETWORK_FAILURE_TEXT =
  /\blookup [\w-]+(?:\.[\w-]+)+\.? on \S+: |\bdial (?:tcp|udp)[46]?\b|\bconnect: (?:connection refused|connection timed out|network is unreachable|no route to host)\b|\bi\/o timeout\b|\bno such host\b|\bserver misbehaving\b|\berror sending request for url\b|\bdns error\b|\btcp connect error\b|\bgetaddrinfo\b|\bfetch failed\b|\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)\b/iu;

export type AcpArgv = readonly string[] | ((env: Readonly<Record<string, string | undefined>>) => readonly string[]);

function acpArgv(argv: AcpArgv, env: Readonly<Record<string, string | undefined>>): readonly string[] {
  return typeof argv === "function" ? argv(env) : argv;
}

export function googleSignInByOpenBot(onHost: boolean): boolean {
  return onHost || process.platform !== "win32";
}

export const startAcpAuthentication = Effect.fnUntraced(function* (options: {
  executable: string;
  argv: AcpArgv;
  env: Record<string, string>;
  methodId: string;
  timeoutMs: number;
  logout?: boolean;
  onLoggedOut?: () => void;
  logoutOnly?: boolean;
  signOutMethod?: AcpExtensionMethod | undefined;
  openSignInPage?: { site: SignInPageSite; open: (url: string) => Promise<void> };
  privateTemp?: ProviderTempOptions | undefined;
  onSignInUrl?: (url: string) => void;
}) {
  if (options.openSignInPage?.site === "google" && process.platform === "win32")
    return yield* providerFailure(
      new ProviderSignInError({ message: sourceText("error.provider.antigravityRemoteWindowsSignIn") }),
    );
  const env = { ...process.env, ...options.env };
  const opener = options.openSignInPage
    ? yield* Effect.acquireRelease(
        Effect.tryPromise({ try: () => makeOpenerFolder(), catch: providerFailure }),
        (folder) => Effect.promise(() => rm(folder, { recursive: true, force: true })),
      )
    : null;
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
      const signInPage = options.openSignInPage;
      let opened = false;
      const signInFailed = (message: string) =>
        fail(
          new ProviderSignInError({
            message: options.logoutOnly ? sourceText("error.provider.acpSignOutFailed") : message,
          }),
        );
      const browserFailed = () =>
        signInFailed(
          sourceText(
            signInPage?.site === "devin"
              ? "error.provider.acpSignInFailed"
              : process.platform === "linux"
                ? "error.provider.geminiBrowserUnavailable"
                : "error.provider.geminiBrowserOpenFailed",
          ),
        );
      const readSignInPage = () => {
        if (settled || opened || !opener || !signInPage) return;
        void readFile(join(opener, OPENER_PAGE), "utf8").then(
          (text) => {
            const end = text.indexOf("\n");
            if (settled || opened || end < 0) return;
            const url = URL.parse(text.slice(0, end).trim());
            if (!url || !SIGN_IN_PAGES[signInPage.site](url) || url.username || url.password) return browserFailed();
            opened = true;
            const page = SIGN_IN_PAGE_LINKS[signInPage.site](url);
            registerSecretValue(url.toString());
            registerSecretValue(page);
            void Promise.resolve()
              .then(() => {
                if (!settled) return signInPage.open(page);
              })
              .catch(browserFailed);
          },
          () => undefined,
        );
      };
      const poll = opener ? setInterval(readSignInPage, OPENER_POLL_MS) : undefined;
      poll?.unref?.();
      let started = false;
      const timer = setTimeout(
        () =>
          signInFailed(sourceText(started ? "error.provider.acpSignInTimedOut" : "error.provider.acpSignInNoStart")),
        options.timeoutMs,
      );
      timer.unref?.();
      const send = (message: AcpMessage) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
      const authenticate = () =>
        send({
          id: 2,
          method: "authenticate",
          params: { methodId: options.methodId, ...(options.onSignInUrl ? { _meta: { action: "start" } } : {}) },
        });
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
        if (typeof message.method === "string" && message.id !== undefined) {
          send({ id: message.id, error: { code: -32601, message: "Method not found" } });
          return;
        }
        if (message.error !== undefined && typeof message.id === "number" && message.id >= 1 && message.id <= 4) {
          const text = serverText(message.error);
          const reason = signInReason(text);
          if (options.logoutOnly && reason)
            return fail(
              new ProviderSignInError({ message: sourceText("error.provider.acpSignOutFailedReason", { reason }) }),
            );
          if (!options.logoutOnly && text?.includes(AGY_NO_BROWSER))
            return signInFailed(sourceText("error.provider.geminiNoBrowserUseCode"));
          if (!options.logoutOnly && text && NETWORK_FAILURE_TEXT.test(text)) {
            logger.warn("An ACP sign-in could not reach the provider's service.", { reason });
            return signInFailed(sourceText("error.provider.acpSignInNetwork"));
          }
          signInFailed(
            reason
              ? sourceText("error.provider.acpSignInFailedReason", { reason })
              : sourceText("error.provider.acpSignInFailed"),
          );
        } else if (message.id === 1) {
          started = true;
          const result = isDynamicRecord(message.result) ? message.result : undefined;
          const methods = result?.authMethods;
          if (
            !options.logoutOnly &&
            Array.isArray(methods) &&
            !methods.some((method) => isDynamicRecord(method) && method.id === options.methodId)
          )
            return signInFailed(sourceText("error.provider.acpSignInMethodMissing"));
          const capabilities = isDynamicRecord(result?.agentCapabilities) ? result.agentCapabilities : undefined;
          const auth = isDynamicRecord(capabilities?.auth) ? capabilities.auth : undefined;
          const canLogOut = isDynamicRecord(auth?.logout);
          if (options.logoutOnly && options.signOutMethod) send({ id: 3, method: options.signOutMethod, params: {} });
          else if (options.logoutOnly && !canLogOut) signInFailed(sourceText("error.provider.acpSignOutFailed"));
          else if ((options.logout || options.logoutOnly) && canLogOut) send({ id: 3, method: "logout", params: {} });
          else authenticate();
        } else if (message.id === 3) {
          options.onLoggedOut?.();
          if (options.logoutOnly) settle(null);
          else authenticate();
        } else if (message.id === 2 && options.onSignInUrl) {
          const attempt = delegatedResult(message.result, options.methodId);
          const page = typeof attempt?.signInUrl === "string" ? URL.parse(attempt.signInUrl) : null;
          if (page?.protocol !== "https:" || page.username || page.password || typeof attempt?.attemptId !== "string")
            return signInFailed(sourceText("error.provider.codeLoginNoLink"));
          registerSecretValue(page.toString());
          registerSecretValue(attempt.attemptId);
          options.onSignInUrl(page.toString());
          const params = { methodId: options.methodId, _meta: { action: "complete", attemptId: attempt.attemptId } };
          send({ id: 4, method: "authenticate", params });
        } else if (message.id === 4) {
          if (delegatedResult(message.result, options.methodId)?.status === "completed") settle(null);
          else signInFailed(sourceText("error.provider.acpSignInFailed"));
        } else if (message.id === 2) {
          settle(null);
        }
      });
      send({
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
            ...(options.onSignInUrl ? { _meta: { [options.methodId]: true } } : {}),
          },
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

function delegatedResult(result: unknown, methodId: string): DynamicRecord | undefined {
  const meta = isDynamicRecord(result) && isDynamicRecord(result._meta) ? result._meta[methodId] : undefined;
  return isDynamicRecord(meta) ? meta : undefined;
}

const OPENER_POLL_MS = 250;

const OPENER_PAGE = "page";

const GOOGLE_SIGN_IN_PATHS = new Set(["/o/oauth2/auth", "/o/oauth2/v2/auth"]);

export type SignInPageSite = "google" | "devin";

export function devinSignInPageRelayed(): boolean {
  return process.platform === "linux";
}

const SIGN_IN_PAGES: Record<SignInPageSite, (url: URL) => boolean> = {
  google: (url) => url.origin === "https://accounts.google.com" && GOOGLE_SIGN_IN_PATHS.has(url.pathname),
  devin: (url) => url.origin === "https://app.devin.ai",
};

const GOOGLE_ACCOUNT_CHOOSER = "select_account";

const GOOGLE_SILENT_SIGN_IN = "none";

function withGoogleAccountChooser(url: URL): string {
  const prompts = (url.searchParams.get("prompt") ?? "").split(" ").filter(Boolean);
  if (prompts.includes(GOOGLE_ACCOUNT_CHOOSER) || prompts.includes(GOOGLE_SILENT_SIGN_IN)) return url.toString();
  const page = new URL(url);
  page.searchParams.set("prompt", [...prompts, GOOGLE_ACCOUNT_CHOOSER].join(" "));
  return page.toString();
}

const SIGN_IN_PAGE_LINKS: Record<SignInPageSite, (url: URL) => string> = {
  google: withGoogleAccountChooser,
  devin: (url) => url.toString(),
};

async function makeOpenerFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "openbot-sign-in-"));
  const page = join(folder, OPENER_PAGE).replaceAll("'", `'\\''`);
  const script = `#!/bin/sh\nprintf '%s\\n' "$1" >> '${page}'\n`;
  for (const name of ["open", "xdg-open"]) await writeFile(join(folder, name), script, { mode: 0o700 });
  return folder;
}
