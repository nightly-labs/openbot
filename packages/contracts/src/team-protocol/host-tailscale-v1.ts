// Frozen optional host-tailscale-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: the owner of a server, and
// only the owner, can read the state of the host's Tailscale client, turn the host's direct Tailscale
// path (`direct-endpoint-v1`) on and off, and ask the host to start a Tailscale sign-in. An admin or a
// member cannot use the routes; `requireOwner` on the host is the only role gate. The owner decides
// which network the host's computer joins, as the owner alone turns the direct path on in the host's
// own window.
//
// Every route answers with the same snapshot. It holds the tailnet name, the device name and the
// MagicDNS name of the host, so the owner's client can compare them with its own tailnet. Members
// never receive them. `loginUrl` is the sign-in page that the host's Tailscale client reports while
// it waits for a sign-in; only an address of the form `https://login.tailscale.com/a/<code>` crosses
// the wire. The owner opens it and approves the host in their own tailnet. The host never sends an
// auth key, and never turns Funnel on.
//
// `sign-in` runs `tailscale up` on the host as the OpenBot user, with a fixed argument list and a short
// timeout. It needs the Tailscale "operator" permission for that user, which only root can give: a
// self-hosted server gives it with `sudo openbot tailscale setup` (`setupCommand: true`). The host
// cannot install Tailscale itself, because it runs without root. `signInIssue` says why the sign-in
// did not start; it is null on the other routes.
//
// `environment` is `wsl` for a host in WSL, which uses the Windows Tailscale app. `wslNetworking` says
// whether WSL uses mirrored networking, which `tailscale serve` on Windows needs to reach the host's
// loopback listener. It is null when the host is not in WSL or uses a Tailscale installed in WSL.
// A host sends an issue this contract does not list as `serve-failed`.
// Widening any of it needs a second capability string.
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const HOST_TAILSCALE_CAPABILITY = "host-tailscale-v1";

export const HOST_TAILSCALE_ROUTES = {
  status: "/v1/admin/host/tailscale/status",
  direct: "/v1/admin/host/tailscale/direct",
  signIn: "/v1/admin/host/tailscale/sign-in",
} as const;

export const HOST_TAILSCALE_STATES = ["not-installed", "not-running", "signed-out", "stopped", "connected"] as const;

export const HOST_TAILSCALE_ISSUES = [
  "host-offline",
  "tailscale-unavailable",
  "https-certificates-off",
  "port-in-use",
  "funnel-on",
  "serve-failed",
] as const;

export const HOST_TAILSCALE_ENVIRONMENTS = ["linux", "wsl", "other"] as const;

export const HOST_TAILSCALE_WSL_NETWORKING = ["mirrored", "nat", "unknown"] as const;

export const HOST_TAILSCALE_SIGN_IN_ISSUES = ["needs-setup", "failed"] as const;

// One DNS label, lowercase, as MagicDNS writes names. The literals are frozen here, not shared with
// `direct-endpoint-v1`, so a change to one contract cannot move the other.
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DNS_NAME = new RegExp(`^${LABEL}\\.${LABEL}\\.ts\\.net$`, "u");
const DIRECT_URL = new RegExp(`^https://${LABEL}\\.${LABEL}\\.ts\\.net(?::[1-9][0-9]{0,4})?$`, "u");
const LOGIN_URL = /^https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9_-]{1,128}$/u;

/** Whether a host can send this MagicDNS name. A host sends null for a name the contract does not accept. */
export function isHostTailscaleDnsName(value: string): boolean {
  return value.length <= 253 && DNS_NAME.test(value);
}

const dnsName: AdminDecoder = (value) => {
  if (typeof value !== "string" || value.length > 253 || !DNS_NAME.test(value)) throw new Error("Invalid DNS name.");
  return value;
};

const directUrl: AdminDecoder = (value) => {
  if (typeof value !== "string" || value.length > 300 || !DIRECT_URL.test(value)) {
    throw new Error("Invalid direct endpoint.");
  }
  const port = new URL(value).port;
  if (port !== "" && Number(port) > 65_535) throw new Error("Invalid direct endpoint.");
  return value;
};

const loginUrl: AdminDecoder = (value) => {
  if (typeof value !== "string" || !LOGIN_URL.test(value)) throw new Error("Invalid Tailscale sign-in address.");
  return value;
};

const snapshot = fields({
  state: oneOf(...HOST_TAILSCALE_STATES),
  tailnet: nullable(string(200)),
  deviceName: nullable(string(200)),
  dnsName: nullable(dnsName),
  httpsCertificates: boolean,
  enabled: boolean,
  url: nullable(directUrl),
  issue: nullable(oneOf(...HOST_TAILSCALE_ISSUES)),
  issueDetail: nullable(string(300)),
  loginUrl: nullable(loginUrl),
  environment: oneOf(...HOST_TAILSCALE_ENVIRONMENTS),
  wslNetworking: nullable(oneOf(...HOST_TAILSCALE_WSL_NETWORKING)),
  setupCommand: boolean,
  signInIssue: nullable(oneOf(...HOST_TAILSCALE_SIGN_IN_ISSUES)),
});

export const HOST_TAILSCALE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_TAILSCALE_ROUTES.status, adminRoute(empty, snapshot)],
  [HOST_TAILSCALE_ROUTES.direct, adminRoute(fields({ enabled: boolean }), snapshot)],
  [HOST_TAILSCALE_ROUTES.signIn, adminRoute(empty, snapshot)],
]);
