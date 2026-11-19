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

export class AgentInstructionsRefusedError extends Error {}

const REFUSED_MESSAGES = {
  "too-large": "error.agent.instructionsTooLarge",
  outside: "error.agent.instructionsOutside",
  changed: "error.agent.instructionsChanged",
} as const satisfies Record<AgentInstructionsFileRefused["reason"], string>;

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
  revealPath(agentId: string): Promise<string>;
}

export function createAgentInstructionsFiles(
  service: Pick<AgentService, "listAgents" | "instructionsSaving">,
): AgentInstructionsFiles {
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
