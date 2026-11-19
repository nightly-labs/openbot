import {
  parseSetAgentDefaultChoiceInput,
  parseUpdateAgentAdminSettingsInput,
  parseUpdateAgentBackupModelsInput,
  parseUpdateAgentDefaultsInput,
  parseUpdateAgentFastModeInput,
  parseUpdateAgentHostSettingsInput,
  parseUpdateAgentNewChatInput,
  parseUpdateAgentPlanCardInput,
  parseUpdateAgentSpeedInput,
  parseUpdateAgentTaskLimitInput,
} from "@openbot/contracts/ipc";
import { AGENT_ADMIN_CAPABILITY, AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import {
  AGENT_BACKUP_MODELS_CAPABILITY,
  AGENT_BACKUP_MODELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_DEFAULTS_CAPABILITY, AGENT_DEFAULTS_ROUTES } from "@openbot/contracts/team-protocol/agent-defaults-v1";
import {
  AGENT_FAST_MODE_CAPABILITY,
  AGENT_FAST_MODE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import {
  AGENT_HOST_SETTINGS_CAPABILITY,
  AGENT_HOST_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_NEW_CHAT_CAPABILITY, AGENT_NEW_CHAT_ROUTES } from "@openbot/contracts/team-protocol/agent-new-chat-v1";
import {
  AGENT_PLAN_CARD_CAPABILITY,
  AGENT_PLAN_CARD_ROUTES,
} from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import { AGENT_SPEED_CAPABILITY, AGENT_SPEED_ROUTES } from "@openbot/contracts/team-protocol/agent-speed-v1";
import {
  AGENT_TASK_LIMIT_CAPABILITY,
  AGENT_TASK_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import { MODEL_STEERING_CAPABILITY, MODEL_STEERING_ROUTES } from "@openbot/contracts/team-protocol/model-steering-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { AgentNotFoundError } from "../agent-admin-settings";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireAgentLevel, requireVisibleBodyAgent, stringField } from "./request-helpers";

export async function routeAgentAdmin(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const read = method === "POST" && url.pathname === AGENT_ADMIN_ROUTES.settings;
  const update = method === "POST" && url.pathname === AGENT_ADMIN_ROUTES.update;
  if (!read && !update) return "unmatched";
  const settings = admin?.agents;
  if (!settings || !capabilities.has(AGENT_ADMIN_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    if (read) return json(200, settings.read(stringField(body, "agentId")));
    let input: ReturnType<typeof parseUpdateAgentAdminSettingsInput>;
    try {
      input = parseUpdateAgentAdminSettingsInput(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent settings update.");
    }
    return json(200, await runCauseEffect(settings.update(input)));
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
}

export async function routeAgentHostSettings(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const read = method === "POST" && url.pathname === AGENT_HOST_SETTINGS_ROUTES.settings;
  const update = method === "POST" && url.pathname === AGENT_HOST_SETTINGS_ROUTES.update;
  if (!read && !update) return "unmatched";
  const settings = admin?.agentHost;
  if (!settings || !capabilities.has(AGENT_HOST_SETTINGS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    if (read) return json(200, settings.read(stringField(body, "agentId")));
    let input: ReturnType<typeof parseUpdateAgentHostSettingsInput>;
    try {
      input = parseUpdateAgentHostSettingsInput(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent settings update.");
    }
    return json(200, await runCauseEffect(settings.update(input)));
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
}

export async function routeAgentBackupModels(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const read = method === "POST" && url.pathname === AGENT_BACKUP_MODELS_ROUTES.settings;
  const update = method === "POST" && url.pathname === AGENT_BACKUP_MODELS_ROUTES.update;
  if (!read && !update) return "unmatched";
  const settings = admin?.agentHost;
  if (!settings || !capabilities.has(AGENT_BACKUP_MODELS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    if (read) return json(200, settings.readBackupModels(stringField(body, "agentId")));
    let input: ReturnType<typeof parseUpdateAgentBackupModelsInput>;
    try {
      input = parseUpdateAgentBackupModelsInput(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid backup models.");
    }
    return json(200, await runCauseEffect(settings.updateBackupModels(input)));
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
}

export async function routeAgentTaskLimit(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const read = method === "POST" && url.pathname === AGENT_TASK_LIMIT_ROUTES.settings;
  const update = method === "POST" && url.pathname === AGENT_TASK_LIMIT_ROUTES.update;
  if (!read && !update) return "unmatched";
  const settings = admin?.agentHost;
  if (!settings || !capabilities.has(AGENT_TASK_LIMIT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    if (read) return json(200, settings.readTaskLimit(stringField(body, "agentId")));
    let input: ReturnType<typeof parseUpdateAgentTaskLimitInput>;
    try {
      input = parseUpdateAgentTaskLimitInput(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid task limit.");
    }
    return json(200, await runCauseEffect(settings.updateTaskLimit(input)));
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
}

export async function routeAgentNewChat(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const read = method === "POST" && url.pathname === AGENT_NEW_CHAT_ROUTES.settings;
  const update = method === "POST" && url.pathname === AGENT_NEW_CHAT_ROUTES.update;
  if (!read && !update) return "unmatched";
  const settings = admin?.agentHost;
  if (!settings || !capabilities.has(AGENT_NEW_CHAT_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    if (read) return json(200, settings.readNewChat(stringField(body, "agentId")));
    let input: ReturnType<typeof parseUpdateAgentNewChatInput>;
    try {
      input = parseUpdateAgentNewChatInput(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid new chat setting.");
    }
    return json(200, await runCauseEffect(settings.updateNewChat(input)));
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
}

export async function routeAgentPlanCard(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const read = method === "POST" && url.pathname === AGENT_PLAN_CARD_ROUTES.settings;
  const update = method === "POST" && url.pathname === AGENT_PLAN_CARD_ROUTES.update;
  if (!read && !update) return "unmatched";
  const settings = admin?.agentHost;
  if (!settings || !capabilities.has(AGENT_PLAN_CARD_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    if (read) return json(200, settings.readPlanCard(stringField(body, "agentId")));
    let input: ReturnType<typeof parseUpdateAgentPlanCardInput>;
    try {
      input = parseUpdateAgentPlanCardInput(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid plan card setting.");
    }
    return json(200, await runCauseEffect(settings.updatePlanCard(input)));
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
}

export async function routeAgentFastMode(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  const models = method === "POST" && url.pathname === AGENT_FAST_MODE_ROUTES.models;
  const read = method === "POST" && url.pathname === AGENT_FAST_MODE_ROUTES.settings;
  const update = method === "POST" && url.pathname === AGENT_FAST_MODE_ROUTES.update;
  if (!models && !read && !update) return "unmatched";
  const settings = admin?.agentHost;
  if (!settings || !capabilities.has(AGENT_FAST_MODE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  const body = await readJson(request);
  if (models) return json(200, { models: settings.listFastModels() });
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const agentId = stringField(body, "agentId");
  requireAgentLevel(context, agentId, read ? "view" : "manage");
  try {
    if (read) return json(200, settings.readFastMode(agentId));
    let input: ReturnType<typeof parseUpdateAgentFastModeInput>;
    try {
      input = parseUpdateAgentFastModeInput(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid fast mode setting.");
    }
    return json(
      200,
      await runCauseEffect(settings.updateFastMode({ agentId: input.agentId, fastMode: input.fastMode })),
    );
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
}

export async function routeAgentSpeed(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  const models = method === "POST" && url.pathname === AGENT_SPEED_ROUTES.models;
  const read = method === "POST" && url.pathname === AGENT_SPEED_ROUTES.settings;
  const update = method === "POST" && url.pathname === AGENT_SPEED_ROUTES.update;
  if (!models && !read && !update) return "unmatched";
  const settings = admin?.agentHost;
  if (!settings || !capabilities.has(AGENT_SPEED_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  const body = await readJson(request);
  if (models) return json(200, { models: settings.listSpeedModels() });
  requireVisibleBodyAgent(body, hiddenAgentIds);
  const agentId = stringField(body, "agentId");
  requireAgentLevel(context, agentId, read ? "view" : "manage");
  try {
    if (read) return json(200, settings.readSpeed(agentId));
    let input: ReturnType<typeof parseUpdateAgentSpeedInput>;
    try {
      input = parseUpdateAgentSpeedInput(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid speed setting.");
    }
    return json(200, await runCauseEffect(settings.updateSpeed(input)));
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
}

export async function routeModelSteering(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== MODEL_STEERING_ROUTES.list) return "unmatched";
  const settings = admin?.agentHost;
  if (!settings || !capabilities.has(MODEL_STEERING_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.modelVisibilityUnsupported"));
  await readJson(request);
  const models = settings.listSteeringModels();
  const visibility = admin?.modelVisibility;
  const listed = visibility ? await runCauseEffect(visibility.picker(models)) : models;
  return json(200, { models: listed.map(({ provider, id }) => ({ provider, id })) });
}

export async function routeAgentDefaults(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const read = method === "POST" && url.pathname === AGENT_DEFAULTS_ROUTES.settings;
  const update = method === "POST" && url.pathname === AGENT_DEFAULTS_ROUTES.update;
  const choice = method === "POST" && url.pathname === AGENT_DEFAULTS_ROUTES.choice;
  if (!read && !update && !choice) return "unmatched";
  const settings = admin?.agentDefaults;
  if (!settings || !capabilities.has(AGENT_DEFAULTS_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentSettingsUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  const visible = (overview: ReturnType<typeof settings.read>) => ({
    ...overview,
    agents: overview.agents.filter((agent) => !hiddenAgentIds.has(agent.agentId)),
  });
  if (read) return json(200, visible(settings.read()));
  if (update) {
    let input: ReturnType<typeof parseUpdateAgentDefaultsInput>;
    try {
      input = parseUpdateAgentDefaultsInput(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent defaults.");
    }
    return json(200, visible(await runCauseEffect(settings.update(input))));
  }
  let input: ReturnType<typeof parseSetAgentDefaultChoiceInput>;
  try {
    input = parseSetAgentDefaultChoiceInput(body);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent default choice.");
  }
  if (input.agentIds.some((agentId) => hiddenAgentIds.has(agentId)))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  try {
    return json(200, visible(await runCauseEffect(settings.setChoice(input))));
  } catch (error) {
    if (error instanceof AgentNotFoundError) throw new HttpError(404, error.message);
    throw error;
  }
}
