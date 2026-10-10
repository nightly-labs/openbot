import type { ChildProcess } from "node:child_process";
import { type AgentProviderId, isAgentProvider } from "@openbot/contracts/agent-providers";

/**
 * The provider CLI processes that OpenBot started, by PID. The resource monitor reads it to attribute
 * a process tree to a provider. It holds a closed-set provider id only, never a command line or a path.
 */
const processes = new Map<number, AgentProviderId>();

/**
 * Records a provider CLI until it exits. A custom agent id is not a closed-set name, so a custom agent
 * counts as `acp`, the protocol that runs it.
 */
export function registerProviderProcess(child: ChildProcess, provider: string): void {
  const pid = child.pid;
  if (pid === undefined) return;
  processes.set(pid, isAgentProvider(provider) ? provider : "acp");
  child.once("exit", () => {
    processes.delete(pid);
  });
}

export function providerProcessIds(): ReadonlyMap<number, AgentProviderId> {
  return processes;
}
