import {
  FEEDBACK_WITHDRAW_CAPABILITY,
  FEEDBACK_WITHDRAW_ROUTES,
} from "@openbot/contracts/team-protocol/feedback-withdraw-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseWithdrawFeedback } from "../ipc/agent-inputs";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireOwner } from "./request-helpers";

/**
 * Remove on a thank-you card in one agent's chat: the host's own account sent the report, so the host
 * takes it off GitHub. Only the owner approves a report (`send_feedback` and `withdraw_feedback` ask
 * the owner), so only the owner can press it. The agent id is in the body, so the router's check of
 * the path does not see it, and this module refuses an agent hidden from the caller. Frozen by
 * `feedback-withdraw-v1`.
 */
export async function routeFeedbackWithdraw(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "withdrawFeedback" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== FEEDBACK_WITHDRAW_ROUTES.withdraw) return "unmatched";
  if (!capabilities.has(FEEDBACK_WITHDRAW_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.feedbackWithdrawRemoteUnsupported"));
  // `readJson` has already run the body through the feedback-withdraw wire codec.
  const body = await readJson(request);
  let input: ReturnType<typeof parseWithdrawFeedback>;
  try {
    input = parseWithdrawFeedback(body);
  } catch {
    throw new HttpError(400, sourceText("error.team.requestFailed"));
  }
  if (hiddenAgentIds.has(input.agentId) || !agents.listAgents().some((agent) => agent.id === input.agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireOwner(context.member);
  const { status } = await runCauseEffect(agents.withdrawFeedback(input));
  return json(200, { status });
}
