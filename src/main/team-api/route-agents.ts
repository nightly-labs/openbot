import { readFile } from "node:fs/promises";
import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  BROWSER_SECRET_RESPONSE_PATH,
  type CreateAgentInput,
  canAdministerServer,
  type DuplicateAgentResult,
  parseAgentAnalyticsInput,
  parseBrowserSecretResponse,
  parseGenerateAgentProfile,
  parseHostAnalyticsInput,
  parseSaveAgentProfile,
  WORKFLOWS_USAGE_ID,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_WELCOME_CAPABILITY } from "@openbot/contracts/team-protocol/agent-welcome-v1";
import {
  BROWSER_SECRET_VAULT_CAPABILITY,
  BROWSER_SECRET_VAULT_ROUTES,
} from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import {
  PROVIDER_MODEL_SOURCE_CAPABILITY,
  PROVIDER_MODEL_SOURCE_ROUTES,
} from "@openbot/contracts/team-protocol/provider-model-source-v1";
import { SKILL_PROBLEMS_CAPABILITY } from "@openbot/contracts/team-protocol/skill-problems-v1";
import { V5_AGENT_MODEL } from "@openbot/contracts/team-protocol/v5-adapter";
import { V6_AGENT_MODEL } from "@openbot/contracts/team-protocol/v6-adapter";
import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import type { AgentDuplicationFailed } from "../../backend/agent/duplication-gate";
import { ForbiddenAttentionAnswer, InactiveAttentionRequest } from "../../backend/agent/inactive-attention-request";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseSidebarLayoutAction } from "../ipc/agent-inputs";
import type { ModelVisibility } from "../model-visibility";
import type { TeamApiAgents, TeamApiLibraryFolders, TeamApiOptions, TeamApiSidebarLayout } from "./dependencies";
import { HttpError } from "./http-error";
import { hiddenProviderAgentIds, isPeerHiddenProvider } from "./provider-visibility";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import {
  agentCreate,
  agentUpdate,
  approvalDecision,
  browserTakeoverDecision,
  markerExclusionsForCapabilities,
  memberSender,
  pageLimit,
  pathIdentifier,
  promptAnswers,
  promptRequestId,
  readBinary,
  readJson,
  requireAdmin,
  requireAgentLevel,
  stringField,
} from "./request-helpers";
import { routeAgentConversation } from "./route-agent-conversation";
import { routeAgentMemories } from "./route-agent-memories";
import { routeAgentQueue } from "./route-agent-queue";
import { routeAgentRoutines } from "./route-agent-routines";
import { searchPageWithinFrame } from "./route-thread-message-search";

export interface AgentRouteDependencies {
  agents: TeamApiAgents;
  skills?: TeamApiOptions["skills"];
  sidebarLayout: Pick<TeamApiSidebarLayout, "getSnapshot" | "mutate" | "removeAgent" | "withProfileAssignment">;
  libraryFolders?: Pick<TeamApiLibraryFolders, "removeAgent"> | undefined;
  duplicateAgent: (agentId: string, operationId: string) => Effect.Effect<DuplicateAgentResult, AgentDuplicationFailed>;
  visibleModels?: Pick<ModelVisibility, "picker">;
}

export async function routeAgents(
  context: TeamApiRequestContext,
  { agents, skills, sidebarLayout, libraryFolders, duplicateAgent, visibleModels }: AgentRouteDependencies,
): Promise<RouteOutcome> {
  const { method, url, request, response, member, capabilities, json, empty } = context;
  const hidden = hiddenProviderAgentIds(agents.listAgents(), context.protocol);
  function requireCompatibleDefault(): void {
    if (context.protocol < 4 && agents.preferredProvider() === "opencode") {
      throw new HttpError(400, sourceText("error.team.defaultProviderRequiresV4"));
    }
  }
  function requireVisibleProvider(input: Pick<CreateAgentInput, "provider" | "model"> = {}): void {
    if (input.provider !== undefined) {
      if (isPeerHiddenProvider(input.provider, context.protocol)) throw new HttpError(400, "provider is invalid.");
      return;
    }
    const provider = agents.newAgentProvider(input);
    if (provider && isPeerHiddenProvider(provider, context.protocol)) {
      throw new HttpError(400, sourceText("error.team.newAgentProviderLocalOnly"));
    }
  }
  function requireVisible(id: string | undefined | null): void {
    if (id && hidden.has(id)) throw new HttpError(404, sourceText("error.team.agentNotFound"));
  }
  function requireRequestAgent(agentId: string | undefined): void {
    if (agentId === undefined) return;
    if (context.agentLevel(agentId) === "none") throw new HttpError(404, sourceText("error.team.agentNotFound"));
    requireAgentLevel(context, agentId, "chat");
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
    const workflows = capabilities.has(WORKFLOWS_CAPABILITY);
    if (
      input.agentId &&
      !(workflows && input.agentId === WORKFLOWS_USAGE_ID) &&
      !agents.listAgents().some((agent) => agent.id === input.agentId)
    )
      throw new HttpError(404, sourceText("error.team.agentNotFound"));
    const { skills: _localOnly, ...report } = agents.getHostAnalytics(input);
    return json(
      200,
      workflows ? report : { ...report, agents: report.agents.filter((row) => row.agentId !== WORKFLOWS_USAGE_ID) },
    );
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
      requireVisibleProvider();
    }
    if (url.pathname === TEAM_API_ROUTES.agents.generateProfile) {
      return json(
        200,
        await runCauseEffect(
          agents.generateProfile(parseGenerateAgentProfile(body), sidebarLayout.getSnapshot().sections),
        ),
      );
    }
    return json(
      200,
      await runCauseEffect(agents.saveProfile(parseSaveAgentProfile(body), sidebarLayout, memberSender(member))),
    );
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.messages.search) {
    const query = url.searchParams.get("q") ?? "";
    if (!query.trim() || query.length > INPUT_LIMITS.messageText) {
      throw new HttpError(400, sourceText("error.team.searchQueryRequired"));
    }
    const agentId = url.searchParams.get("botId") ?? undefined;
    const cursor = url.searchParams.get("cursor") ?? undefined;
    return json(
      200,
      searchPageWithinFrame(
        (limit) => agents.searchConversationMessages(query, agentId, cursor, limit),
        pageLimit(url),
      ),
    );
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.agents.status) {
    return json(200, agents.getStatus());
  }
  if (method === "POST" && url.pathname === PROVIDER_MODEL_SOURCE_ROUTES.list) {
    if (!capabilities.has(PROVIDER_MODEL_SOURCE_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.providerModelSourceUnsupported"));
    await readJson(request);
    const sources = (agents.getStatus().providers ?? []).flatMap((row) =>
      row.modelSource ? [{ provider: row.id, source: row.modelSource }] : [],
    );
    return json(200, { sources });
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.sidebarLayout.state) {
    return json(200, sidebarLayout.getSnapshot());
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.sidebarLayout.actions) {
    const action = parseSidebarLayoutAction(await readJson(request));
    if ("agentId" in action) requireVisible(action.agentId);
    if ("beforeAgentId" in action) requireVisible(action.beforeAgentId);
    const layout = await runCauseEffect(sidebarLayout.mutate(action, agents.sidebarChatIds()));
    return json(200, layout);
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.agents.usage) {
    const usage = await runCauseEffect(agents.getUsage());
    return json(200, { ...usage, limits: usage.limits.filter((limit) => limit.accountId === undefined) });
  }
  if (method === "GET" && url.pathname === TEAM_API_ROUTES.agents.models) {
    const modelId = context.protocol < 6 ? V5_AGENT_MODEL : V6_AGENT_MODEL;
    const models = (await agents.listModels())
      .filter((model) => modelId.test(model.id))
      .map(({ steersTurns: _steersTurns, ...model }) => model);
    if (!visibleModels) return json(200, models);
    const listed = await runCauseEffect(visibleModels.picker(models));
    return json(
      200,
      listed.map(({ listing: _listing, ...model }) => model),
    );
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
    requireVisibleProvider(input);
    const welcome = capabilities.has(AGENT_WELCOME_CAPABILITY);
    return json(
      201,
      await runCauseEffect(agents.createAgent(input, undefined, undefined, memberSender(member), welcome)),
    );
  }

  const agentMatch = url.pathname.match(/^\/v1\/agents\/([^/]+)(?:\/(.*))?$/);
  if (agentMatch) {
    const agentId = pathIdentifier(agentMatch[1], "agentId");
    const action = agentMatch[2] ?? "";
    if (method !== "GET" && !(method === "DELETE" && !action))
      requireAgentLevel(context, agentId, agentWriteLevel(action));
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
      return json(200, await runCauseEffect(agents.getUsage(agentId)));
    }
    if (method === "GET" && action === "skills") {
      const problems = capabilities.has(SKILL_PROBLEMS_CAPABILITY);
      return json(200, skills ? await runCauseEffect(skills.listInstalledForChatTags(agentId, { problems })) : []);
    }
    if (method === "PATCH" && !action) {
      const input = agentUpdate(await readJson(request), agentId);
      if (input.provider !== undefined) requireVisibleProvider({ provider: input.provider });
      return json(200, await runCauseEffect(agents.updateAgent(input, undefined, false)));
    }
    if (method === "POST" && action === "duplicate") {
      const body = await readJson(request);
      return json(201, await runCauseEffect(duplicateAgent(agentId, stringField(body, "operationId"))));
    }
    if (method === "DELETE" && !action) {
      if (!canAdministerServer(member.role))
        throw new HttpError(403, sourceText("error.team.membersCannotDeleteAgents"));
      try {
        await runCauseEffect(agents.deleteAgent(agentId));
      } catch (error) {
        if (error instanceof Error && DELETE_REFUSALS().includes(error.message))
          throw new HttpError(409, error.message);
        throw error;
      }
      await runCauseEffect(sidebarLayout.removeAgent(agentId));
      if (libraryFolders) await runCauseEffect(libraryFolders.removeAgent(agentId));
      return empty(204);
    }
    if (action === "avatar") {
      if (method === "PUT") {
        const mimeType = request.headers["content-type"]?.split(";", 1)[0]?.trim() ?? "";
        if (!isAvatarMimeType(mimeType)) {
          throw new HttpError(415, sourceText("error.team.avatarType"));
        }
        const bytes = await readBinary(request, AVATAR_IMAGE_LIMITS.storedBytes);
        return json(200, await runCauseEffect(agents.setAvatar(agentId, { mimeType, bytes })));
      }
      if (method === "DELETE") {
        return json(200, await runCauseEffect(agents.setAvatar(agentId, null)));
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
    const requestId = promptRequestId(body.requestId);
    requireRequestAgent(agents.agentIdForRequest(requestId));
    const sender = memberSender(member);
    await runCauseEffect(
      agents.respondToPrompt(
        { requestId, answers: promptAnswers(body.answers) },
        { ...(sender ? { sender } : {}), privileged: member.role !== "member" },
      ),
    ).catch(refusedPromptAnswer);
    return empty(204);
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.respond.approval) {
    const body = await readJson(request);
    const requestId = promptRequestId(body.requestId);
    requireRequestAgent(agents.agentIdForRequest(requestId));
    await runCauseEffect(
      agents.respondToApproval(
        { requestId, decision: approvalDecision(body.decision) },
        { owner: member.role === "owner" },
      ),
    ).catch(refusedPromptAnswer);
    return empty(204);
  }
  if (method === "POST" && url.pathname === BROWSER_SECRET_RESPONSE_PATH) {
    if (!capabilities.has("browser-secret-handoff"))
      throw new HttpError(400, sourceText("error.team.secureAuthUnsupported"));
    const input = parseBrowserSecretResponse(await readJson(request));
    requireRequestAgent(input.agentId);
    await runCauseEffect(agents.respondToBrowserSecret(input));
    return empty(204);
  }
  if (method === "POST" && url.pathname === BROWSER_SECRET_VAULT_ROUTES.respond) {
    if (!capabilities.has("browser-secret-handoff"))
      throw new HttpError(400, sourceText("error.team.secureAuthUnsupported"));
    if (!capabilities.has(BROWSER_SECRET_VAULT_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.vaultUnsupported"));
    requireAdmin(member);
    const input = parseBrowserSecretResponse({ ...(await readJson(request)), decision: "submit" });
    requireRequestAgent(input.agentId);
    await runCauseEffect(agents.respondToBrowserSecret({ ...input, saveToVault: true }));
    return json(200, {});
  }
  if (method === "POST" && url.pathname === TEAM_API_ROUTES.respond.browserTakeover) {
    const body = await readJson(request);
    const requestId = promptRequestId(body.requestId);
    requireRequestAgent(agents.agentIdForRequest(requestId));
    await runCauseEffect(
      agents.respondToBrowserTakeover(
        {
          requestId,
          decision: browserTakeoverDecision(body.decision),
        },
        true,
      ),
    );
    return empty(204);
  }

  return "unmatched";
}

const OWN_ACTIONS = new Set(["conversation/read", "conversation/unread"]);
const CHAT_ACTIONS = new Set([
  "messages",
  "reactions",
  "interrupt",
  "failures/acknowledge",
  "queue/edit",
  "queue/cancel",
  "queue/steer",
  "queue/update",
  "queue/reorder",
]);

function agentWriteLevel(action: string): "view" | "chat" | "manage" {
  if (OWN_ACTIONS.has(action)) return "view";
  return CHAT_ACTIONS.has(action) ? "chat" : "manage";
}

function inactiveAsConflict(error: unknown): never {
  if (error instanceof InactiveAttentionRequest) throw new HttpError(409, error.message);
  throw error;
}

function refusedPromptAnswer(error: unknown): never {
  if (error instanceof ForbiddenAttentionAnswer) throw new HttpError(403, error.message);
  return inactiveAsConflict(error);
}

const DELETE_REFUSALS = () => [sourceText("error.agent.stopBeforeDelete"), sourceText("error.agent.deletionBusy")];
