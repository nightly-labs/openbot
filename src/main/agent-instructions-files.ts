// The instruction file at the root of an agent's workspace on this computer. The desktop page and the
// `agent-instructions-v1` host route use it, so a remote admin reads and saves the same file.

import type { AgentInstructionsFile, SaveAgentInstructionsInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import {
  type AgentInstructionsFileFailed,
  type AgentInstructionsFileRefused,
  agentInstructionsRevealPath,
  readAgentInstructionsFile,
  saveAgentInstructionsFile,
} from "../backend/agent/workspace-instructions";
import type { AgentService } from "../backend/agent-service";
import { oneAtATimePerKey } from "./ipc/one-at-a-time";

/** The file refuses the save, such as a text that changed since the edit started. Its text is a sentence. */
export class AgentInstructionsRefusedError extends Error {}

const REFUSED_MESSAGES = {
  "too-large": "error.agent.instructionsTooLarge",
  outside: "error.agent.instructionsOutside",
  changed: "error.agent.instructionsChanged",
} as const satisfies Record<AgentInstructionsFileRefused["reason"], string>;

/** The caller gets a message for each failure, never the native one, which names paths. */
async function run<A>(
  operation: Effect.Effect<A, AgentInstructionsFileRefused | AgentInstructionsFileFailed>,
): Promise<A> {
  const result = await Effect.runPromise(Effect.result(operation));
  if (Result.isSuccess(result)) return result.success;
  const failure = result.failure;
  if (failure._tag === "AgentInstructionsFileRefused")
    throw new AgentInstructionsRefusedError(sourceText(REFUSED_MESSAGES[failure.reason]));
  throw new Error(
    sourceText(
      failure.operation === "read" ? "error.agent.instructionsReadFailed" : "error.agent.instructionsSaveFailed",
    ),
  );
}

export interface AgentInstructionsFiles {
  listAgents(): readonly { id: string }[];
  read(agentId: string): Promise<AgentInstructionsFile>;
  save(input: SaveAgentInstructionsInput): Promise<AgentInstructionsFile>;
  /** The path to show in the file manager. Only this computer shows it. */
  revealPath(agentId: string): Promise<string>;
}

export function createAgentInstructionsFiles(
  service: Pick<AgentService, "listAgents" | "instructionsSaving">,
): AgentInstructionsFiles {
  // A save in the editor, an Undo in the chat and a save from a joined device can overlap. One at a
  // time for each agent, so each save compares with the text that the save before it wrote.
  const oneAtATime = oneAtATimePerKey();

  function workspace(agentId: string): string {
    const agent = service.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.agent.gone"));
    return agent.workspacePath;
  }

  return {
    listAgents: () => service.listAgents(),
    read: (agentId) => run(readAgentInstructionsFile(workspace(agentId))),
    save: ({ agentId, text, expected }) =>
      oneAtATime(agentId, async () => {
        const path = workspace(agentId);
        const done = service.instructionsSaving(agentId, text);
        let written = false;
        try {
          const file = await run(saveAgentInstructionsFile(path, text, expected));
          written = true;
          return file;
        } finally {
          done(written);
        }
      }),
    revealPath: (agentId) => run(agentInstructionsRevealPath(workspace(agentId))),
  };
}
