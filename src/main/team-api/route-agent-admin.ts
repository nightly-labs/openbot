import {
  parseUpdateAgentAdminSettingsInput,
  parseUpdateAgentBackupModelsInput,
  parseUpdateAgentHostSettingsInput,
  parseUpdateAgentPlanCardInput,
  parseUpdateAgentTaskLimitInput,
} from "@openbot/contracts/ipc";
import { AGENT_ADMIN_CAPABILITY, AGENT_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/agent-admin-v1";
import {
  AGENT_BACKUP_MODELS_CAPABILITY,
  AGENT_BACKUP_MODELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import {
  AGENT_HOST_SETTINGS_CAPABILITY,
  AGENT_HOST_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import {
  AGENT_PLAN_CARD_CAPABILITY,
  AGENT_PLAN_CARD_ROUTES,
} from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import {
  AGENT_TASK_LIMIT_CAPABILITY,
  AGENT_TASK_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { AgentNotFoundError } from "../agent-admin-settings";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent, stringField } from "./request-helpers";

/**
 * Access and auto-approve of one agent, changed from a joined server. Together they are the agent's
 * Permissions level, which decides what the agent may do on this computer, so only an owner or admin
 * can read or change them. `autoApproveLocked` is always false now that Turbo mode is gone; the
 * field stays because released clients read it. Frozen by `agent-admin-v1`.
 */
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
  // `readJson` has already run the body through the agent-admin wire codec.
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

/**
 * Computer Use, local scripts and the busy-message mode of one agent, changed from a joined server.
 * Each one acts only on this computer, so only an owner or admin can read or change them. The app
 * default for a busy message stays a local choice: the route reports it and cannot change it.
 * Frozen by `agent-host-settings-v1`.
 */
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
  // `readJson` has already run the body through the agent-host-settings wire codec.
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

/**
 * The backup models of one agent, changed from a joined server. They decide which of this computer's
 * providers and accounts the agent moves to at a usage limit, so only an owner or admin can read or
 * change them. Frozen by `agent-backup-models-v1`.
 */
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
  // `readJson` has already run the body through the agent-backup-models wire codec.
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    if (read) return json(200, settings.readBackupModels(stringField(body, "agentId")));
    let input: ReturnType<typeof parseUpdateAgentBackupModelsInput>;
    try {
      // The wire takes any provider id; this computer refuses one it does not know.
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

/**
 * How many tasks of one agent run a turn at the same time, changed from a joined server. It decides
 * how much work the agent puts on this computer, so only an owner or admin can read or change it.
 * Frozen by `agent-task-limit-v1`.
 */
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
  // `readJson` has already run the body through the agent-task-limit wire codec.
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

/**
 * Whether one agent shows its plan card before a long task, changed from a joined server. It is an
 * agent setting of this computer, like the other host settings, so only an owner or admin can read
 * or change it. Frozen by `agent-plan-card-v1`.
 */
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
  // `readJson` has already run the body through the agent-plan-card wire codec.
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
