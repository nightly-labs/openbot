import {
  canAdministerServer,
  parseCreditsAskMutedInput,
  parseReadMediaApprovalInput,
  parseRespondToCreditsHoldInput,
  parseRespondToMediaApprovalInput,
} from "@openbot/contracts/ipc";
import {
  MEDIA_APPROVAL_CHOICE_CAPABILITY,
  MEDIA_APPROVAL_CHOICE_ROUTES,
} from "@openbot/contracts/team-protocol/media-approval-choice-v1";
import { sourceText } from "@openbot/i18n/source";
import { ForbiddenAttentionAnswer, InactiveAttentionRequest } from "../../backend/agent/inactive-attention-request";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { CreditAsksControl } from "../media-approval-credits-preference-store";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAgentLevel } from "./request-helpers";

function refusedChoice(error: unknown): never {
  if (error instanceof ForbiddenAttentionAnswer) throw new HttpError(403, error.message);
  if (error instanceof InactiveAttentionRequest) throw new HttpError(409, error.message);
  throw error;
}

function parsedBody<T>(parse: (value: unknown) => T, body: unknown): T {
  try {
    return parse(body);
  } catch {
    throw new HttpError(400, sourceText("error.team.mediaApprovalChoiceInvalid"));
  }
}

const CHOICE_PATHS = new Set<string>(Object.values(MEDIA_APPROVAL_CHOICE_ROUTES));

export async function routeMediaApprovalChoice(
  context: TeamApiRequestContext,
  agents: Pick<
    TeamApiAgents,
    "pendingMediaApproval" | "respondToMediaApproval" | "pendingCreditsHold" | "respondToCreditsHold" | "listAgents"
  >,
  hiddenAgentIds: ReadonlySet<string>,
  creditAsks: Pick<CreditAsksControl, "setMuted" | "mutedFor"> | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json, empty } = context;
  if (method !== "POST" || !CHOICE_PATHS.has(url.pathname)) return "unmatched";
  if (!capabilities.has(MEDIA_APPROVAL_CHOICE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.mediaApprovalChoiceUnsupported"));
  const body = await readJson(request);
  const canAdminister = canAdministerServer(member.role);
  if (url.pathname === MEDIA_APPROVAL_CHOICE_ROUTES.mutedRead) {
    if (!creditAsks) throw new HttpError(400, sourceText("error.team.mediaApprovalChoiceUnsupported"));
    return json(200, { muted: creditAsks.mutedFor({ id: member.id, canAdminister }) });
  }
  if (url.pathname === MEDIA_APPROVAL_CHOICE_ROUTES.muted) {
    if (!creditAsks) throw new HttpError(400, sourceText("error.team.mediaApprovalChoiceUnsupported"));
    const { muted } = parsedBody(parseCreditsAskMutedInput, body);
    await runCauseEffect(creditAsks.setMuted({ id: member.id, canAdminister }, muted));
    return empty(204);
  }
  const read = parsedBody(parseReadMediaApprovalInput, body);
  if (hiddenAgentIds.has(read.agentId) || !agents.listAgents().some((agent) => agent.id === read.agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, read.agentId, "chat");
  const responder = { owner: member.role === "owner", person: { id: member.id, canAdminister } };
  if (url.pathname === MEDIA_APPROVAL_CHOICE_ROUTES.read) {
    const offer = agents.pendingMediaApproval(read.agentId, read.requestId);
    return json(200, {
      media: offer ? { ...offer, canSetDefault: canAdminister } : null,
      hold: agents.pendingCreditsHold(read.agentId, read.requestId, canAdminister) ?? null,
    });
  }
  if (url.pathname === MEDIA_APPROVAL_CHOICE_ROUTES.hold) {
    const input = parsedBody(parseRespondToCreditsHoldInput, body);
    const hold = await runCauseEffect(agents.respondToCreditsHold(input, responder)).catch(refusedChoice);
    return json(200, { hold });
  }
  const input = parsedBody(parseRespondToMediaApprovalInput, body);
  await runCauseEffect(agents.respondToMediaApproval(input, { owner: member.role === "owner" })).catch(refusedChoice);
  return empty(204);
}
