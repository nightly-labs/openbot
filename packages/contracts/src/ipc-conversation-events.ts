import { type AgentProviderId, isAgentProvider } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import type { ConversationMessage } from "./ipc-conversation-messages";
import type { RoutineRunStatus } from "./ipc-routines";
import { isDynamicRecord, isString } from "./runtime-values";

export const ROUTINE_EVENT_ITEM_TYPE_PREFIX = "routine-event:";

export type RoutineConversationEventAction = "created" | "updated" | "deleted";

export interface RoutineConversationEvent {
  action: RoutineConversationEventAction;
  routineId: string;
  routineName: string;
}

export const ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX = "routine-run-event:";

export type RoutineRunConversationEventStatus = Exclude<RoutineRunStatus, "queued">;

export interface RoutineRunConversationEvent {
  status: RoutineRunConversationEventStatus;
  routineId: string;
  runId: string;
  routineName: string;
}

export const HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX = "hosted-site-event:";

export type HostedSiteConversationEventAction = "publish" | "replace" | "delete";

export type HostedSiteConversationEventStatus = "running" | "succeeded" | "failed" | "interrupted" | "cancelled";

export interface HostedSiteConversationEventDetails {
  siteId: string | null;
  title: string;
  hostname: string | null;
  url: string | null;
}

function isHostedSiteConversationEventDetails(value: unknown): value is HostedSiteConversationEventDetails {
  if (
    !isDynamicRecord(value) ||
    (value.siteId !== null && !isIdentifier(value.siteId)) ||
    !isBoundedString(value.title, 120) ||
    value.title.trim().length === 0 ||
    (value.hostname !== null && (!isString(value.hostname) || !isHostedSiteHostname(value.hostname))) ||
    (value.url !== null && !isHostedSiteConversationEventUrl(value.url, value.hostname))
  ) {
    return false;
  }
  return value.hostname !== null || value.url === null;
}

export interface HostedSiteConversationEvent extends HostedSiteConversationEventDetails {
  action: HostedSiteConversationEventAction;
  status: HostedSiteConversationEventStatus;
  operationId: string;
}

export function routineConversationEventItemType(action: RoutineConversationEventAction, routineId: string): string {
  if (!isIdentifier(routineId)) throw new Error("A valid routine id is required.");
  const itemType = `${ROUTINE_EVENT_ITEM_TYPE_PREFIX}${action}:${routineId}`;
  if (itemType.length > INPUT_LIMITS.identifier) throw new Error("The routine event item type is too long.");
  return itemType;
}

export function parseRoutineConversationEventItemType(
  itemType: string | undefined,
): Pick<RoutineConversationEvent, "action" | "routineId"> | null {
  if (!itemType?.startsWith(ROUTINE_EVENT_ITEM_TYPE_PREFIX)) return null;
  const separator = itemType.indexOf(":", ROUTINE_EVENT_ITEM_TYPE_PREFIX.length);
  if (separator < 0) return null;
  const action = itemType.slice(ROUTINE_EVENT_ITEM_TYPE_PREFIX.length, separator);
  const routineId = itemType.slice(separator + 1);
  if ((action !== "created" && action !== "updated" && action !== "deleted") || !isIdentifier(routineId)) {
    return null;
  }
  return { action, routineId };
}

export function routineConversationEvent(message: ConversationMessage): RoutineConversationEvent | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  const event = parseRoutineConversationEventItemType(message.itemType);
  const routineName = message.text.trim();
  if (!event || !routineName || routineName.length > INPUT_LIMITS.routineName) return null;
  return { ...event, routineName };
}

export function routineRunConversationEventItemType(
  status: RoutineRunConversationEventStatus,
  routineId: string,
  runId: string,
): string {
  if (!isIdentifier(routineId)) throw new Error("A valid routine id is required.");
  if (!isIdentifier(runId)) throw new Error("A valid routine run id is required.");
  const itemType = `${ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX}${status}:${routineId}:${runId}`;
  if (itemType.length > INPUT_LIMITS.identifier) throw new Error("The routine run event item type is too long.");
  return itemType;
}

export function parseRoutineRunConversationEventItemType(
  itemType: string | undefined,
): Pick<RoutineRunConversationEvent, "status" | "routineId" | "runId"> | null {
  if (!itemType?.startsWith(ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX)) return null;
  const [status, routineId, runId, ...extra] = itemType.slice(ROUTINE_RUN_EVENT_ITEM_TYPE_PREFIX.length).split(":");
  if (
    extra.length > 0 ||
    !isRoutineRunConversationEventStatus(status) ||
    !isIdentifier(routineId) ||
    !isIdentifier(runId)
  ) {
    return null;
  }
  return { status, routineId, runId };
}

export function routineRunConversationEvent(message: ConversationMessage): RoutineRunConversationEvent | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  const event = parseRoutineRunConversationEventItemType(message.itemType);
  const routineName = message.text.trim();
  if (!event || !routineName || routineName.length > INPUT_LIMITS.routineName) return null;
  return { ...event, routineName };
}

export function hostedSiteConversationEventItemType(
  action: HostedSiteConversationEventAction,
  status: HostedSiteConversationEventStatus,
  operationId: string,
): string {
  if (!isIdentifier(operationId)) throw new Error("A valid hosted site operation id is required.");
  const itemType = `${HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX}${action}:${status}:${operationId}`;
  if (itemType.length > INPUT_LIMITS.identifier) throw new Error("The hosted site event item type is too long.");
  return itemType;
}

export function hostedSiteConversationEventText(details: HostedSiteConversationEventDetails): string {
  if (!isHostedSiteConversationEventDetails(details)) throw new Error("Valid hosted site event details are required.");
  return JSON.stringify(details);
}

export function parseHostedSiteConversationEventItemType(
  itemType: string | undefined,
): Pick<HostedSiteConversationEvent, "action" | "status" | "operationId"> | null {
  if (!itemType?.startsWith(HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX)) return null;
  const [action, status, operationId, ...extra] = itemType.slice(HOSTED_SITE_EVENT_ITEM_TYPE_PREFIX.length).split(":");
  if (
    extra.length > 0 ||
    !isHostedSiteConversationEventAction(action) ||
    !isHostedSiteConversationEventStatus(status) ||
    !isIdentifier(operationId)
  ) {
    return null;
  }
  return { action, status, operationId };
}

export function hostedSiteConversationEvent(message: ConversationMessage): HostedSiteConversationEvent | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  const event = parseHostedSiteConversationEventItemType(message.itemType);
  if (!event) return null;
  let details: unknown;
  try {
    details = JSON.parse(message.text);
  } catch {
    return null;
  }
  if (!isHostedSiteConversationEventDetails(details) || !hostedSiteDetailsMatchEvent(event, details)) return null;
  return { ...event, ...details };
}

function isRoutineRunConversationEventStatus(value: unknown): value is RoutineRunConversationEventStatus {
  return (
    value === "running" ||
    value === "needs-attention" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "cancelled"
  );
}

function isHostedSiteConversationEventAction(value: unknown): value is HostedSiteConversationEventAction {
  return value === "publish" || value === "replace" || value === "delete";
}

function isHostedSiteConversationEventStatus(value: unknown): value is HostedSiteConversationEventStatus {
  return (
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "cancelled"
  );
}

function hostedSiteDetailsMatchEvent(
  event: Pick<HostedSiteConversationEvent, "action" | "status">,
  details: HostedSiteConversationEventDetails,
): boolean {
  if (event.action === "publish" && event.status !== "succeeded") {
    return details.siteId === null && details.hostname === null && details.url === null;
  }
  return details.siteId !== null;
}

function isHostedSiteHostname(value: string): boolean {
  if (value.length === 0 || value.length > INPUT_LIMITS.hostname || value !== value.toLowerCase()) return false;
  try {
    const parsed = new URL(`https://${value}`);
    return (
      parsed.hostname === value &&
      parsed.port === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      value.endsWith(".openbot.site")
    );
  } catch {
    return false;
  }
}

export function isHostedSiteConversationEventUrl(value: unknown, hostname: unknown): value is string {
  if (!isBoundedString(value, INPUT_LIMITS.browserUrl) || !isString(hostname) || !isHostedSiteHostname(hostname)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return false;
    }
    if (parsed.protocol === "https:") return parsed.hostname === hostname && parsed.port === "";
    if (parsed.protocol !== "http:" || !parsed.port) return false;
    const port = Number(parsed.port);
    const label = hostname.slice(0, -".openbot.site".length);
    return (
      Number.isInteger(port) && port >= 1_024 && port <= 65_535 && parsed.hostname === `${label}.openbot.localhost`
    );
  } catch {
    return false;
  }
}

export const CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX = "channel-routing-event:";

export type ChannelRoutingConversationEventAction = "assigned" | "continued";

export interface ChannelRoutingConversationEvent {
  action: ChannelRoutingConversationEventAction;
  agentId: string;
}

export function channelRoutingConversationEventItemType(
  action: ChannelRoutingConversationEventAction,
  agentId: string,
): string {
  if (!isIdentifier(agentId)) throw new Error("A valid agent id is required.");
  const itemType = `${CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX}${action}:${agentId}`;
  if (itemType.length > INPUT_LIMITS.identifier) throw new Error("The channel routing event item type is too long.");
  return itemType;
}

export function parseChannelRoutingConversationEventItemType(
  itemType: string | undefined,
): ChannelRoutingConversationEvent | null {
  if (!itemType?.startsWith(CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX)) return null;
  const [action, agentId, ...extra] = itemType.slice(CHANNEL_ROUTING_EVENT_ITEM_TYPE_PREFIX.length).split(":");
  if (extra.length > 0 || (action !== "assigned" && action !== "continued") || !isIdentifier(agentId)) return null;
  return { action, agentId };
}

export function channelRoutingConversationEvent(message: ConversationMessage): ChannelRoutingConversationEvent | null {
  if (message.author !== "system" || message.status !== "completed") return null;
  return parseChannelRoutingConversationEventItemType(message.itemType);
}

export const CONTEXT_RESET_ITEM_TYPE = "context-reset";

export const MODEL_SWITCH_ITEM_TYPE_PREFIX = "model-switch:";
export const MODEL_SWITCH_ITEM_TYPES = {
  "usage-limit": `${MODEL_SWITCH_ITEM_TYPE_PREFIX}usage-limit`,
  "usage-limit-ended": `${MODEL_SWITCH_ITEM_TYPE_PREFIX}usage-limit-ended`,
  "provider-error": `${MODEL_SWITCH_ITEM_TYPE_PREFIX}provider-error`,
  "provider-error-ended": `${MODEL_SWITCH_ITEM_TYPE_PREFIX}provider-error-ended`,
  "model-removed": `${MODEL_SWITCH_ITEM_TYPE_PREFIX}model-removed`,
} as const;
export type ModelSwitchReason = keyof typeof MODEL_SWITCH_ITEM_TYPES;

export function modelSwitchReason(message: ConversationMessage): ModelSwitchReason | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  if (message.itemType === MODEL_SWITCH_ITEM_TYPES["usage-limit"]) return "usage-limit";
  if (message.itemType === MODEL_SWITCH_ITEM_TYPES["usage-limit-ended"]) return "usage-limit-ended";
  if (message.itemType === MODEL_SWITCH_ITEM_TYPES["provider-error"]) return "provider-error";
  if (message.itemType === MODEL_SWITCH_ITEM_TYPES["provider-error-ended"]) return "provider-error-ended";
  if (message.itemType === MODEL_SWITCH_ITEM_TYPES["model-removed"]) return "model-removed";
  return null;
}

export const CHANNEL_CHANGE_ITEM_TYPE = "channel-change";

export function isChannelChangeMarker(message: ConversationMessage): boolean {
  return (
    message.author === "system" &&
    message.source === "system" &&
    message.status === "completed" &&
    message.itemType === CHANNEL_CHANGE_ITEM_TYPE
  );
}

export const VAULT_CHANGE_ITEM_TYPE = "vault-change";

export function isVaultChangeMarker(message: ConversationMessage): boolean {
  return (
    message.author === "system" &&
    message.source === "system" &&
    message.status === "completed" &&
    message.itemType === VAULT_CHANGE_ITEM_TYPE
  );
}

export const PLAN_CONTINUATION_ITEM_TYPE = "plan-continuation";

export function isPlanContinuationMarker(message: ConversationMessage): boolean {
  return (
    message.author === "system" &&
    message.source === "system" &&
    message.status === "completed" &&
    message.itemType === PLAN_CONTINUATION_ITEM_TYPE
  );
}

export const NO_ANSWER_NOTICE_ITEM_TYPE = "no-answer-notice";

export function isNoAnswerNotice(message: ConversationMessage): boolean {
  return (
    message.author === "system" &&
    message.source === "system" &&
    message.status === "completed" &&
    message.itemType === NO_ANSWER_NOTICE_ITEM_TYPE
  );
}

export const SIGN_IN_FAILURE_ITEM_TYPE_PREFIX = "sign-in-failure:";

export function signInFailureProvider(message: ConversationMessage): AgentProviderId | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  if (!message.itemType?.startsWith(SIGN_IN_FAILURE_ITEM_TYPE_PREFIX)) return null;
  const provider = message.itemType.slice(SIGN_IN_FAILURE_ITEM_TYPE_PREFIX.length);
  return isAgentProvider(provider) ? provider : null;
}

export const AGENT_EXCHANGE_ITEM_TYPE = "agent-exchange";

export function isContextResetMarker(message: ConversationMessage): boolean {
  return (
    message.author === "system" &&
    message.source === "system" &&
    message.status === "completed" &&
    message.itemType === CONTEXT_RESET_ITEM_TYPE
  );
}
