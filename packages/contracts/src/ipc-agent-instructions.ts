import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf } from "./runtime-values";

/**
 * The instruction files at the root of an agent's workspace, in the order OpenBot reads them. The
 * first one that exists holds the agent's instructions; with none, OpenBot writes `AGENTS.md`.
 * `CLAUDE.md` is read for workspaces that an agent set up before OpenBot read `AGENTS.md`.
 */
export const AGENT_INSTRUCTION_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;
export type AgentInstructionFileName = (typeof AGENT_INSTRUCTION_FILE_NAMES)[number];

/**
 * The agent's instruction file. Local-only: the Team API does not carry it, so a joined server's
 * agent has none here. `exists` is false when no file is there yet: `text` is empty, and a save
 * writes `fileName`.
 */
export interface AgentInstructionsFile {
  fileName: AgentInstructionFileName;
  exists: boolean;
  text: string;
}

export interface SaveAgentInstructionsInput {
  agentId: string;
  text: string;
}

/**
 * The largest file, in bytes, that main reads. An agent can write a file longer than the editor
 * saves, and the editor shows all of it so that the user can shorten it.
 */
export const AGENT_INSTRUCTIONS_READ_LIMIT = INPUT_LIMITS.agentInstructionsFile * 8;

export function decodeAgentInstructionsFileFromMain(value: unknown): AgentInstructionsFile {
  if (
    !isDynamicRecord(value) ||
    !isOneOf(AGENT_INSTRUCTION_FILE_NAMES, value.fileName) ||
    typeof value.exists !== "boolean" ||
    !isBoundedString(value.text, AGENT_INSTRUCTIONS_READ_LIMIT)
  )
    throw new Error("Invalid agent instructions.");
  return { fileName: value.fileName, exists: value.exists, text: value.text };
}

export function parseSaveAgentInstructionsInput(value: unknown): SaveAgentInstructionsInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.agentId) ||
    !isBoundedString(value.text, INPUT_LIMITS.agentInstructionsFile)
  )
    throw new Error("Invalid agent instructions input.");
  return { agentId: value.agentId, text: value.text };
}
