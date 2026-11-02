// Frozen optional browser-secret-vault-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a joined
// server types a password into the secure card of a host agent, and the host keeps it in its own Vault
// after it submits it. The request is the submit of the released `/v1/browser-secrets/respond` route
// with the same fields; the host answers it the same way, and then saves the password as a login for the
// site of the request. The client also needs `browser-secret-handoff`, as for the released route. A
// member cannot use the route; `requireAdmin` on the host is the gate, as for `vault-v1`. The answer
// never carries the password. Widening any of it needs a second capability.
import { isRequestId } from "../ipc-bounded-values";
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const BROWSER_SECRET_VAULT_CAPABILITY = "browser-secret-vault-v1";

export const BROWSER_SECRET_VAULT_ROUTES = {
  respond: "/v1/browser-secrets/respond-and-save",
} as const;

const requestId: AdminDecoder = (value) => {
  if (!isRequestId(value)) throw new Error("Invalid admin identifier.");
  return value;
};

export const BROWSER_SECRET_VAULT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    BROWSER_SECRET_VAULT_ROUTES.respond,
    adminRoute(fields({ requestId, agentId: identifier, secret: string(4096) }), empty),
  ],
]);
