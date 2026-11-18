// Frozen optional server-safe-mode-v1 wire contract (protocol 10 and newer).
//
// What it grants, recorded here because freezing it makes it permanent: a server that stopped its
// start loop (`src/main/server-start-halt.ts`) keeps a minimal Team API up, its safe mode. Only that
// API advertises this capability; a host that started normally never does. A client that sees it
// reads the reason once and shows it. It does not call another route: the host refuses all of them.
// Each member of the server can read the reason, not only owners and admins. The reason is a fixed
// word, the app version of the host and a time. It has no path, no error text and no secret, and it
// does not come from the database: safe mode does not open the database. There is no action on the
// reason. A newer release fixes it, and the update path of the server installs that release.
// Widening any of it needs a second capability string.
import { type AdminDecoder, adminRoute, count, fields, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const SERVER_SAFE_MODE_CAPABILITY = "server-safe-mode-v1";

export const SERVER_SAFE_MODE_ROUTES = {
  reason: "/v1/server/safe-mode",
} as const;

/**
 * Why the server stopped its start loop.
 * - `newer_database`: a newer OpenBot release changed the data. This release cannot open it.
 * - `start_failed`: the start failed several times in a row.
 */
export const SERVER_SAFE_MODE_REASONS = ["newer_database", "start_failed"] as const;
export type ServerSafeModeReasonCode = (typeof SERVER_SAFE_MODE_REASONS)[number];

/** The answer of `SERVER_SAFE_MODE_ROUTES.reason`. */
export interface ServerSafeModeReason {
  reason: ServerSafeModeReasonCode;
  /** The OpenBot version that the server runs. */
  appVersion: string;
  /** When the server stopped its start loop, in milliseconds since the epoch. */
  haltedAt: number;
}

/**
 * The reason is a `GET` with no body. The other admin routes are a `POST` of a record, so `empty` of
 * `admin-wire.ts` refuses this request: a WebRTC client encodes it with this codec before it sends it.
 * The desktop sends no body and the web client sends `{}`, so both are accepted. Anything else is not.
 */
const noBody: AdminDecoder = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return null;
  throw new Error("Invalid server safe mode request.");
};

const reasonResponse = fields({
  reason: oneOf(...SERVER_SAFE_MODE_REASONS),
  appVersion: string(64),
  haltedAt: count,
});

export const SERVER_SAFE_MODE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SERVER_SAFE_MODE_ROUTES.reason, adminRoute(noBody, reasonResponse)],
]);

function isReasonCode(value: unknown): value is ServerSafeModeReasonCode {
  return SERVER_SAFE_MODE_REASONS.some((code) => code === value);
}

/** The reason as the host sends it. A malformed answer throws. */
export function decodeServerSafeModeReason(value: unknown): ServerSafeModeReason {
  const decoded = reasonResponse(value);
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded))
    throw new Error("Invalid server safe mode reason.");
  const { reason, appVersion, haltedAt } = decoded;
  if (!isReasonCode(reason) || typeof appVersion !== "string" || typeof haltedAt !== "number")
    throw new Error("Invalid server safe mode reason.");
  return { reason, appVersion, haltedAt };
}
