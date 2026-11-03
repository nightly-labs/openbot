import { isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

/** A protected connector. Missing rows keep the released, unrestricted behavior. */
export interface ConnectorAccessRule {
  mcpServerId: string;
  agentIds: string[];
  everyoneUse: boolean;
  roleIds: string[];
}
export interface ConnectorAccessBinding extends ConnectorAccessRule {
  /** History keeps its protection after a connector is removed from an agent. */
  audienceAgentIds: string[];
}
export interface ConnectorAccessChange {
  revision: number;
  rules: ConnectorAccessRule[];
}
export interface ConnectorAccessSnapshot {
  revision: number;
  closed: boolean;
  rules: ConnectorAccessBinding[];
  connectors: { id: string; name: string }[];
}
const ids = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 1000 && value.every(isIdentifier) && new Set(value).size === value.length;
const revision = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function rule(value: unknown): value is ConnectorAccessRule {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.mcpServerId) &&
    ids(value.agentIds) &&
    typeof value.everyoneUse === "boolean" &&
    ids(value.roleIds)
  );
}
export function parseConnectorAccessChange(value: unknown): ConnectorAccessChange {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some((key) => key !== "revision" && key !== "rules") ||
    !revision(value.revision) ||
    !Array.isArray(value.rules) ||
    value.rules.length > 1000 ||
    !value.rules.every(
      (item) =>
        rule(item) &&
        Object.keys(item).every((key) => ["mcpServerId", "agentIds", "everyoneUse", "roleIds"].includes(key)),
    ) ||
    new Set(value.rules.map((item) => item.mcpServerId)).size !== value.rules.length
  )
    throw new Error("Invalid connector access change.");
  return {
    revision: value.revision,
    rules: value.rules.map((item) => ({
      mcpServerId: item.mcpServerId,
      agentIds: [...item.agentIds],
      everyoneUse: item.everyoneUse,
      roleIds: [...item.roleIds],
    })),
  };
}
function binding(value: unknown): value is ConnectorAccessBinding {
  return rule(value) && "audienceAgentIds" in value && ids(value.audienceAgentIds);
}
function connector(value: unknown): value is { id: string; name: string } {
  return (
    isDynamicRecord(value) && isIdentifier(value.id) && typeof value.name === "string" && value.name.length <= 1024
  );
}
export function decodeConnectorAccessSnapshot(value: unknown): ConnectorAccessSnapshot {
  if (!isDynamicRecord(value) || typeof value.closed !== "boolean")
    throw new Error("Invalid connector access snapshot.");
  const rules = value.rules;
  const connectors = value.connectors;
  if (
    !Array.isArray(rules) ||
    !rules.every(binding) ||
    !Array.isArray(connectors) ||
    connectors.length > 1000 ||
    !connectors.every(connector)
  )
    throw new Error("Invalid connector access snapshot.");
  const change = parseConnectorAccessChange({
    revision: value.revision,
    rules: rules.map(({ mcpServerId, agentIds, everyoneUse, roleIds }) => ({
      mcpServerId,
      agentIds,
      everyoneUse,
      roleIds,
    })),
  });
  return {
    revision: change.revision,
    closed: value.closed,
    rules: rules.map(({ mcpServerId, agentIds, everyoneUse, roleIds, audienceAgentIds }) => ({
      mcpServerId,
      agentIds: [...agentIds],
      everyoneUse,
      roleIds: [...roleIds],
      audienceAgentIds: [...audienceAgentIds],
    })),
    connectors: connectors.map(({ id, name }) => ({ id, name })),
  };
}
