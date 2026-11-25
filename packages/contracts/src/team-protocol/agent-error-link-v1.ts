import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV8BaseJsonValue } from "./v8-base";

export const AGENT_ERROR_LINK_CAPABILITY = "agent-error-link-v1";

const MAX_ERROR_LINK_LENGTH = 8192;

function isAgentErrorLink(value: unknown): value is string {
  return isString(value) && value.length <= MAX_ERROR_LINK_LENGTH && URL.parse(value)?.protocol === "https:";
}

export function withAgentErrorLink(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "error") return projected;
  if (!isDynamicRecord(source) || source.link === undefined) return projected;
  if (isAgentErrorLink(source.link)) return { ...projected, link: source.link };
  if (sending) return projected;
  throw new Error("Invalid agent error link.");
}
