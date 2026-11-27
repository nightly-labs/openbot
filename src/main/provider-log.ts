import { join } from "node:path";
import { teeLogLines } from "@openbot/logging";
import { Effect, Fiber } from "effect";
import { appendRemoteDiagnosticLog } from "./remote-diagnostics";

const PROVIDER_LOG_PREFIXES = [
  "provider-runtime",
  "provider-runtimes",
  "provider-models",
  "acp-client",
  "agent-error",
] as const;

export function startProviderLog(logsDirectory: string): () => void {
  const directory = join(logsDirectory, "providers");
  return teeLogLines(PROVIDER_LOG_PREFIXES, (line) => {
    Effect.runFork(appendRemoteDiagnosticLog(directory, "providers", `${line}\n`));
  });
}

export function startAccountLog(logsDirectory: string): () => void {
  const directory = join(logsDirectory, "account");
  return teeLogLines(["central-auth"], (line) => {
    Effect.runFork(appendRemoteDiagnosticLog(directory, "account", `${line}\n`));
  });
}

export function startAgentLog(logsDirectory: string): () => void {
  const directory = join(logsDirectory, "agents");
  return teeLogLines(["agent-removal"], (line) => {
    Effect.runFork(appendRemoteDiagnosticLog(directory, "agents", `${line}\n`));
  });
}

const MAIN_LOG_PREFIXES = [
  "main",
  "main-window",
  "start-recovery",
  "update",
  "channel-routing",
  "signal-ingress",
  "drain-scheduler",
  "linux-gpu",
] as const;

export function startMainLog(logsDirectory: string): void {
  const directory = join(logsDirectory, "main");
  teeLogLines(MAIN_LOG_PREFIXES, (line) => {
    const write = Effect.runFork(appendRemoteDiagnosticLog(directory, "main", `${line}\n`));
    mainLogWrites.add(write);
    write.addObserver(() => mainLogWrites.delete(write));
  });
}

const mainLogWrites = new Set<Fiber.Fiber<void>>();

export function flushMainLog(): Effect.Effect<void> {
  return Effect.suspend(() => Fiber.awaitAll([...mainLogWrites])).pipe(Effect.asVoid);
}
