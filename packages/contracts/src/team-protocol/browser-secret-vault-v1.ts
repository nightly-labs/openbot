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
