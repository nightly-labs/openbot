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

export async function routeFeedbackWithdraw(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "withdrawFeedback" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== FEEDBACK_WITHDRAW_ROUTES.withdraw) return "unmatched";
  if (!capabilities.has(FEEDBACK_WITHDRAW_CAPABILITY))
    throw new HttpError(400, sourceText("error.backend.feedbackWithdrawRemoteUnsupported"));
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
