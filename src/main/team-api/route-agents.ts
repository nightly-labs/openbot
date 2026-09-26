import {
  BROWSER_SECRET_RESPONSE_PATH,
  parseAgentAnalyticsInput,
  parseBrowserSecretResponse,
  parseGenerateAgentProfile,
  parseHostAnalyticsInput,
  parseSaveAgentProfile,
} from "@openbot/contracts/ipc";
import { hiddenProviderAgentIds, isPeerHiddenProvider } from "./provider-visibility";
// Agents: the collection, the sidebar that arranges them, and everything under one agent's id.
//
// The order in this file is the one thing about it that is not free. The static collection paths -
// `/v1/agents/status`, `usage`, `models`, `conversation-reads` - are matched before the parametric
// regex, which would otherwise read `status` as an agent id and answer 404 for a route that exists.
// Keeping them in the same file as the regex is what makes that ordering reviewable; splitting them
// apart is how it gets broken.
//
// `agentId` is decoded once, above the action switch, and handed to the four sub-modules as an
// `AgentRouteTarget`. A sub-module that re-derived it below its own method check would turn today's
// 400 on a malformed identifier into a 404 for some methods and not others.

import { readFile } from "node:fs/promises";
import type { AgentProviderId } from "@openbot/contracts/agent-providers";
import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { DuplicateAgentResult } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { sourceText } from "@openbot/i18n/source";
import { parseSidebarLayoutAction } from "../ipc/agent-inputs";
import type { TeamApiAgents, TeamApiOptions, TeamApiSidebarLayout } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import {
  agentCreate,
  agentUpdate,
  approvalDecision,
  browserTakeoverDecision,
  markerExclusionsForCapabilities,
  pageLimit,
  pathIdentifier,
  promptAnswers,
  promptRequestId,
  readBinary,
  readJson,
  stringField,
} from "./request-helpers";
import { routeAgentConversation } from "./route-agent-conversation";
import { routeAgentMemories } from "./route-agent-memories";
import { routeAgentQueue } from "./route-agent-queue";
import { routeAgentRoutines } from "./route-agent-routines";

export interface AgentRouteDependencies {
  // The whole service, unlike every other module here, because this one forwards it to four
  // sub-modules that between them reach most of it. The narrowing that means something is theirs.
  agents: TeamApiAgents;
  skills?: TeamApiOptions["skills"];
  sidebarLayout: Pick<TeamApiSidebarLayout, "getSnapshot" | "mutate" | "removeAgent" | "withProfileAssignment">;
  duplicateAgent: (agentId: string, operationId: string) => Promise<DuplicateAgentResult>;
}

export async function routeAgents(
  context: TeamApiRequestContext,
  { agents, skills, sidebarLayout, duplicateAgent }: AgentRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, response, member, capabilities, json, empty } = context;
  const hidden = hiddenProviderAgentIds(agents.listAgents(), context.protocol);
  function requireCompatibleDefault(): void {
    if (context.protocol < 4 && agents.preferredProvider() === "opencode") {
      throw new HttpError(400, sourceText("error.team.defaultProviderRequiresV4"));
    }
  }
  /**
   * A peer cannot start an agent on a provider that its protocol does not show: the agent would be
   * hidden from the peer that made it. With no named provider, the host default applies.
   */
  function requireVisibleProvider(named: AgentProviderId | undefined): void {
    if (named !== undefined) {
      if (isPeerHiddenProvider(named, context.protocol)) throw new HttpError(400, "provider is invalid.");
    } else if (isPeerHiddenProvider(agents.preferredProvider(), context.protocol)) {
      throw new HttpError(400, sourceText("error.team.providersUnsupported"));
    }
  }
  function requireVisible(id: string | undefined | null): void {
    if (id && hidden.has(id)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  }

  if (method === "GET" && url.pathname === TEAM_API_ROUTES.analytics) {
    if (!capabilities.has("host-analytics"))
      throw new HttpError(400, sourceText("error.team.hostAnalyticsUnsupported"));
    const input = parseHostAnalyticsInput({
      ...(url.searchParams.has("agentId") ? { agentId: url.searchParams.get("agentId") } : {}),
      startDate: url.searchParams.get("startDate"),
      endDate: url.searchParams.get("endDate"),
      timeZone: url.searchParams.get("timeZone"),
    });
    if (input.agentId && !agents.listAgents().some((agent) => agent.id === input.agentId))
      throw new HttpError(404, sourceText("error.team.agentNotFound"));
    return json(200, agents.getHostAnalytics(input));
  }
  if (
    method === "POST" &&
    (url.pathname === TEAM_API_ROUTES.agents.generateProfile || url.pathname === TEAM_API_ROUTES.agents.saveProfile)
  ) {
    if (!capabilities.has("agent-profile-generation"))
      throw new HttpError(400, sourceText("error.team.profileGenerationUnsupported"));
    const body = await readJson(request);
    if (typeof body.agentId === "string") requireVisible(body.agentId);
    else {
      requireCompatibleDefault();
      requireVisibleProvider(undefined);
    }
    if (url.pathname === TEAM_API_ROUTES.agents.generateProfile) {
      return json(
        200,
        await agents.generateProfile(parseGenerateAgentProfile(body), sidebarLayout.getSnapshot().sections),
      );
    }
    return json(200, await agents.saveProfile(parseSaveAgentProfile(body), sidebarLayout));
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.messages.search) {
    const query = url.searchParams.get("q") ?? "";
    if (!query.trim() || query.length > INPUT_LIMITS.messageText) {
      throw new HttpError(400, sourceText("error.team.searchQueryRequired"));
    }
    return json(
      200,
      agents.searchConversationMessages(
        query,
        // A query parameter is part of the released URL, and the versioned adapters translate JSON
        // bodies only. `botId` is what every shipped client sends and what every shipped host reads.
        url.searchParams.get("botId") ?? undefined,
        url.searchParams.get("cursor") ?? undefined,
        pageLimit(url),
      ),
    );
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.agents.status) {
    return json(200, agents.getStatus());
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.sidebarLayout.state) {
    return json(200, sidebarLayout.getSnapshot());
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.sidebarLayout.actions) {
    const action = parseSidebarLayoutAction(await readJson(request));
    if ("agentId" in action) requireVisible(action.agentId);
    if ("beforeAgentId" in action) requireVisible(action.beforeAgentId);
    const layout = await sidebarLayout.mutate(action, agents.sidebarChatIds());
    return json(200, layout);
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.agents.usage) {
    return json(200, await agents.getUsage());
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.agents.models) {
    return json(200, await agents.listModels());
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.agents.all) {
    return json(200, agents.listAgents());
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.agents.conversationReads) {
    return json(200, agents.listConversationReads(member.id, markerExclusionsForCapabilities(capabilities)));
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.agents.all) {
    requireCompatibleDefault();
    const input = agentCreate(await readJson(request));
    requireVisibleProvider(input.provider);
    return json(201, await agents.createAgent(input));
  }

  const agentMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)(?:\/(.*))?$/);
  if (agentMatch) {
    const agentId = pathIdentifier(agentMatch[1], "agentId");
    const action = agentMatch[2] ?? "";
    if (method === "GET" && action === "analytics") {
      if (!capabilities.has("agent-analytics"))
        throw new HttpError(400, sourceText("error.team.agentAnalyticsUnsupported"));
      if (!agents.listAgents().some((agent) => agent.id === agentId))
        throw new HttpError(404, sourceText("error.team.agentNotFound"));
      const input = parseAgentAnalyticsInput({
        agentId,
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        timeZone: url.searchParams.get("timeZone"),
      });
      return json(200, agents.getAnalytics(input));
    }
    if (method === "GET" && action === "usage") {
      return json(200, await agents.getUsage(agentId));
    }
    if (method === "GET" && action === "skills") {
      return json(200, (await skills?.listInstalledForChatTags(agentId)) ?? []);
    }
    if (method === "PATCH" && !action) {
      const input = agentUpdate(await readJson(request), agentId);
      if (input.provider !== undefined) requireVisibleProvider(input.provider);
      return json(200, await agents.updateAgent(input));
    }
    if (method === "POST" && action === "duplicate") {
      const body = await readJson(request);
      return json(201, await duplicateAgent(agentId, stringField(body, "operationId")));
    }
    if (method === "DELETE" && !action) {
      if (member.role === "member") throw new HttpError(403, sourceText("error.team.membersCannotDeleteAgents"));
      await agents.deleteAgent(agentId);
      await sidebarLayout.removeAgent(agentId);
      return empty(204);
    }
    if (action === "avatar") {
      if (method === "PUT") {
        const mimeType = request.headers["content-type"]?.split(";", 1)[0]?.trim() ?? "";
        if (!isAvatarMimeType(mimeType)) {
          throw new HttpError(415, sourceText("error.team.avatarType"));
        }
        const bytes = await readBinary(request, AVATAR_IMAGE_LIMITS.storedBytes);
        return json(200, await agents.setAvatar(agentId, { mimeType, bytes }));
      }
      if (method === "DELETE") {
        return json(200, await agents.setAvatar(agentId, null));
      }
      if (method === "GET") {
        const avatar = agents.resolveAvatar(agentId);
        if (!avatar || avatar.version !== url.searchParams.get("v")) {
          throw new HttpError(404, sourceText("error.team.avatarNotFound"));
        }
        const bytes = await readFile(avatar.path);
        response.writeHead(200, {
          "Content-Type": avatar.mimeType,
          "Content-Length": String(bytes.length),
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(bytes);
        return "handled";
      }
    }

    const target = { agentId, action };
    if ((await routeAgentMemories(context, target, { agents })) === "handled") return "handled";
    if ((await routeAgentRoutines(context, target, { agents })) === "handled") return "handled";
    if ((await routeAgentConversation(context, target, { agents })) === "handled") return "handled";
    if ((await routeAgentQueue(context, target, { agents })) === "handled") return "handled";
  }

  if (method === "POST" && url.pathname === TEAM_API_ROUTES.respond.prompt) {
    const body = await readJson(request);
    await agents.respondToPrompt({
      requestId: promptRequestId(body.requestId),
      answers: promptAnswers(body.answers),
    });
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.respond.approval) {
    const body = await readJson(request);
    await agents.respondToApproval({
      requestId: promptRequestId(body.requestId),
      decision: approvalDecision(body.decision),
    });
    return empty(204);
  }
  if (method === "POST" && url.pathname === BROWSER_SECRET_RESPONSE_PATH) {
    if (!capabilities.has("browser-secret-handoff"))
      throw new HttpError(400, sourceText("error.team.secureAuthUnsupported"));
    await agents.respondToBrowserSecret(parseBrowserSecretResponse(await readJson(request)));
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.respond.browserTakeover) {
    const body = await readJson(request);
    await agents.respondToBrowserTakeover({
      requestId: promptRequestId(body.requestId),
      decision: browserTakeoverDecision(body.decision),
    });
    return empty(204);
  }

  return "unmatched";
}
