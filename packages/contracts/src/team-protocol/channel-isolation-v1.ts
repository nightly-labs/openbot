import { isDynamicRecord } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import type { TeamProtocolV2Json } from "./v2";

/**
 * Frozen optional channel-isolation-v1 contract: the "Keep memories in this channel" setting of a
 * channel (#5380). It adds `isolated: boolean`, beside the frozen keys of channels-v1:
 *
 * - on each summary of `GET /v1/channels`, on the `channel` of `POST /v1/channels/read`, and on the
 *   channel that `POST /v1/channels/commands` answers;
 * - on the `draft` of a `save` command. Absent keeps the stored value, so a client that does not send
 *   it does not turn the setting off.
 *
 * The host adds it only on a request that advertises the capability, and reads it only from such a
 * request, so the wire of every released peer stays as it was. A channel that never had the setting
 * has no `isolated`, which is off. A host without the capability never sends it, so a client accepts
 * it whenever it is present. A present value that is not a boolean fails closed. Widening any of it
 * needs a second capability string.
 */
export const CHANNEL_ISOLATION_CAPABILITY = "channel-isolation-v1";

function isolation(value: unknown): { [key: string]: TeamProtocolV2Json } {
  if (!isDynamicRecord(value) || value.isolated === undefined) return {};
  if (typeof value.isolated !== "boolean") throw new Error("Invalid channel isolation.");
  return { isolated: value.isolated };
}

function withIsolation(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected)) return projected;
  return { ...projected, ...isolation(source) };
}

/** A save command of `projected` with the `isolated` of the draft in `source`, which channels-v1 dropped. */
export function withChannelDraftIsolation(
  path: string,
  projected: TeamProtocolV2Json,
  source: unknown,
): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname !== CHANNEL_ROUTES.command || !isDynamicRecord(projected) || projected.type !== "save") return projected;
  if (!isDynamicRecord(source) || projected.draft === undefined) return projected;
  return { ...projected, draft: withIsolation(projected.draft, source.draft) };
}

/** `projected` with the `isolated` of each channel in `source`, which channels-v1 dropped. */
export function withChannelIsolation(path: string, projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === CHANNEL_ROUTES.command) return withIsolation(projected, source);
  if (pathname === CHANNEL_ROUTES.read) {
    if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
    return { ...projected, channel: withIsolation(projected.channel ?? null, source.channel) };
  }
  if (pathname !== CHANNEL_ROUTES.list || !Array.isArray(projected) || !Array.isArray(source)) return projected;
  return projected.map((summary, index) => withIsolation(summary, source[index]));
}
