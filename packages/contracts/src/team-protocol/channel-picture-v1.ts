import { isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES, channelResponse } from "./channels-v1";
import type { TeamProtocolV2Json } from "./v2";

/**
 * Frozen optional channel-picture-v1 contract: the picture of a channel, an icon on a colour or an
 * uploaded image, as the channel settings on the desktop set it. It adds, beside the frozen keys of
 * channels-v1:
 *
 * - `icon: { name, hue } | null` and `imageUrl: string | null` on each summary of `GET /v1/channels`,
 *   on the `channel` of `POST /v1/channels/read`, and on the channel that `POST /v1/channels/commands`
 *   answers. `name` is a lowercase key of at most 40 characters and `hue` an integer from 0 to 359; a
 *   client shows the member faces for a name that it does not know. `imageUrl` is the host's
 *   `openbot-avatar://channel/<id>?v=<version>&type=<mime>` URL, which only names the version;
 *   a client reads the image from the route below;
 * - `icon` on the `draft` of a `save` command. Absent keeps the stored icon, and null removes it;
 * - `/v1/channels/image?channelId=<id>`: `GET` with `&v=<version>` answers the image bytes,
 *   `PUT` with a PNG, JPEG, GIF or WebP body of at most 512 KiB sets the image, and `DELETE` removes
 *   it. `PUT` and `DELETE` answer the channel, with the keys above.
 *
 * The host adds the keys only on a request that advertises the capability, reads `icon` only from
 * such a request, and serves the image route only to it, so the wire of every released peer stays
 * as it was. A host without the capability never sends them, so a client accepts them whenever they
 * are present. A present malformed value fails closed. Widening any of it needs a second capability
 * string.
 */
export const CHANNEL_PICTURE_CAPABILITY = "channel-picture-v1";

export const CHANNEL_PICTURE_ROUTES = { image: "/v1/channels/image" } as const;

const ICON_NAME = /^[a-z][a-z0-9-]{0,39}$/u;
const IMAGE_URL_PREFIX = "openbot-avatar://channel/";
const IMAGE_URL_LIMIT = 2048;

function pathname(path: string): string {
  return new URL(path, "http://openbot.invalid").pathname;
}

export function isChannelPictureRoute(path: string): boolean {
  return pathname(path) === CHANNEL_PICTURE_ROUTES.image;
}

function icon(value: unknown): TeamProtocolV2Json {
  if (value === null) return null;
  if (
    !isDynamicRecord(value) ||
    !isString(value.name) ||
    !ICON_NAME.test(value.name) ||
    typeof value.hue !== "number" ||
    !Number.isInteger(value.hue) ||
    value.hue < 0 ||
    value.hue >= 360
  )
    throw new Error("Invalid channel icon.");
  return { name: value.name, hue: value.hue };
}

function imageUrl(value: unknown): TeamProtocolV2Json {
  if (value === null) return null;
  if (!isString(value) || value.length > IMAGE_URL_LIMIT || !value.startsWith(IMAGE_URL_PREFIX))
    throw new Error("Invalid channel image.");
  return value;
}

function picture(value: unknown, keys: readonly ("icon" | "imageUrl")[]): { [key: string]: TeamProtocolV2Json } {
  if (!isDynamicRecord(value)) return {};
  const result: { [key: string]: TeamProtocolV2Json } = {};
  if (keys.includes("icon") && value.icon !== undefined) result.icon = icon(value.icon);
  if (keys.includes("imageUrl") && value.imageUrl !== undefined) result.imageUrl = imageUrl(value.imageUrl);
  return result;
}

function withPicture(projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  if (!isDynamicRecord(projected)) return projected;
  return { ...projected, ...picture(source, ["icon", "imageUrl"]) };
}

/** A save command of `projected` with the `icon` of the draft in `source`, which channels-v1 dropped. */
export function withChannelDraftPicture(
  path: string,
  projected: TeamProtocolV2Json,
  source: unknown,
): TeamProtocolV2Json {
  if (pathname(path) !== CHANNEL_ROUTES.command || !isDynamicRecord(projected) || projected.type !== "save")
    return projected;
  if (!isDynamicRecord(source) || !isDynamicRecord(projected.draft)) return projected;
  return { ...projected, draft: { ...projected.draft, ...picture(source.draft, ["icon"]) } };
}

/** `projected` with the picture of each channel in `source`, which channels-v1 dropped. */
export function withChannelPicture(path: string, projected: TeamProtocolV2Json, source: unknown): TeamProtocolV2Json {
  const route = pathname(path);
  if (route === CHANNEL_ROUTES.command || route === CHANNEL_PICTURE_ROUTES.image) return withPicture(projected, source);
  if (route === CHANNEL_ROUTES.read) {
    if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
    return { ...projected, channel: withPicture(projected.channel ?? null, source.channel) };
  }
  if (route !== CHANNEL_ROUTES.list || !Array.isArray(projected) || !Array.isArray(source)) return projected;
  return projected.map((summary, index) => withPicture(summary, source[index]));
}

/**
 * The image route carries no JSON body: `GET` answers bytes and `PUT` sends them. The channel that
 * `PUT` and `DELETE` answer is the channel of a command, before `withChannelPicture` adds its picture.
 */
export const channelPictureRoute = {
  request: (): null => null,
  response: (status: number, value: unknown): TeamProtocolV2Json =>
    channelResponse(CHANNEL_ROUTES.command, status, value),
};
