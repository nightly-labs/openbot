// The user's own ACP agents: list, save, remove and check. This computer only: no Team API route
// reaches these, because an agent is a command that runs here.
//
// This module owns the order of the writes, so the backend never has to know that a store exists:
// it is given a getter, and reads it again when an agent's process starts.

import type {
  CheckCustomAgentInput,
  CustomAgentCheckResult,
  CustomAgentResult,
  CustomAgentSummary,
  SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { checkAcpAgent } from "../backend/acp-agent-check";
import { assertAgentArgs, assertWindowsScriptArgs, resolveAgentCommand } from "../backend/acp-agent-command";
import type { AgentService } from "../backend/agent-service";
import type { CustomAgentStore } from "./custom-agent-store";

export interface CustomAgentChangeDependencies {
  service: Pick<AgentService, "saveCustomAgent" | "removeCustomAgent" | "reloadCustomAgents">;
  customAgents: Pick<CustomAgentStore, "list" | "save" | "remove" | "checkEnv" | "assertWritable">;
  resolve?: typeof resolveAgentCommand;
  check?: typeof checkAcpAgent;
}

export interface CustomAgentChanges {
  /** The agents without their environment values. */
  list(): Promise<CustomAgentSummary[]>;
  save(input: SaveCustomAgentInput): Promise<CustomAgentResult>;
  remove(id: string): Promise<CustomAgentResult>;
  /** One trial start. Writes nothing. */
  check(input: CheckCustomAgentInput): Promise<CustomAgentCheckResult>;
}

export function createCustomAgentChanges({
  service,
  customAgents,
  resolve = resolveAgentCommand,
  check = checkAcpAgent,
}: CustomAgentChangeDependencies): CustomAgentChanges {
  // One change at a time, from the first read to the last write, as for the endpoints.
  let chain: Promise<unknown> = Promise.resolve();
  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const operation = chain.then(run);
    chain = operation.catch(() => undefined);
    return operation;
  }

  return {
    list: () => customAgents.list(),
    /**
     * Persist first, then restart the router. The command is not resolved here: an agent installed
     * later still saves, and its row shows that the command is not found.
     */
    save: (input) =>
      serialize(async () => {
        assertAgentArgs(input.args);
        await service.saveCustomAgent(() => customAgents.save(input));
        return { agents: await customAgents.list(), restart: await service.reloadCustomAgents() };
      }),
    /** The agents on it move to another provider before the write, in the backend's chain. */
    remove: (id) =>
      serialize(async () => {
        customAgents.assertWritable();
        if (!(await customAgents.list()).some((agent) => agent.id === id)) {
          throw new Error(sourceText("error.provider.customAgentNotSaved"));
        }
        await service.removeCustomAgent(id, () => customAgents.remove(id));
        return { agents: await customAgents.list(), restart: await service.reloadCustomAgents() };
      }),
    check: async (input) => {
      assertAgentArgs(input.args);
      const env = customAgents.checkEnv(input.env, input.savedAgentId);
      const executable = await resolve(input.command);
      if (!executable) throw new Error(sourceText("error.provider.customAgentNotFound", { command: input.command }));
      assertWindowsScriptArgs(executable, input.args);
      return check({ executable, args: input.args, env });
    },
  };
}
