import { join } from "node:path";
import { teeLogLines } from "@openbot/logging";
import { Effect } from "effect";
import { appendRemoteDiagnosticLog } from "./remote-diagnostics";

/**
 * The loggers whose lines also go to the provider log: provider starts, CLI checks, model lists,
 * state changes and errors (`provider-runtime`), runtime downloads (`provider-runtimes`), and model
 * list members that the window refuses (`provider-models`).
 */
const PROVIDER_LOG_PREFIXES = ["provider-runtime", "provider-runtimes", "provider-models"] as const;

/**
 * Keeps the provider lines in `<logs>/providers/providers.log`, 1 MB with one rotated copy. An app
 * started from the Dock has no terminal that keeps stdout, so this file is the only record of why a
 * provider failed. The logger already redacted each line, and the writer redacts it again. Returns
 * the removal.
 */
export function startProviderLog(logsDirectory: string): () => void {
  const directory = join(logsDirectory, "providers");
  return teeLogLines(PROVIDER_LOG_PREFIXES, (line) => {
    Effect.runFork(appendRemoteDiagnosticLog(directory, "providers", `${line}\n`));
  });
}

/**
 * Keeps the account lines in `<logs>/account/account.log`, with the same size limit. A session file
 * that cannot be read or written names only its stage and an error code, so a support report can show
 * why the app signed out after a restart.
 */
export function startAccountLog(logsDirectory: string): () => void {
  const directory = join(logsDirectory, "account");
  return teeLogLines(["central-auth"], (line) => {
    Effect.runFork(appendRemoteDiagnosticLog(directory, "account", `${line}\n`));
  });
}

/**
 * Keeps the agent deletion lines in `<logs>/agents/agents.log`, with the same size limit. A delete that
 * fails names only its stage and an error code, so a support report can show which step failed.
 */
export function startAgentLog(logsDirectory: string): () => void {
  const directory = join(logsDirectory, "agents");
  return teeLogLines(["agent-removal"], (line) => {
    Effect.runFork(appendRemoteDiagnosticLog(directory, "agents", `${line}\n`));
  });
}

/**
 * Keeps the lines of the main process logger in `<logs>/main/main.log`, with the same size limit:
 * startup failures, uncaught errors, and why the app quit. Without it, a window that disappeared on
 * Windows left no record of whether OpenBot quit or crashed (#2675). It runs for the life of the
 * process, so the teardown's own lines reach the file too. The shutdown deadline exits before its
 * line can be written. The update logger goes here too: `update.log` names only the failure code of
 * a check, download or install, and this file keeps the reason (#3724).
 */
export function startMainLog(logsDirectory: string): void {
  const directory = join(logsDirectory, "main");
  teeLogLines(["main", "update"], (line) => {
    Effect.runFork(appendRemoteDiagnosticLog(directory, "main", `${line}\n`));
  });
}
