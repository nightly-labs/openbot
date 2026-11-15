import { ACTIVITY_INBOX_CAPABILITY, ACTIVITY_INBOX_ROUTES } from "@openbot/contracts/team-protocol/activity-inbox-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { memberSender, readJson, requireAgentLevel, stringField } from "./request-helpers";

/** The inbox is filtered to the member's visible agent threads. */
export async function routeActivityInbox(
  context: TeamApiRequestContext,
  agents: Pick<
    TeamApiAgents,
    | "listAgents"
    | "listActivityInbox"
    | "readActivityInboxItem"
    | "classifyActivityInboxItem"
    | "followupActivityInboxItem"
  >,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || !Object.values(ACTIVITY_INBOX_ROUTES).some((path) => path === url.pathname))
    return "unmatched";
  if (!capabilities.has(ACTIVITY_INBOX_CAPABILITY)) return "unmatched";
  const visibleAgentIds = agents
    .listAgents()
    .filter((agent) => !hiddenAgentIds.has(agent.id) && context.agentLevel(agent.id) !== "none")
    .map((agent) => agent.id);
  const body = await readJson(request);
  if (url.pathname === ACTIVITY_INBOX_ROUTES.list) return json(200, agents.listActivityInbox(visibleAgentIds));
  const itemId = stringField(body, "itemId");
  const item = agents.readActivityInboxItem(itemId, visibleAgentIds);
  if (!item) throw new HttpError(404, sourceText("error.team.activityInboxItemNotFound"));
  requireAgentLevel(context, item.agentId, "chat");
  if (url.pathname === ACTIVITY_INBOX_ROUTES.classify) {
    const classification = stringField(body, "classification");
    if (classification !== "reference" && classification !== "actionable")
      throw new HttpError(400, sourceText("error.team.activityInboxClassificationInvalid"));
    return json(
      200,
      await runCauseEffect(agents.classifyActivityInboxItem({ itemId, classification }, memberSender(context.member))),
    );
  }
  if (url.pathname === ACTIVITY_INBOX_ROUTES.followup) {
    return json(
      202,
      await runCauseEffect(
        agents.followupActivityInboxItem(
          {
            itemId,
            actionId: stringField(body, "actionId"),
            clientMessageId: stringField(body, "clientMessageId"),
            text: stringField(body, "text", false, 32_000),
          },
          memberSender(context.member),
        ),
      ),
    );
  }
  return "unmatched";
}
