import { parseFeedbackPhone } from "@openbot/contracts/feedback";
import { PHONE_FEEDBACK_CAPABILITY, PHONE_FEEDBACK_ROUTES } from "@openbot/contracts/team-protocol/phone-feedback-v1";
import { sourceText } from "@openbot/i18n/source";
import { ForbiddenAttentionAnswer, InactiveAttentionRequest } from "../../backend/agent/inactive-attention-request";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { promptRequestId, readJson, requireAgentLevel } from "./request-helpers";

/**
 * Sends a bug report about the phone app that an agent waits on, with the data that only the phone
 * has: its system, its app version, its device and the last lines of its support log. It answers
 * the approval with "accept"; the agent service refuses a plain "accept" of such a report, so no
 * report about the phone app goes out without this data. The request acts for its agent, so it
 * needs `chat` on it, and only the owner can send, as for each feedback approval. A request that
 * no longer waits, or that is not a report about the phone app, gets 409. Frozen by
 * `phone-feedback-v1`.
 */
export async function routePhoneFeedback(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "agentIdForRequest" | "respondToApproval">,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, empty } = context;
  if (method !== "POST" || url.pathname !== PHONE_FEEDBACK_ROUTES.send) return "unmatched";
  if (!capabilities.has(PHONE_FEEDBACK_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.phoneFeedbackUnsupported"));
  // `readJson` has already run the body through the phone-feedback wire codec.
  const body = await readJson(request);
  const requestId = promptRequestId(body.requestId);
  const phone = parseFeedbackPhone(body.phone);
  if (!phone) throw new HttpError(400, "phone is invalid.");
  const agentId = agents.agentIdForRequest(requestId);
  if (agentId !== undefined) {
    if (context.agentLevel(agentId) === "none") throw new HttpError(404, sourceText("error.team.agentNotFound"));
    requireAgentLevel(context, agentId, "chat");
  }
  await runCauseEffect(
    agents.respondToApproval({ requestId, decision: "accept" }, { owner: member.role === "owner", phone }),
  ).catch((error: unknown) => {
    if (error instanceof ForbiddenAttentionAnswer) throw new HttpError(403, error.message);
    if (error instanceof InactiveAttentionRequest) throw new HttpError(409, error.message);
    throw error;
  });
  return empty(204);
}
