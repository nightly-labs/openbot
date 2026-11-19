import { type ChildProcess, spawn } from "node:child_process";
import { pasteCodeSignInSupported } from "@openbot/contracts/agent-providers";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Deferred, Effect, Fiber, Option, Schema } from "effect";
import { shellQuote } from "../automation-command";
import { cliSpawnTarget } from "../cli";
import { stopProcessTree } from "../windows-process-tree";
import { orNewSavedSignIn, waitForSuccessfulProcess, watchSavedSignIn } from "./provider-status";

export type CliCodePrompt =
  | { flow: "device"; userCode: string; verificationUrl: string; verificationUrlComplete: string | null }
  | { flow: "paste"; verificationUrl: string }
  | { flow: "link"; verificationUrl: string };

export interface CliCodeLogin {
  child: ChildProcess;
  done: Effect.Effect<void, CliCodeLoginFailed>;
  prompt: Effect.Effect<CliCodePrompt | null, CliCodeLoginFailed>;
  submit(code: string): void;
}

export const PROMPT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 64 * 1024;
const MAX_CODE_LENGTH = 2048;

export const startCliCodeLogin = Effect.fnUntraced(function* (options: {
  flow: CliCodePrompt["flow"];
  executable: string;
  argv: readonly string[];
  env: Record<string, string>;
  timeoutMs: number;
  closeInput?: boolean;
  savedSignIn?: Effect.Effect<string | null>;
  platform?: NodeJS.Platform;
}) {
  const platform = options.platform ?? process.platform;
  const command = yield* Effect.try({
    try: () => (options.flow === "paste" ? terminalCommand(platform, options.argv) : null),
    catch: (cause) => new CliCodeLoginFailed({ cause }),
  });
  const watch = yield* watchSavedSignIn(options.savedSignIn);
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
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
  if (options.closeInput && options.flow !== "paste") child.stdin?.end();
  let submitted = false;
  const prompt = Deferred.makeUnsafe<CliCodePrompt | null, CliCodeLoginFailed>();
  const done = yield* Effect.forkScoped(
    orNewSavedSignIn(waitForSuccessfulProcess(child, options.timeoutMs), watch, undefined).pipe(
      Effect.mapError(
        (failure) =>
          new CliCodeLoginFailed({
            cause:
              submitted && child.exitCode !== null
                ? new Error(sourceText("error.provider.codeLoginRefused"))
                : failure.cause,
          }),
      ),
      Effect.tapError((failure) => Deferred.fail(prompt, failure)),
      Effect.tap(() => Deferred.succeed(prompt, null)),
    ),
    { startImmediately: true },
  );
  const afterFailedExit = watch
    ? Fiber.join(done).pipe(
        Effect.as(null),
        Effect.mapError(
          () => new CliCodeLoginFailed({ cause: new Error(sourceText("error.provider.codeLoginNoLink")) }),
        ),
      )
    : undefined;
  yield* Effect.forkScoped(Deferred.complete(prompt, readCodePrompt(child, options.flow, afterFailedExit)), {
    startImmediately: true,
  });
  return {
    child,
    done: Fiber.join(done),
    prompt: Deferred.await(prompt),
    submit(code) {
      if (options.flow !== "paste") throw new Error(sourceText("error.provider.codeLoginNotWaiting"));
      const value = normalizePastedCode(code);
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

const readCodePrompt = Effect.fnUntraced(function* (
  child: ChildProcess,
  flow: CliCodePrompt["flow"],
  afterFailedExit?: Effect.Effect<null, CliCodeLoginFailed>,
) {
  return yield* Effect.callback<CliCodePrompt | null, CliCodeLoginFailed>((resume) => {
    let output = "";
    let settled = false;
    const cleanup = () => {
      child.stdout?.off("data", read);
      child.stderr?.off("data", read);
      child.off("error", unavailable);
      child.off("exit", exited);
    };
    const settle = (result: CliCodePrompt | Error | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(result instanceof Error ? Effect.fail(new CliCodeLoginFailed({ cause: result })) : Effect.succeed(result));
    };
    const unavailable = () => settle(new Error(sourceText("error.provider.codeLoginNoLink")));
    const exited = (code: number | null) => {
      if (code === 0) return settle(null);
      if (!afterFailedExit || settled) return unavailable();
      settled = true;
      cleanup();
      resume(afterFailedExit);
    };
    const read = (chunk: Buffer) => {
      if (output.length >= MAX_OUTPUT_CHARS) return;
      output += chunk.toString("utf8").slice(0, MAX_OUTPUT_CHARS - output.length);
      const parsed = parseCliCodePrompt(flow, output);
      if (parsed) settle(parsed);
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("error", unavailable);
    child.once("exit", exited);
    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutOrElse({
      duration: PROMPT_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(new CliCodeLoginFailed({ cause: new Error(sourceText("error.provider.codeLoginNoLink")) })),
    }),
    Effect.tapError(() => stopProcessTree(child).pipe(Effect.ignore)),
  );
});

export function normalizePastedCode(code: string): string {
  const value = code.trim();
  if (!value || value.length > MAX_CODE_LENGTH || [...value].some(isControlCharacter)) {
    throw new Error(sourceText("error.provider.codeLoginBadCode"));
  }
  return value;
}

export function pasteCodeLoginSupported(platform: NodeJS.Platform = process.platform): boolean {
  return pasteCodeSignInSupported(platform);
}

function terminalCommand(platform: NodeJS.Platform, argv: readonly string[]): { file: string; args: string[] } {
  if (pasteCodeLoginSupported(platform)) {
    const line = ['exec "$OPENBOT_LOGIN_EXECUTABLE"', ...argv.map(shellQuote)].join(" ");
    return { file: "script", args: ["-q", "-e", "-f", "-c", line, "/dev/null"] };
  }
  throw new Error(sourceText("error.provider.codeLoginUnsupported"));
}

function parseCliCodePrompt(flow: CliCodePrompt["flow"], output: string): CliCodePrompt | null {
  const text = stripTerminalCodes(output);
  if (flow === "device") {
    const event = deviceCodeEvent(text);
    if (event) return event;
  }
  const url =
    (flow === "device" ? text.match(/\bopen:[ \t]*(https:\/\/[^\s"'<>]+)(?=[\s"'<>])/i)?.[1] : undefined) ??
    text.match(/https:\/\/[^\s"'<>]+(?=[\s"'<>])/)?.[0];
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (flow === "paste") {
    return /paste code|paste it below/i.test(text) ? { flow, verificationUrl: parsed.href } : null;
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

function codeAfterConfirmLine(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim());
  const confirm = lines.findIndex((line) => /confirm this code|enter this one-time code/i.test(line));
  if (confirm < 0) return null;
  const code = lines.slice(confirm + 1, -1).find(Boolean);
  return code && /^[A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})*$/.test(code) ? code : null;
}

const DeviceCodeEvent = Schema.Struct({
  type: Schema.Literal("verification_url"),
  data: Schema.Struct({ verification_url: Schema.String, user_code: Schema.String }),
});
const decodeDeviceCodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(DeviceCodeEvent));

function deviceCodeEvent(text: string): CliCodePrompt | null {
  for (const line of text.split("\n").slice(0, -1)) {
    const event = decodeDeviceCodeEvent(line.trim());
    if (Option.isNone(event)) continue;
    const { verification_url: url, user_code: userCode } = event.value.data;
    if (!/^[A-Za-z0-9]{3,12}(?:-[A-Za-z0-9]{3,12})*$/.test(userCode) || !URL.canParse(url)) continue;
    const page = new URL(url);
    if (page.protocol !== "https:") continue;
    const base = new URL(page.href);
    base.search = "";
    return {
      flow: "device",
      userCode,
      verificationUrl: base.href,
      verificationUrlComplete: page.search ? page.href : null,
    };
  }
  return null;
}

function codeOnEnterLine(text: string): string | null {
  return (
    text.match(/enter (?:this )?code(?:[^:\n]*:)?[ \t]*([A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12})*)[ \t]*\n/i)?.[1] ?? null
  );
}

const ESC = 0x1b;
const BEL = 0x07;

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

function stripTerminalCodes(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === ESC && value[index + 1] === "]") {
      index += 2;
      while (index < value.length && value.charCodeAt(index) !== BEL && value.charCodeAt(index) !== ESC) index += 1;
      index += value.charCodeAt(index) === ESC ? 2 : 1;
      result += " ";
      continue;
    }
    if (code === ESC && value[index + 1] === "[") {
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
