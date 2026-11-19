import type { ChildProcess } from "node:child_process";
import { type AgentProviderId, isAgentProvider } from "@openbot/contracts/agent-providers";

const processes = new Map<number, AgentProviderId>();

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
