import { isDynamicRecord, isString } from "../runtime-values";
import { CHANNEL_ROUTES, channelResponse } from "./channels-v1";
import type { TeamProtocolV2Json } from "./webrtc-framing";

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

export const channelPictureRoute = {
  request: (): null => null,
  response: (status: number, value: unknown): TeamProtocolV2Json =>
    channelResponse(CHANNEL_ROUTES.command, status, value),
};
