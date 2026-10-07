import { type ChildProcess, spawn } from "node:child_process";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Fiber, Schema } from "effect";
import { shellQuote } from "../automation-command";
import { cliSpawnTarget } from "../cli";
import { stopProcessTree } from "../windows-process-tree";
import { waitForSuccessfulProcess } from "./provider-status";

/**
 * What a provider CLI prints for a sign-in the user finishes on another device.
 *
 * `device` is a device code: the user opens the page, confirms the code, and the CLI sees the
 * approval by itself (Grok, Cline). `paste` is an authorization code the provider's page shows after
 * the sign-in, which the user copies back and OpenBot types into the CLI's prompt (Claude). `link` is
 * a page that signs the CLI in by itself, with no code to confirm or copy (Cursor).
 */
export type CliCodePrompt =
  | { flow: "device"; userCode: string; verificationUrl: string; verificationUrlComplete: string | null }
  | { flow: "paste"; verificationUrl: string }
  | { flow: "link"; verificationUrl: string };

export interface CliCodeLogin {
  child: ChildProcess;
  /** Settles when the CLI exits: resolves on success, rejects on failure or after `timeoutMs`. */
  done: Effect.Effect<void, CliCodeLoginFailed>;
  /** Resolves when the CLI has printed what the user needs. Rejects when it exits or goes quiet first. */
  prompt: Effect.Effect<CliCodePrompt, CliCodeLoginFailed>;
  /** Types the code into the CLI's prompt. Only a `paste` sign-in reads it. */
  submit(code: string): void;
}

/** How long the CLI has to print its link. A pinned CLI prints it in well under a second. */
const PROMPT_TIMEOUT_MS = 30_000;
/** The link and the prompt are in the first lines. Output past this is not read or kept. */
const MAX_OUTPUT_CHARS = 64 * 1024;
const MAX_CODE_LENGTH = 2048;

/**
 * Starts a provider CLI sign-in and reads its link from the output.
 *
 * The output is a secret: the link carries the PKCE challenge and state, and the pasted code is a
 * credential. None of it is logged, and no error here quotes it.
 *
 * A `paste` sign-in runs under `script`, because the CLI shows its prompt only on a terminal. The
 * util-linux `script` is in every Debian and Ubuntu base image (package `bsdutils`). The paste
 * flow runs only there: the BSD `script` of macOS stops when its stdin is a socket, which is what
 * Node gives a child, and a FIFO on macOS is a socket too. Windows has no `script`.
 */
export const startCliCodeLogin = Effect.fnUntraced(function* (options: {
  flow: CliCodePrompt["flow"];
  executable: string;
  argv: readonly string[];
  env: Record<string, string>;
  timeoutMs: number;
  platform?: NodeJS.Platform;
}) {
  const platform = options.platform ?? process.platform;
  const command = yield* Effect.try({
    try: () => (options.flow === "paste" ? terminalCommand(platform, options.argv) : null),
    catch: (cause) => new CliCodeLoginFailed({ cause }),
  });
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        // Cursor's Windows launcher is a `.cmd` file, which starts only through `cmd.exe`.
        const target = command
          ? { command: command.file, args: command.args, windowsVerbatimArguments: false }
          : cliSpawnTarget(options.executable, options.argv, platform);
        return spawn(target.command, target.args, {
          cwd: process.cwd(),
          env: { ...process.env, ...options.env, ...(command ? { OPENBOT_LOGIN_EXECUTABLE: options.executable } : {}) },
          windowsVerbatimArguments: target.windowsVerbatimArguments,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: platform === "win32",
        });
      },
      catch: (cause) => new CliCodeLoginFailed({ cause }),
    }),
    (child) => stopProcessTree(child).pipe(Effect.orDie),
  );
  child.stdin?.on("error", () => undefined);
  let submitted = false;
  // After a pasted code, an exit with a failure code is the provider refusing it. A timeout is a
  // signal, so it keeps its own message.
  const done = yield* Effect.forkScoped(
    waitForSuccessfulProcess(child, options.timeoutMs).pipe(
      Effect.mapError(
        (failure) =>
          new CliCodeLoginFailed({
            cause:
              submitted && child.exitCode !== null
                ? new Error(sourceText("error.provider.codeLoginRefused"))
                : failure.cause,
          }),
      ),
    ),
    { startImmediately: true },
  );
  const prompt = yield* Effect.forkScoped(readCodePrompt(child, options.flow), { startImmediately: true });
  return {
    child,
    done: Fiber.join(done),
    prompt: Fiber.join(prompt),
    submit(code) {
      if (options.flow !== "paste") throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
      const value = normalizePastedCode(code);
      // The CLI can quote the code when it fails; every log line and error then masks it.
      registerSecretValue(value);
      if (!child.stdin || child.exitCode !== null) throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
      submitted = true;
      child.stdin.write(`${value}\r`);
    },
  } satisfies CliCodeLogin;
});

export class CliCodeLoginFailed extends Schema.TaggedError<CliCodeLoginFailed>()("CliCodeLoginFailed", {
  cause: Schema.Defect(),
}) {}

// Output contains credentials and must not become a trace payload.
const readCodePrompt = Effect.fnUntraced(function* (child: ChildProcess, flow: CliCodePrompt["flow"]) {
  return yield* Effect.callback<CliCodePrompt, CliCodeLoginFailed>((resume) => {
    let output = "";
    let settled = false;
    const cleanup = () => {
      child.stdout?.off("data", read);
      child.stderr?.off("data", read);
      child.off("error", unavailable);
      child.off("exit", unavailable);
    };
    const settle = (result: CliCodePrompt | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(result instanceof Error ? Effect.fail(new CliCodeLoginFailed({ cause: result })) : Effect.succeed(result));
    };
    const unavailable = () => settle(new Error(sourceText("error.provider.codeLoginNoLink")));
    const read = (chunk: Buffer) => {
      if (output.length >= MAX_OUTPUT_CHARS) return;
      output += chunk.toString("utf8").slice(0, MAX_OUTPUT_CHARS - output.length);
      const parsed = parseCliCodePrompt(flow, output);
      if (parsed) settle(parsed);
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("error", unavailable);
    child.once("exit", unavailable);
    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutOrElse({
      duration: PROMPT_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(new CliCodeLoginFailed({ cause: new Error(sourceText("error.provider.codeLoginNoLink")) })),
    }),
    // Cursor's Windows launcher runs under `cmd.exe`, so the whole tree has to stop.
    Effect.tapError(() => stopProcessTree(child).pipe(Effect.ignore)),
  );
});

/** The pasted code, or an error that does not quote it. */
export function normalizePastedCode(code: string): string {
  const value = code.trim();
  // A control character would type a key into the CLI, such as Enter before the code ends.
  if (!value || value.length > MAX_CODE_LENGTH || [...value].some(isControlCharacter)) {
    throw new Error(sourceText("error.provider.codeLoginBadCode"));
  }
  return value;
}

/** Whether a pasted-code sign-in can run on this platform: see `startCliCodeLogin`. */
export function pasteCodeLoginSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "linux";
}

/**
 * The CLI under a pseudo-terminal, on Linux. The executable travels in the environment, so no path
 * is ever pasted into a shell command. The arguments are the driver's own constants.
 */
function terminalCommand(platform: NodeJS.Platform, argv: readonly string[]): { file: string; args: string[] } {
  if (pasteCodeLoginSupported(platform)) {
    const line = ['exec "$OPENBOT_LOGIN_EXECUTABLE"', ...argv.map(shellQuote)].join(" ");
    return { file: "script", args: ["-q", "-e", "-f", "-c", line, "/dev/null"] };
  }
  throw new Error(sourceText("error.provider.codeLoginUnsupported"));
}

/**
 * Reads the link, and the code for a device sign-in, from what the CLI has printed so far. Returns
 * null until all of it is there. The shapes are the pinned CLIs' (Grok 1.0.22, Claude 2.1.263,
 * Cursor 2026.10.01, Cline 3.0.68); the tests hold samples of each.
 */
export function parseCliCodePrompt(flow: CliCodePrompt["flow"], output: string): CliCodePrompt | null {
  const text = stripTerminalCodes(output);
  // Only a link that something has ended: a chunk can stop in the middle of one.
  const url = text.match(/https:\/\/[^\s"'<>]+(?=[\s"'<>])/)?.[0];
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (flow === "paste") {
    // The CLI reads stdin only once it shows the prompt, so a code typed before then is lost.
    return /paste code/i.test(text) ? { flow, verificationUrl: parsed.href } : null;
  }
  if (flow === "link") return { flow, verificationUrl: parsed.href };
  const userCode = codeAfterConfirmLine(text) ?? codeOnEnterLine(text);
  if (!userCode) return null;
  const base = new URL(parsed.href);
  base.search = "";
  return {
    flow,
    userCode,
    verificationUrl: base.href,
    verificationUrlComplete: parsed.search ? parsed.href : null,
  };
}

/**
 * The first non-empty line after "Confirm this code", when it is a code. The last line has no
 * newline yet, so a chunk can end in it with part of the code.
 */
function codeAfterConfirmLine(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim());
  const confirm = lines.findIndex((line) => /confirm this code/i.test(line));
  if (confirm < 0) return null;
  const code = lines.slice(confirm + 1, -1).find(Boolean);
  return code && /^[A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})*$/.test(code) ? code : null;
}

/** The code at the end of an "Enter this code in your browser: CODE" line that has ended (Cline). */
function codeOnEnterLine(text: string): string | null {
  return text.match(/enter this code[^:\n]*:[ \t]*([A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})*)[ \t]*\n/i)?.[1] ?? null;
}

const ESC = 0x1b;
const BEL = 0x07;

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

/**
 * Removes colours, cursor moves and OSC 8 hyperlinks, which wrap the URL a terminal prints. The
 * hyperlink's visible text repeats its URL, so dropping the escape keeps one copy.
 */
function stripTerminalCodes(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === ESC && value[index + 1] === "]") {
      // OSC: runs to BEL or to ESC \.
      index += 2;
      while (index < value.length && value.charCodeAt(index) !== BEL && value.charCodeAt(index) !== ESC) index += 1;
      index += value.charCodeAt(index) === ESC ? 2 : 1;
      result += " ";
      continue;
    }
    if (code === ESC && value[index + 1] === "[") {
      // CSI: parameters, then one final letter.
      index += 2;
      while (index < value.length && !/[A-Za-z]/.test(value[index] ?? "")) index += 1;
      index += 1;
      continue;
    }
    result += value[index] === "\r" ? "\n" : (value[index] ?? "");
    index += 1;
  }
  return result;
}
