import { type ChildProcess, spawn } from "node:child_process";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { waitForSuccessfulProcess } from "./provider-status";

/**
 * What a provider CLI prints for a sign-in the user finishes on another device.
 *
 * `device` is a device code: the user opens the page, confirms the code, and the CLI sees the
 * approval by itself (Grok). `paste` is an authorization code the provider's page shows after the
 * sign-in, which the user copies back and OpenBot types into the CLI's prompt (Claude).
 */
export type CliCodePrompt =
  | { flow: "device"; userCode: string; verificationUrl: string; verificationUrlComplete: string | null }
  | { flow: "paste"; verificationUrl: string };

export interface CliCodeLogin {
  child: ChildProcess;
  /** Settles when the CLI exits: resolves on success, rejects on failure or after `timeoutMs`. */
  done: Promise<void>;
  /** Resolves when the CLI has printed what the user needs. Rejects when it exits or goes quiet first. */
  prompt: Promise<CliCodePrompt>;
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
export function startCliCodeLogin(options: {
  flow: CliCodePrompt["flow"];
  executable: string;
  argv: readonly string[];
  env: Record<string, string>;
  timeoutMs: number;
  platform?: NodeJS.Platform;
}): CliCodeLogin {
  const platform = options.platform ?? process.platform;
  const command = options.flow === "paste" ? terminalCommand(platform, options.argv) : null;
  const child = spawn(command?.file ?? options.executable, command?.args ?? [...options.argv], {
    cwd: process.cwd(),
    env: { ...process.env, ...options.env, ...(command ? { OPENBOT_LOGIN_EXECUTABLE: options.executable } : {}) },
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: platform === "win32",
  });
  child.stdin?.on("error", () => undefined);
  let submitted = false;
  // After a pasted code, an exit with a failure code is the provider refusing it. A timeout is a
  // signal, so it keeps its own message.
  const done = waitForSuccessfulProcess(child, options.timeoutMs).catch((error: unknown) => {
    if (submitted && child.exitCode !== null) throw new Error(sourceText("error.provider.codeLoginRefused"));
    throw error;
  });
  const prompt = new Promise<CliCodePrompt>((resolve, reject) => {
    let output = "";
    let settled = false;
    const settle = (result: CliCodePrompt | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", read);
      child.stderr?.off("data", read);
      if (result instanceof Error) {
        if (child.exitCode === null) child.kill("SIGTERM");
        reject(result);
      } else resolve(result);
    };
    const read = (chunk: Buffer) => {
      if (output.length >= MAX_OUTPUT_CHARS) return;
      output += chunk.toString("utf8").slice(0, MAX_OUTPUT_CHARS - output.length);
      const parsed = parseCliCodePrompt(options.flow, output);
      if (parsed) settle(parsed);
    };
    const timer = setTimeout(() => settle(new Error(sourceText("error.provider.codeLoginNoLink"))), PROMPT_TIMEOUT_MS);
    timer.unref?.();
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("error", () => settle(new Error(sourceText("error.provider.codeLoginNoLink"))));
    child.once("exit", () => settle(new Error(sourceText("error.provider.codeLoginNoLink"))));
  });
  // Both are awaited by the caller; this only keeps an early exit from being unhandled.
  done.catch(() => undefined);
  prompt.catch(() => undefined);
  return {
    child,
    done,
    prompt,
    submit(code) {
      if (options.flow !== "paste") throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
      const value = normalizePastedCode(code);
      // The CLI can quote the code when it fails; every log line and error then masks it.
      registerSecretValue(value);
      if (!child.stdin || child.exitCode !== null) throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
      submitted = true;
      child.stdin.write(`${value}\r`);
    },
  };
}

/** The pasted code, or an error that does not quote it. */
export function normalizePastedCode(code: string): string {
  const value = code.trim();
  // A control character would type a key into the CLI, such as Enter before the code ends.
  if (!value || value.length > MAX_CODE_LENGTH || [...value].some(isControlCharacter)) {
    throw new Error(sourceText("error.provider.codeLoginBadCode"));
  }
  return value;
}

/**
 * The CLI under a pseudo-terminal, on Linux. The executable travels in the environment, so no path
 * is ever pasted into a shell command. The arguments are the driver's own constants.
 */
function terminalCommand(platform: NodeJS.Platform, argv: readonly string[]): { file: string; args: string[] } {
  if (platform === "linux") {
    const line = ['exec "$OPENBOT_LOGIN_EXECUTABLE"', ...argv.map(shellQuote)].join(" ");
    return { file: "script", args: ["-q", "-e", "-f", "-c", line, "/dev/null"] };
  }
  throw new Error(sourceText("error.provider.codeLoginUnsupported"));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Reads the link, and the code for a device sign-in, from what the CLI has printed so far. Returns
 * null until all of it is there. The shapes are the pinned CLIs' (Grok 1.0.22, Claude 2.1.263);
 * the tests hold samples of both.
 */
export function parseCliCodePrompt(flow: CliCodePrompt["flow"], output: string): CliCodePrompt | null {
  const text = stripTerminalCodes(output);
  const url = text.match(/https:\/\/[^\s"'<>]+/)?.[0];
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
  // The code line comes after the link, so once it is there the link is not cut off mid-chunk.
  const userCode = codeAfterConfirmLine(text);
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

/** The first non-empty line after "Confirm this code", when it is a code. */
function codeAfterConfirmLine(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim());
  const confirm = lines.findIndex((line) => /confirm this code/i.test(line));
  if (confirm < 0) return null;
  const code = lines.slice(confirm + 1).find(Boolean);
  return code && /^[A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})*$/.test(code) ? code : null;
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
