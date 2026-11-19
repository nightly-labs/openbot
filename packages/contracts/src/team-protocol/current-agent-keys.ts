import { isBoolean, isNumber, isString } from "../runtime-values";
import type { TeamProtocolV1JsonObject, TeamProtocolV1JsonValue } from "./v1";

const WIRE_TO_CURRENT_KEYS: Readonly<Record<string, string>> = {
  bot: "agent",
  botId: "agentId",
  bots: "agents",
  ownerBotId: "ownerAgentId",
  recipientBotId: "recipientAgentId",
  recipientBotIds: "recipientAgentIds",
  senderBotId: "senderAgentId",
  typingBotId: "typingAgentId",
};

const CURRENT_TO_WIRE_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(WIRE_TO_CURRENT_KEYS).map(([wire, current]) => [current, wire]),
);

const WIRE_TO_CURRENT_VALUES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  kind: { bot: "agent" },
  origin: { bot: "agent" },
  type: { "bots-changed": "agents-changed" },
};

const CURRENT_TO_WIRE_VALUES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.fromEntries(
  Object.entries(WIRE_TO_CURRENT_VALUES).map(([key, mapping]) => [
    key,
    Object.fromEntries(Object.entries(mapping).map(([wire, current]) => [current, wire])),
  ]),
);

const MARKETPLACE_SOURCE_KEY = "marketplaceSource";
const WIRE_TO_CURRENT_MARKETPLACE_KEYS: Readonly<Record<string, string>> = { agentId: "listingId" };
const CURRENT_TO_WIRE_MARKETPLACE_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(WIRE_TO_CURRENT_MARKETPLACE_KEYS).map(([wire, current]) => [current, wire]),
);

const OPAQUE_KEYS: ReadonlySet<string> = new Set(["layout"]);

const DYNAMIC_MAP_KEYS: ReadonlySet<string> = new Set(["responses", "references", "answers"]);

function isUntranslatedPath(path: string): boolean {
  const { pathname } = new URL(path, "http://openbot.invalid");
  return pathname.startsWith("/v1/sidebar-layout") || pathname === "/v1/agents/conversation-reads";
}

type Direction = "toWire" | "toCurrent";

function walk(value: TeamProtocolV1JsonValue, direction: Direction, key: string): TeamProtocolV1JsonValue {
  if (value === null || isBoolean(value) || isNumber(value)) return value;
  if (isString(value)) {
    const mapping = (direction === "toWire" ? CURRENT_TO_WIRE_VALUES : WIRE_TO_CURRENT_VALUES)[key];
    return mapping?.[value] ?? value;
  }
  if (Array.isArray(value)) return value.map((item) => walk(item, direction, key));
  return walkObject(value, direction, key);
}

function walkObject(value: TeamProtocolV1JsonObject, direction: Direction, key: string): TeamProtocolV1JsonObject {
  const keys =
    key === MARKETPLACE_SOURCE_KEY
      ? direction === "toWire"
        ? CURRENT_TO_WIRE_MARKETPLACE_KEYS
        : WIRE_TO_CURRENT_MARKETPLACE_KEYS
      : direction === "toWire"
        ? CURRENT_TO_WIRE_KEYS
        : WIRE_TO_CURRENT_KEYS;
  const result: TeamProtocolV1JsonObject = {};
  const dynamic = DYNAMIC_MAP_KEYS.has(key);
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (dynamic) {
      result[entryKey] = walk(entryValue, direction, "");
      continue;
    }
    result[keys[entryKey] ?? entryKey] = OPAQUE_KEYS.has(entryKey) ? entryValue : walk(entryValue, direction, entryKey);
  }
  return result;
}

export function toWireAgentKeys(value: TeamProtocolV1JsonValue): TeamProtocolV1JsonValue {
  return walk(value, "toWire", "");
}

export function toCurrentAgentKeys(value: TeamProtocolV1JsonValue): TeamProtocolV1JsonValue {
  return walk(value, "toCurrent", "");
}

export function toCurrentAgentKeysObjectForPath(
  path: string,
  value: TeamProtocolV1JsonObject,
): TeamProtocolV1JsonObject {
  return isUntranslatedPath(path) ? value : walkObject(value, "toCurrent", "");
}

export function toWireAgentKeysObjectForPath(path: string, value: TeamProtocolV1JsonObject): TeamProtocolV1JsonObject {
  return isUntranslatedPath(path) ? value : walkObject(value, "toWire", "");
}
