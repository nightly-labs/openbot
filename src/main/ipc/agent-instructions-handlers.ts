// The instruction file at the root of a local agent's workspace. Only the local service answers: the
// Team API does not carry the file, so a joined server's agent has none here.

import { type AgentInstructionsFile, parseSaveAgentInstructionsInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
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

/** The page gets a message for each failure, never the native one, which names paths. */
function run(
  operation: Effect.Effect<AgentInstructionsFile, AgentInstructionsFileRefused | AgentInstructionsFileFailed>,
): Promise<AgentInstructionsFile> {
  return Effect.runPromise(
    operation.pipe(
      Effect.catchTags({
        AgentInstructionsFileRefused: (refused) =>
          Effect.die(
            new Error(
              sourceText(
                refused.reason === "too-large" ? "error.agent.instructionsTooLarge" : "error.agent.instructionsOutside",
              ),
            ),
          ),
        AgentInstructionsFileFailed: (failed) =>
          Effect.die(
            new Error(
              sourceText(
                failed.operation === "read"
                  ? "error.agent.instructionsReadFailed"
                  : "error.agent.instructionsSaveFailed",
              ),
            ),
          ),
      }),
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
      saveAgentInstructions: payloadHandler(parseSaveAgentInstructionsInput, ({ agentId, text }) =>
        oneAtATime(agentId, () => run(saveAgentInstructionsFile(workspace(agentId), text))),
      ),
    },
  };
}
