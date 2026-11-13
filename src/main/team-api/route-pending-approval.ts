import {
  PENDING_APPROVAL_CAPABILITY,
  PENDING_APPROVAL_ROUTES,
} from "@openbot/contracts/team-protocol/pending-approval-v1";
import { sourceText } from "@openbot/i18n/source";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel, stringField } from "./request-helpers";

/**
 * The whole copy of one approval that an agent waits on. The runtime snapshot cuts its texts, so a
 * client that did not get the `approval` event reads it here before it offers Allow. A member who can
 * answer the approval (`chat`) can read it. The agent id is in the body, so the router's check of the
 * path does not see it, and this module refuses an agent hidden from the caller. Frozen by
 * `pending-approval-v1`.
 */
export async function routePendingApproval(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "pendingApproval" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== PENDING_APPROVAL_ROUTES.read) return "unmatched";
  if (!capabilities.has(PENDING_APPROVAL_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.pendingApprovalUnsupported"));
  // `readJson` has already run the body through the pending-approval wire codec.
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");
  if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, agentId, "chat");
  const requestId = body.requestId;
  const approval =
    typeof requestId === "string" || typeof requestId === "number" ? agents.pendingApproval(requestId) : undefined;
  // 409, as an answer to a closed request gets. A request of another agent is refused the same way, so a
  // member cannot read past the agent check.
  if (!approval || approval.agentId !== agentId) throw new HttpError(409, sourceText("error.backend.approvalInactive"));
  return json(200, { approval });
}
