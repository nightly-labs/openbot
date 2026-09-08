import type { ChildProcess } from "node:child_process";
import type { AgentProviderStatus } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import type { AgentProvider } from "../agent-client";
import { CodexCliError } from "../cli";

export function setProviderStatus(
  statuses: AgentProviderStatus[],
  provider: AgentProvider,
  patch: Omit<AgentProviderStatus, "id">,
): void {
  const index = statuses.findIndex((status) => status.id === provider);
  const status = { id: provider, ...patch };
  if (index === -1) statuses.push(status);
  else statuses[index] = status;
}

export function updateProviderStatus(
  statuses: AgentProviderStatus[] | undefined,
  provider: AgentProvider,
  patch: Omit<AgentProviderStatus, "id">,
): AgentProviderStatus[] {
  const next = structuredClone(statuses ?? []);
  setProviderStatus(next, provider, patch);
  return next;
}

export function providerFailureStatus(
  provider: AgentProvider,
  error: unknown,
  version: string | null | undefined,
): Omit<AgentProviderStatus, "id"> {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CodexCliError) {
    if (provider === "codex" || provider === "claude") {
      const label = provider === "codex" ? "ChatGPT" : "Claude";
      const bundledMessage =
        error.code === "missing"
          ? `OpenBot's included ${label} runtime is missing. Reinstall OpenBot.`
          : `OpenBot could not start its included ${label} runtime. Update or reinstall OpenBot.`;
      return { state: "error", version: version ?? null, message: bundledMessage };
    }
    if (error.code === "missing") {
      return { state: "not-installed", version: null, message };
    }
    if (error.code === "outdated") {
      return { state: "outdated", version: version ?? null, message };
    }
  }
  return { state: "error", version: version ?? null, message };
}

/**
 * Collects a failing process's own explanation from its error stream: the last line it wrote,
 * bounded, for a message the user reads. Returns null when the process said nothing usable, so the
 * caller keeps its own wording rather than showing an empty sentence.
 *
 * The line is redacted first. It goes into the provider row, which the Team API broadcasts to the
 * team's connected clients, and a CLI that fails on authentication prints the header or key it sent.
 */
export function readProcessReason(child: ChildProcess): () => string | null {
  let text = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    if (text.length < 4_000) text += chunk;
  });
  child.stderr?.on("error", () => undefined);
  return () => {
    const line = text
      .split(/\r?\n/u)
      .map((candidate) => candidate.trim())
      .filter(Boolean)
      .at(-1);
    if (!line) return null;
    const safe = redactText(line);
    return safe.length > 200 ? `${safe.slice(0, 199)}…` : safe;
  };
}

export function waitForSuccessfulProcess(
  child: ChildProcess,
  timeoutMs: number,
  description = "Provider login",
): Promise<void> {
  return new Promise((resolveProcess, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${description} timed out.`));
    }, timeoutMs);
    timer.unref?.();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && signal === null) resolveProcess();
      else reject(new Error(`${description} stopped with ${signal ?? `code ${String(code)}`}.`));
    });
  });
}
