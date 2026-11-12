import { isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES } from "./channels-v1";
import type { TeamProtocolV2Json } from "./v2";

/**
 * Frozen optional channel-browser-v1 contract: the Browser setting of a channel (#4135), which says
 * which members can use the browser there. It adds, beside the frozen keys of channels-v1:
 *
 * - `browser` on each summary of `GET /v1/channels`, on the `channel` of `POST /v1/channels/read`,
 *   and on the channel that `POST /v1/channels/commands` answers;
 * - `browser` on the `draft` of a `save` command. Absent keeps the stored value, so a client that
 *   does not send it does not change the setting.
 *
 * `browser` is `{ kind: "members" }` (every member), `{ kind: "none" }` (no member), or
 * `{ kind: "member", agentId }` (only that member of the channel). A channel without the setting has
 * no `browser`, which is every member.
 *
 * The host adds it only on a request that advertises the capability, and reads it only from such a
 * request, so the wire of every released peer stays as it was. A host without the capability never
 * sends it, so a client accepts it whenever it is present. A present malformed value fails closed.
 * Widening any of it needs a second capability string.
 */
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

/** A save command of `projected` with the `browser` of the draft in `source`, which channels-v1 dropped. */
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

/** `projected` with the `browser` of each channel in `source`, which channels-v1 dropped. */
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
