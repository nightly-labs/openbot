import { type ChildProcess, spawn } from "node:child_process";

export const PROVIDER_PROCESS_GROUP = process.platform !== "win32";

const GROUP_KILL_GRACE_MS = 2_000;

function signalProcessGroup(leader: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-leader, signal);
    return true;
  } catch {
    return false;
  }
}

export function endProcessGroupOnExit(child: ChildProcess): void {
  const leader = child.pid;
  if (!PROVIDER_PROCESS_GROUP || leader === undefined) return;
  child.once("exit", () => {
    if (!signalProcessGroup(leader, "SIGTERM")) return;
    setTimeout(() => signalProcessGroup(leader, "SIGKILL"), GROUP_KILL_GRACE_MS).unref();
  });
}

const groupsToEndOnQuit = new Set<number>();

function endGroupsOnQuit(): void {
  for (const leader of groupsToEndOnQuit) signalProcessGroup(leader, "SIGKILL");
}

function endGroupOnQuit(leader: number): () => void {
  if (groupsToEndOnQuit.size === 0) process.once("exit", endGroupsOnQuit);
  groupsToEndOnQuit.add(leader);
  return () => {
    if (!groupsToEndOnQuit.delete(leader) || groupsToEndOnQuit.size > 0) return;
    process.off("exit", endGroupsOnQuit);
  };
}

type GroupReadFailure = Error & { code?: string | number | null; killed?: boolean; signal?: NodeJS.Signals | null };

export function readProcessGroupOutput(
  file: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; signal: AbortSignal },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { env: options.env, detached: true });
    const leader = child.pid;
    if (leader === undefined) {
      child.once("error", reject);
      return;
    }
    const forget = endGroupOnQuit(leader);
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: GroupReadFailure | null = null;
    let ending = false;
    let settled = false;
    const endGroup = () => {
      if (ending) return;
      ending = true;
      if (!signalProcessGroup(leader, "SIGTERM")) return forget();
      setTimeout(() => {
        signalProcessGroup(leader, "SIGKILL");
        forget();
      }, GROUP_KILL_GRACE_MS).unref();
    };
    const stop = (error: GroupReadFailure) => {
      failure ??= error;
      child.stdout.destroy();
      child.stderr.destroy();
      endGroup();
    };
    const timer = setTimeout(
      () => stop(Object.assign(new Error(`Command timed out: ${file}`), { killed: true, signal: "SIGTERM" as const })),
      options.timeout,
    );
    const abort = () => stop(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
    const settle = (error: GroupReadFailure | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve({ stdout: Buffer.concat(chunks).toString("utf8") });
    };
    if (options.signal.aborted) abort();
    else options.signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= options.maxBuffer) chunks.push(chunk);
      else stop(Object.assign(new RangeError("stdout maxBuffer length exceeded"), { killed: true }));
    });
    child.stderr.resume();
    child.once("exit", endGroup);
    child.once("error", (error) => {
      stop(error);
      settle(error);
    });
    child.once("close", (code, signal) => {
      if (failure) return settle(failure);
      if (code === 0) return settle(null);
      settle(Object.assign(new Error(`Command failed: ${file}`), { code, signal, killed: false }));
    });
  });
}
