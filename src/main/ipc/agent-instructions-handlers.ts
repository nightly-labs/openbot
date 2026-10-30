// The instruction file at the root of a local agent's workspace. Only the local service answers: the
// Team API does not carry the file, so a joined server's agent has none here.

import { type AgentInstructionsFile, parseSaveAgentInstructionsInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import {
  type AgentInstructionsFileFailed,
  type AgentInstructionsFileRefused,
  readAgentInstructionsFile,
  saveAgentInstructionsFile,
} from "../../backend/agent/workspace-instructions";
import type { AgentService } from "../../backend/agent-service";
import { parseAgentId } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { oneAtATimePerKey } from "./one-at-a-time";

export interface AgentInstructionsIpcDependencies {
  service: AgentService;
}

const REFUSED_MESSAGES = {
  "too-large": "error.agent.instructionsTooLarge",
  outside: "error.agent.instructionsOutside",
  changed: "error.agent.instructionsChanged",
} as const satisfies Record<AgentInstructionsFileRefused["reason"], string>;

/** The page gets a message for each failure, never the native one, which names paths. */
async function run(
  operation: Effect.Effect<AgentInstructionsFile, AgentInstructionsFileRefused | AgentInstructionsFileFailed>,
): Promise<AgentInstructionsFile> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isSuccess(result)) return result.success;
  const failure = result.failure;
  if (failure._tag === "AgentInstructionsFileRefused") throw new Error(sourceText(REFUSED_MESSAGES[failure.reason]));
  throw new Error(
    sourceText(
      failure.operation === "read" ? "error.agent.instructionsReadFailed" : "error.agent.instructionsSaveFailed",
    ),
  );
}

export function agentInstructionsIpcHandlers({
  service,
}: AgentInstructionsIpcDependencies): Pick<IpcGroupHandlers, "agentInstructions"> {
  // An autosave and a save on blur can overlap. One at a time for each agent, so the last text wins.
  const oneAtATime = oneAtATimePerKey();

  function workspace(agentId: string): string {
    const agent = service.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.agent.gone"));
    return agent.workspacePath;
  }

  return {
    agentInstructions: {
      readAgentInstructions: payloadHandler(parseAgentId, (agentId) =>
        run(readAgentInstructionsFile(workspace(agentId))),
      ),
      saveAgentInstructions: payloadHandler(parseSaveAgentInstructionsInput, ({ agentId, text, expected }) =>
        oneAtATime(agentId, () => run(saveAgentInstructionsFile(workspace(agentId), text, expected))),
      ),
    },
  };
}
