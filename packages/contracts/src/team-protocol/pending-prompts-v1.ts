import { INPUT_LIMITS } from "../input-limits";
import { AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT, type AgentRuntimePrompt, isRuntimePrompt } from "../ipc-agent-runtime";
import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const PENDING_PROMPTS_CAPABILITY = "pending-prompts-v1";

export const PENDING_PROMPTS_ROUTES = {
  list: "/v1/agent-prompts/list",
} as const;

export const PENDING_PROMPTS_LIMIT = 200;

const PENDING_PROMPTS_BYTES_LIMIT = AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT;

const requestId: AdminDecoder = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isString(value) && value.length > 0 && value.length <= 128) return value;
  throw new Error("Invalid prompt request ID.");
};

const option = fields({ label: string(1_000), description: string(1_000) });

const question = fields(
  {
    id: identifier,
    header: string(1_000),
    question: string(1_000),
    isSecret: boolean,
    options: nullable(list(option, INPUT_LIMITS.promptOptions)),
  },
  { detail: string(1_000), multiSelect: boolean },
);

const prompt = fields(
  {
    requestId,
    agentId: identifier,
    threadId: identifier,
    turnId: identifier,
    questions: list(question, INPUT_LIMITS.promptQuestions),
  },
  { detached: boolean },
);

export const PENDING_PROMPTS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PENDING_PROMPTS_ROUTES.list, adminRoute(empty, fields({ prompts: list(prompt, PENDING_PROMPTS_LIMIT) }))],
]);

export function decodePendingPromptsResponse(value: unknown): AgentRuntimePrompt[] {
  if (!isDynamicRecord(value) || !Array.isArray(value.prompts)) throw new Error("Invalid pending prompts.");
  return value.prompts.filter(isRuntimePrompt);
}

export function pendingPromptsWithinLimits(prompts: readonly AgentRuntimePrompt[]): AgentRuntimePrompt[] {
  const encoder = new TextEncoder();
  const kept: AgentRuntimePrompt[] = [];
  let bytes = 0;
  for (const prompt of prompts.slice(0, PENDING_PROMPTS_LIMIT)) {
    bytes += encoder.encode(JSON.stringify(prompt)).byteLength;
    if (bytes > PENDING_PROMPTS_BYTES_LIMIT) break;
    kept.push(prompt);
  }
  return kept;
}
