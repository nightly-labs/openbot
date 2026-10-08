// Frozen optional direct-endpoint-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any signed-in member of a
// server can read the one HTTPS address at which the host serves its Team API inside the owner's
// Tailscale network, or null when the host does not offer one. The host owner turns this on; the
// host then runs `tailscale serve` (never Funnel) to a loopback listener that answers only the
// identity, compatibility and account sign-in routes and the routes that need a member token. The
// request is empty. Only an address of the form `https://<device>.<tailnet>.ts.net[:port]` crosses
// the wire. A client checks the host's pinned key at that address before it sends anything else.
// Widening any of it needs a second capability string.
import { type AdminDecoder, adminRoute, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const DIRECT_ENDPOINT_CAPABILITY = "direct-endpoint-v1";

export const DIRECT_ENDPOINT_ROUTES = {
  read: "/v1/direct-endpoint",
} as const;

export interface DirectEndpointResponse {
  url: string | null;
}

// One DNS label: letters, digits and inner hyphens, at most 63 characters. Lowercase only, as
// MagicDNS writes names. The literal is frozen here so a change to a shared validator cannot move it.
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DIRECT_ENDPOINT_URL = new RegExp(`^https://${LABEL}\\.${LABEL}\\.ts\\.net(?::[1-9][0-9]{0,4})?$`, "u");

const directEndpointUrl: AdminDecoder = (value) => {
  if (typeof value !== "string" || value.length > 300 || !DIRECT_ENDPOINT_URL.test(value)) {
    throw new Error("Invalid direct endpoint.");
  }
  const port = new URL(value).port;
  if (port !== "" && Number(port) > 65_535) throw new Error("Invalid direct endpoint.");
  return value;
};

export const DIRECT_ENDPOINT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [DIRECT_ENDPOINT_ROUTES.read, adminRoute(empty, fields({ url: nullable(directEndpointUrl) }))],
]);
