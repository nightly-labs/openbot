import type { ChildProcess } from "node:child_process";

/**
 * Outside Windows, the Claude, Codex and Pi CLIs start as the leaders of process groups of their own
 * (`detached`). Their MCP servers and the processes they start stay in that group. Their shell
 * commands do not: each command runs in a group of its own, so a server that the user started from
 * the agent keeps running. ACP agents do not get a group: each agent runs its own shell commands, and
 * some can leave them in the agent's group, where the group stop would end them.
 *
 * Windows has no process group. `taskkill /T` stops the tree there (`windows-process-tree.ts`).
 */
export const PROVIDER_PROCESS_GROUP = process.platform !== "win32";

/** How long the rest of the group gets after SIGTERM, as `endProcessTree` gives the leader. */
const GROUP_KILL_GRACE_MS = 2_000;

/** Sends a signal to a process group. False when no process of the group is left. */
function signalProcessGroup(leader: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-leader, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends what is left of a provider's process group when the provider exits, for any reason: a stop,
 * the end of its stdin, or a crash. The provider stops its own children first, as before. A child of
 * an MCP server outlived that stop: the CLI ended the server, and the server's child moved to `init`
 * with no owner (measured with Claude Code 2.1.318 on macOS, 5 of 5 runs). SIGKILL follows after the
 * grace when the group is still there.
 *
 * Only for a child spawned with `detached: PROVIDER_PROCESS_GROUP`. Elsewhere the group is OpenBot's.
 */
export function endProcessGroupOnExit(child: ChildProcess): void {
  const leader = child.pid;
  if (!PROVIDER_PROCESS_GROUP || leader === undefined) return;
  child.once("exit", () => {
    if (!signalProcessGroup(leader, "SIGTERM")) return;
    setTimeout(() => signalProcessGroup(leader, "SIGKILL"), GROUP_KILL_GRACE_MS).unref();
  });
}
