// Frozen payloads for the additive agent-profile-generation capability. These bounds and keys
// belong to its first wire version, independently of the current IPC profile model.
import { isDynamicRecord, isString } from "../runtime-values";
import { isUuidV4 } from "../validation";
import { decodeTeamProtocolV4BaseHttpResponse, type TeamProtocolV4BaseJsonObject } from "./v4-base";

function bounded(value: unknown, limit: number): value is string {
  return isString(value) && value.length <= limit;
}
function identifier(value: unknown): value is string {
  return bounded(value, 128) && value.length > 0;
}

export function decodeProfileV4Draft(value: unknown, complete: boolean): TeamProtocolV4BaseJsonObject {
  if (
    !isDynamicRecord(value) ||
    !bounded(value.name, 80) ||
    !bounded(value.title, 120) ||
    !bounded(value.description, 2_000) ||
    (complete && (!value.name.trim() || !value.description.trim())) ||
    !isString(value.avatarSeed) ||
    !/^[a-z0-9:-]{1,128}$/u.test(value.avatarSeed) ||
    !(
      value.avatarHue === null || [0, 30, 55, 100, 150, 185, 215, 245, 280, 320].some((hue) => hue === value.avatarHue)
    ) ||
    !(value.sectionId === null || identifier(value.sectionId))
  )
    throw new Error("Invalid profile v4 draft.");
  return {
    name: value.name,
    title: value.title,
    description: value.description,
    avatarSeed: value.avatarSeed,
    avatarHue: value.avatarHue === null ? null : Number(value.avatarHue),
    sectionId: value.sectionId,
  };
}

export function decodeProfileV4Request(generate: boolean, value: unknown): TeamProtocolV4BaseJsonObject {
  if (!isDynamicRecord(value) || (value.agentId !== undefined && !identifier(value.agentId)))
    throw new Error("Invalid profile v4 request.");
  const agent: TeamProtocolV4BaseJsonObject = value.agentId === undefined ? {} : { agentId: value.agentId };
  if (generate) {
    if (!bounded(value.prompt, 100_000) || !value.prompt.trim()) throw new Error("Invalid profile v4 prompt.");
    return {
      prompt: value.prompt,
      ...agent,
      ...(value.draft === undefined ? {} : { draft: decodeProfileV4Draft(value.draft, false) }),
    };
  }
  if (
    !isString(value.operationId) ||
    !isUuidV4(value.operationId) ||
    (value.initialMessage !== undefined && !bounded(value.initialMessage, 100_000)) ||
    (value.agentId === undefined && !value.initialMessage?.trim())
  )
    throw new Error("Invalid profile v4 save.");
  return {
    operationId: value.operationId,
    ...agent,
    draft: decodeProfileV4Draft(value.draft, true),
    ...(value.initialMessage === undefined ? {} : { initialMessage: value.initialMessage }),
  };
}

export function decodeProfileV4Response(generate: boolean, value: unknown): TeamProtocolV4BaseJsonObject {
  if (generate) return decodeProfileV4Draft(value, true);
  if (!isDynamicRecord(value)) throw new Error("Invalid profile v4 response.");
  // Agent and sidebar fields retain their already frozen v1 representations and projections.
  return {
    agent: decodeTeamProtocolV4BaseHttpResponse("PATCH", "/v1/agents/profile-saved", 200, value.agent),
    layout: decodeTeamProtocolV4BaseHttpResponse("GET", "/v1/sidebar-layout", 200, value.layout),
  };
}
