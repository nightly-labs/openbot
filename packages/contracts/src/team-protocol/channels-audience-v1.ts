// Additive channel-audience-v1 side protocol. Existing channels-v1 paths and payloads stay frozen.
import { CHANNEL_ROUTES, channelRequest, channelResponse } from "./channels-v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "./v2";

export const CHANNEL_AUDIENCE_ROUTES = {
  command: "/v1/channels/audience/commands",
  receipt: "/v1/channels/audience/receipt",
  read: "/v1/channels/audience/read",
} as const;
export function isChannelAudienceRoute(path: string): boolean {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  return Object.values(CHANNEL_AUDIENCE_ROUTES).some((route) => route === pathname);
}
function object(value: unknown): Record<string, TeamProtocolV2Json> {
  const result = decodeTeamProtocolV2Json(value);
  if (typeof result !== "object" || result === null || Array.isArray(result))
    throw new Error("Invalid audience record.");
  return result;
}
function identifier(value: TeamProtocolV2Json | undefined): string {
  if (typeof value !== "string" || !value.length || value.length > 128) throw new Error("Invalid audience identifier.");
  return value;
}
function ids(value: TeamProtocolV2Json | undefined): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("Invalid audience members.");
  const result = value.map(identifier);
  if (new Set(result).size !== result.length) throw new Error("Duplicate audience member.");
  return result;
}
function targets(value: TeamProtocolV2Json | undefined): TeamProtocolV2Json[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("Invalid audience targets.");
  const result = value.map((entry) => {
    const target = object(entry);
    return { agentId: identifier(target.agentId), taskId: identifier(target.taskId) };
  });
  if (
    new Set(result.map((entry) => entry.agentId)).size !== result.length ||
    new Set(result.map((entry) => entry.taskId)).size !== result.length
  )
    throw new Error("Duplicate audience target.");
  return result;
}
export function channelAudienceRequest(path: string, value: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === CHANNEL_AUDIENCE_ROUTES.read) return channelRequest(CHANNEL_ROUTES.read, value);
  const input = object(value);
  const common = { operationId: identifier(input.operationId), channelId: identifier(input.channelId) };
  if (pathname === CHANNEL_AUDIENCE_ROUTES.receipt) return common;
  if (pathname !== CHANNEL_AUDIENCE_ROUTES.command) throw new Error("Invalid audience path.");
  const base = object(channelRequest(CHANNEL_ROUTES.command, { ...input, type: "send", recipientAgentId: null }));
  if (!Array.isArray(base.attachmentDraftIds) || base.attachmentDraftIds.length > 10)
    throw new Error("Invalid audience attachments.");
  const selector = object(input.audience);
  const audience: TeamProtocolV2Json =
    selector.kind === "all"
      ? { kind: "all" }
      : selector.kind === "members"
        ? { kind: "members", agentIds: ids(selector.agentIds) }
        : null;
  if (!audience) throw new Error("Invalid audience selector.");
  return {
    ...common,
    text: base.text ?? "",
    replyToMessageId: base.replyToMessageId ?? null,
    attachmentDraftIds: base.attachmentDraftIds,
    audience,
  };
}
export function channelAudienceResponse(path: string, status: number, value: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (!isChannelAudienceRoute(path)) throw new Error("Invalid audience path.");
  if (status >= 400) return channelResponse(CHANNEL_ROUTES.command, status, value);
  if (pathname === CHANNEL_AUDIENCE_ROUTES.read) {
    const page = object(value);
    const base = object(channelResponse(CHANNEL_ROUTES.read, status, value));
    if (!Array.isArray(page.messages) || !Array.isArray(base.messages)) throw new Error("Invalid audience page.");
    const messages = page.messages;
    return {
      ...base,
      messages: base.messages.map((entry, index) => {
        const raw = object(messages[index]);
        return { ...object(entry), ...(raw.audience === undefined ? {} : { audience: targets(raw.audience) }) };
      }),
    };
  }
  if (pathname === CHANNEL_AUDIENCE_ROUTES.receipt && value === null) return null;
  const receipt = object(value);
  if (receipt.status !== undefined) {
    if (receipt.status !== "not-accepted") throw new Error("Invalid audience result status.");
    if (receipt.reason !== "validation") throw new Error("Invalid audience refusal.");
    return {
      status: "not-accepted",
      reason: "validation",
      channelId: identifier(receipt.channelId),
      operationId: identifier(receipt.operationId),
    };
  }
  return {
    channel: channelResponse(CHANNEL_ROUTES.command, status, receipt.channel),
    requestMessageId: identifier(receipt.requestMessageId),
    targets: targets(receipt.targets),
  };
}
