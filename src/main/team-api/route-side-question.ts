import { parseAskSideQuestion } from "@openbot/contracts/ipc";
import {
  SIDE_QUESTION_CAPABILITY,
  SIDE_QUESTION_ROUTES,
  SIDE_QUESTION_TEXT_LIMIT,
} from "@openbot/contracts/team-protocol/side-question-v1";
import { isFixedSourceText, sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel } from "./request-helpers";

export async function routeSideQuestion(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "askSideQuestion" | "listAgents">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== SIDE_QUESTION_ROUTES.ask) return "unmatched";
  if (!capabilities.has(SIDE_QUESTION_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.sideQuestionUnsupported"));
  const body = await readJson(request);
  let input: ReturnType<typeof parseAskSideQuestion>;
  try {
    input = parseAskSideQuestion(body);
  } catch {
    throw new HttpError(400, sourceText("error.team.requestFailed"));
  }
  if (hiddenAgentIds.has(input.agentId) || !agents.listAgents().some((agent) => agent.id === input.agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, input.agentId, "chat");
  let answer: string;
  try {
    answer = await runCauseEffect(agents.askSideQuestion(input));
  } catch (error) {
    if (error instanceof Error && isFixedSourceText(error.message)) throw new HttpError(409, error.message);
    throw error;
  }
  return json(200, { answer: answer.slice(0, SIDE_QUESTION_TEXT_LIMIT) });
}
