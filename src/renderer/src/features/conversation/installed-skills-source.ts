import type { ServerSummary } from "@openbot/contracts/ipc";
import { serverCanAdminister } from "../servers/server-capabilities";
import type { AgentSkillsMode } from "./AgentSkillsModal";
import type { ConversationRuntime } from "./conversation-runtime";

/** Separates the agent ids in a request key. An agent id holds no control character. */
export const SKILL_AGENT_ID_SEPARATOR = "\u0001";

export function installedSkillsRequestKey(
  agentIds: readonly string[],
  server: ServerSummary | undefined,
  marketplaceOpen: boolean,
): string {
  const supported = server?.kind !== "remote" || server.compatibility?.capabilities.includes("installed-skills");
  return `${server?.id ?? "local"}\0${agentIds.join(SKILL_AGENT_ID_SEPARATOR)}\0${supported ? "supported" : "unsupported"}\0${marketplaceOpen ? "hidden" : "visible"}`;
}

/** What the agent's skills settings offer. A web client (`runtime`) shows them to a host admin only. */
export function agentSkillsMode(
  server: ServerSummary | undefined,
  runtime: Pick<ConversationRuntime, "admin"> | undefined,
): AgentSkillsMode {
  if (runtime) return runtime.admin && serverCanAdminister(server, "skills-admin-v1") ? "host" : "hidden";
  if (server?.kind === "local") return "mutable";
  return serverCanAdminister(server, "skills-admin-v1") ? "host" : "readonly";
}
