import { isDynamicRecord, isString } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, fields, nullable, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const HOST_APPEARANCE_CAPABILITY = "host-appearance-v1";

export const HOST_APPEARANCE_ROUTES = {
  appearance: "/v1/admin/host/appearance",
} as const;

export const SERVER_APPEARANCE_SHAPES = [
  "squircle",
  "cercle",
  "galet",
  "capsule",
  "carre",
  "losange",
  "triangle",
  "pentagone",
  "hexagone",
  "nuage",
] as const;

export type ServerAppearanceShape = (typeof SERVER_APPEARANCE_SHAPES)[number];

export interface ServerAppearance {
  shape: ServerAppearanceShape;
  color: `#${string}` | null;
}

const COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export function isServerAppearanceShape(value: unknown): value is ServerAppearanceShape {
  return SERVER_APPEARANCE_SHAPES.some((shape) => shape === value);
}

export function isServerAppearanceColor(value: unknown): value is `#${string}` {
  return isString(value) && COLOR_PATTERN.test(value);
}

export function serverAppearanceOrNull(value: unknown): ServerAppearance | null {
  if (!isDynamicRecord(value) || !isServerAppearanceShape(value.shape)) return null;
  if (value.color !== null && !isServerAppearanceColor(value.color)) return null;
  return { shape: value.shape, color: value.color };
}

export function optionalServerAppearanceField(value: unknown): { appearance?: ServerAppearance | null } {
  if (value === null) return { appearance: null };
  const appearance = serverAppearanceOrNull(value);
  return appearance ? { appearance } : {};
}

const color: AdminDecoder = (value) => {
  if (!isServerAppearanceColor(value)) throw new Error("Invalid admin colour.");
  return value;
};

const appearance = fields({ shape: oneOf(...SERVER_APPEARANCE_SHAPES), color: nullable(color) });

export const HOST_APPEARANCE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_APPEARANCE_ROUTES.appearance, adminRoute(fields({ appearance: nullable(appearance) }), empty)],
]);

export const HOST_APPEARANCE_EVENT = "host-appearance";

export interface HostAppearanceEvent {
  type: typeof HOST_APPEARANCE_EVENT;
  serverId: string;
  appearance: ServerAppearance | null;
}

export function hostAppearanceEvent(value: unknown): HostAppearanceEvent | null {
  if (!isDynamicRecord(value) || value.type !== HOST_APPEARANCE_EVENT) return null;
  const { serverId } = value;
  if (!isString(serverId) || !serverId.length || serverId.length > 128)
    throw new Error("Invalid host appearance event.");
  if (value.appearance === null) return { type: HOST_APPEARANCE_EVENT, serverId, appearance: null };
  const parsed = serverAppearanceOrNull(value.appearance);
  if (!parsed) throw new Error("Invalid host appearance event.");
  return { type: HOST_APPEARANCE_EVENT, serverId, appearance: parsed };
}
