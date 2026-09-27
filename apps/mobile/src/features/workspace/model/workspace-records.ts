import {
  type AgentSummary,
  isAgentModel,
  isAgentProvider,
  isAvatarHue,
  isReasoningEffort,
  isSidebarLayoutSnapshot,
  type SidebarLayoutSnapshot,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";

export type RemoteAgent = Pick<
  AgentSummary,
  "id" | "name" | "title" | "description" | "preview" | "updatedAt" | "avatarSeed" | "avatarHue"
> &
  Partial<Pick<AgentSummary, "provider" | "model" | "reasoningEffort" | "avatarUrl">>;

export function projectAgent(serverId: string, agent: RemoteAgent): MobileAgent {
  return {
    id: agent.id,
    serverId,
    name: agent.name,
    title: agent.title,
    description: agent.description,
    preview: agent.preview,
    updatedLabel: formatUpdatedAt(agent.updatedAt),
    provider: agent.provider,
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    avatarUrl: agent.avatarUrl ?? null,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
  };
}

export function decodeAgent(value: unknown): RemoteAgent {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !isString(value.name) ||
    !isString(value.title) ||
    !isString(value.description) ||
    !isString(value.preview) ||
    (value.updatedAt !== null && !isString(value.updatedAt)) ||
    !isString(value.avatarSeed) ||
    (value.avatarHue !== null && !isAvatarHue(value.avatarHue))
  ) {
    throw new Error("The server returned an invalid agent.");
  }
  return {
    id: value.id,
    name: value.name,
    title: value.title,
    description: value.description,
    preview: value.preview,
    updatedAt: value.updatedAt,
    provider: isAgentProvider(value.provider) ? value.provider : undefined,
    model: isAgentModel(value.model) ? value.model : undefined,
    reasoningEffort: isReasoningEffort(value.reasoningEffort) ? value.reasoningEffort : undefined,
    avatarUrl: isString(value.avatarUrl) ? value.avatarUrl : null,
    avatarSeed: value.avatarSeed,
    avatarHue: value.avatarHue,
  };
}

export function decodeAgentSummaries(value: unknown): RemoteAgent[] {
  if (!Array.isArray(value)) throw new Error("The server returned an invalid agent list.");
  return value.map(decodeAgent);
}

export function decodeConversationReads(value: unknown): Record<string, { unreadCount: number }> {
  if (!isDynamicRecord(value)) throw new Error("The server returned invalid read states.");
  const reads: Record<string, { unreadCount: number }> = {};
  for (const [agentId, readState] of Object.entries(value)) {
    if (
      !isDynamicRecord(readState) ||
      !isNumber(readState.unreadCount) ||
      !Number.isSafeInteger(readState.unreadCount) ||
      readState.unreadCount < 0
    ) {
      throw new Error("The server returned an invalid read state.");
    }
    reads[agentId] = { unreadCount: readState.unreadCount };
  }
  return reads;
}

export function ignoreResponse(): void {}

export function updateAgentPayload(input: UpdateAgentInput): TeamProtocolV2Json {
  return {
    agentId: input.agentId,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.notifications === undefined ? {} : { notifications: input.notifications }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
    ...(input.avatarSeed === undefined ? {} : { avatarSeed: input.avatarSeed }),
    ...(input.avatarHue === undefined ? {} : { avatarHue: input.avatarHue }),
  };
}

export function decodeSidebarLayout(value: unknown): SidebarLayoutSnapshot {
  if (!isSidebarLayoutSnapshot(value)) throw new Error("The server returned an invalid section layout.");
  return value;
}
