import { execFile, spawn } from "node:child_process";
import { basename, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { sourceText } from "@openbot/i18n/source";
import { Effect, type Scope } from "effect";
import type { CliLoginProcess } from "./agent/cli-login-flow";
import { ProviderProcessFailed, waitForSuccessfulProcess } from "./agent/provider-status";
import { type AgentCliInfo, cliPathEnvironment, isExecutable, loginSearchPath } from "./cli";
import { type ProviderClientOperationError, providerCall, providerSync } from "./provider-client-effects";
import { stopProcessTree } from "./windows-process-tree";

const execute = promisify(execFile);
const OPEN_MAC = `on run argv
  tell application "Terminal"
    activate
    set loginTab to do script (item 1 of argv)
    return tty of loginTab
  end tell
end run`;
const WAIT_MAC = `on run argv
  tell application "Terminal"
    repeat
      set foundBusy to false
      repeat with candidateWindow in windows
        repeat with candidateTab in tabs of candidateWindow
          if tty of candidateTab is item 1 of argv then
            if busy of candidateTab then set foundBusy to true
          end if
        end repeat
      end repeat
      if not foundBusy then return
      delay 0.2
    end repeat
  end tell
end run`;
const CLOSE_MAC = `on run argv
  tell application "Terminal"
    repeat with candidateWindow in windows
      repeat with candidateTab in tabs of candidateWindow
        if tty of candidateTab is item 1 of argv then
          close candidateTab
          return
        end if
      end repeat
    end repeat
  end tell
end run`;

function terminalLoginCommand(executable: string): string {
  return `'${executable.replaceAll("'", "'\\''")}'`;
}

interface TerminalLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

// Terminals OpenBot can open a provider sign-in in on Linux. `xterm` stays first so hosts where
// the current launch works keep behaving the same; the rest are only tried when `xterm` is
// missing, from the desktop default (`xdg-terminal-exec`) to common emulators.
const LINUX_TERMINAL_CANDIDATES: readonly TerminalLaunch[] = [
  { command: "xterm", args: ["-e"] },
  { command: "xdg-terminal-exec", args: [] },
  { command: "gnome-terminal", args: ["--wait", "--"] },
  { command: "konsole", args: ["-e"] },
  { command: "alacritty", args: ["-e"] },
  { command: "kitty", args: [] },
  { command: "ghostty", args: ["-e"] },
  { command: "foot", args: [] },
];

function linuxTerminalCandidates(terminal: string | undefined): readonly TerminalLaunch[] {
  const [command = "", ...prefix] = terminal?.trim().split(/\s+/u) ?? [];
  if (!command) return LINUX_TERMINAL_CANDIDATES;
  const known = LINUX_TERMINAL_CANDIDATES.find((candidate) => candidate.command === basename(command));
  const configured = { command, args: [...prefix, ...(known?.args ?? ["-e"])] };
  return [configured, ...LINUX_TERMINAL_CANDIDATES];
}

const findLinuxTerminal = Effect.fn("ProviderTerminalLogin.findTerminal")(function* (
  candidates: readonly TerminalLaunch[],
) {
  const folders = yield* loginSearchPath();
  for (const candidate of candidates) {
    for (const folder of folders) {
      const path = isAbsolute(candidate.command) ? candidate.command : join(folder, candidate.command);
      if (yield* isExecutable(path)) return { command: path, args: candidate.args };
    }
  }
  return null;
});

export const startProviderTerminalLogin = Effect.fn("ProviderTerminalLogin.start")(function* (
  cli: AgentCliInfo,
  timeoutMs: number,
): Effect.fn.Return<CliLoginProcess, ProviderClientOperationError, Scope.Scope> {
  if (process.platform === "darwin") {
    const opened = yield* providerCall(() =>
      execute("/usr/bin/osascript", ["-e", OPEN_MAC, terminalLoginCommand(cli.executable)], {
        timeout: 30_000,
        maxBuffer: 4096,
      }),
    );
    const tty = opened.stdout.trim();
    if (!/^\/dev\/ttys\d+$/u.test(tty))
      return yield* providerSync(() => {
        throw new Error(sourceText("error.provider.terminalLoginFailed"));
      });
    yield* Effect.addFinalizer(() =>
      providerCall(() =>
        execute("/usr/bin/osascript", ["-e", CLOSE_MAC, tty], { timeout: 10_000, maxBuffer: 4096 }),
      ).pipe(Effect.ignore),
    );
    const child = yield* Effect.acquireRelease(
      providerSync(() => spawn("/usr/bin/osascript", ["-e", WAIT_MAC, tty], { stdio: "ignore" })),
      (child) => stopProcessTree(child).pipe(Effect.ignore),
    );
    return { child, done: waitForSuccessfulProcess(child, timeoutMs) };
  }
  if (process.platform === "win32") {
    const child = yield* Effect.acquireRelease(
      providerSync(() =>
        spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$p = Start-Process -FilePath $env:OPENBOT_LOGIN_EXECUTABLE -Wait -PassThru; exit $p.ExitCode",
          ],
          { stdio: "ignore", windowsHide: true, env: { ...process.env, OPENBOT_LOGIN_EXECUTABLE: cli.executable } },
        ),
      ),
      (child) => stopProcessTree(child).pipe(Effect.ignore),
    );
    return { child, done: waitForSuccessfulProcess(child, timeoutMs) };
  }
  const terminal = yield* findLinuxTerminal(linuxTerminalCandidates(process.env.TERMINAL));
  if (terminal === null)
    return yield* providerSync(() => {
      throw new Error(sourceText("error.provider.terminalLoginFailed"));
    });
  let spawnFailure: Error | null = null;
  const child = yield* Effect.acquireRelease(
    providerSync(() => {
      const login = spawn(terminal.command, [...terminal.args, cli.executable], {
        stdio: "ignore",
        env: { ...process.env, ...cliPathEnvironment(cli) },
      });
      // The spawn error fires on the next tick, before the login watcher below registers its own
      // listener; keep it here so a missing terminal cannot reach the main process uncaught.
      login.once("error", (error) => {
        spawnFailure = error;
      });
      return login;
    }),
    (child) => stopProcessTree(child).pipe(Effect.ignore),
  );
  return {
    child,
    done: Effect.suspend(() =>
      spawnFailure === null
        ? waitForSuccessfulProcess(child, timeoutMs)
        : Effect.fail(
            new ProviderProcessFailed({
              cause: new Error(`Provider login could not start ${terminal.command}. ${spawnFailure.message}`),
            }),
          ),
    ),
  };
});
