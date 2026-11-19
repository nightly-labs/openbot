import { isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const CHANNEL_BROWSER_CAPABILITY = "channel-browser-v1";

const AGENT_ID_LIMIT = 128;

function browserValue(value: unknown): TeamProtocolV2Json {
  if (isDynamicRecord(value)) {
    if ((value.kind === "members" || value.kind === "none") && Object.keys(value).length === 1)
      return { kind: value.kind };
    if (
      value.kind === "member" &&
      isString(value.agentId) &&
      value.agentId.length > 0 &&
      value.agentId.length <= AGENT_ID_LIMIT &&
      Object.keys(value).length === 2
    )
      return { kind: "member", agentId: value.agentId };
  }
  throw new Error("Invalid channel browser setting.");
}

function browser(value: unknown): { [key: string]: TeamProtocolV2Json } {
  if (!isDynamicRecord(value) || value.browser === undefined) return {};
  return { browser: browserValue(value.browser) };
}

function withBrowser(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected)) return projected;
  return { ...projected, ...browser(source) };
}

function pathname(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname;
}

export function withChannelDraftBrowser(
  path: string,
  projected: TeamProtocolV2Json,
  source: unknown,
): TeamProtocolV2Json {
  if (pathname(path) !== CHANNEL_ROUTES.command || !isDynamicRecord(projected) || projected.type !== "save")
    return projected;
  if (!isDynamicRecord(source) || !isDynamicRecord(projected.draft)) return projected;
  return { ...projected, draft: withBrowser(projected.draft, source.draft) };
}

export function withChannelBrowser(path: string, projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  const route = pathname(path);
  if (route === CHANNEL_ROUTES.command) return withBrowser(projected, source);
  if (route === CHANNEL_ROUTES.read) {
    if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
    return { ...projected, channel: withBrowser(projected.channel ?? null, source.channel) };
  }
  if (route !== CHANNEL_ROUTES.list || !Array.isArray(projected) || !Array.isArray(source)) return projected;
  return projected.map((summary, index) => withBrowser(summary, source[index]));
}
