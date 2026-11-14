// Frozen optional host-appearance-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can choose the shape and the colour of the plush that the server shows when it has no logo
// of its own. The host saves the choice, copies it to the account service with the account signed
// in on it (as for the logo), and sends `host-appearance` to each member that has the capability:
// once when the member connects and again after each change. A member cannot use the route;
// `requireAdmin` on the host is the only gate.
//
// `appearance: null` gives the server its automatic look again: the squircle, in the colour that its
// ID chooses. A `null` colour keeps the automatic colour with the chosen shape. Only the shape ID and
// a `#rrggbb` colour cross the wire; the response is empty. Widening any of it needs a second
// capability string.
import { isDynamicRecord, isString } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, fields, nullable, type OptionalRouteCodec, oneOf } from "./admin-wire";

export const HOST_APPEARANCE_CAPABILITY = "host-appearance-v1";

export const HOST_APPEARANCE_ROUTES = {
  appearance: "/v1/admin/host/appearance",
} as const;

/** The plush shapes a server can take, in picker order. The first is the automatic one. */
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

/** The look of a server with no logo. `color` is `#rrggbb`, or null for the automatic colour. */
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

/** Null for a value that is not an appearance. Extra keys are dropped. */
export function serverAppearanceOrNull(value: unknown): ServerAppearance | null {
  if (!isDynamicRecord(value) || !isServerAppearanceShape(value.shape)) return null;
  if (value.color !== null && !isServerAppearanceColor(value.color)) return null;
  return { shape: value.shape, color: value.color };
}

/**
 * The optional `appearance` field of a stored or listed server record. Null is the automatic look.
 * A bad value drops only the field, so the record still loads; an absent field means an older source.
 */
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

/** Null for any other event. A malformed appearance event throws, so the stream fails closed. */
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
