// Frozen optional provider-sign-out-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// joined server can sign the host's own sign-in of a provider out. A member cannot use the route;
// `requireAdmin` on the host is the only gate.
//
// `signOut` runs the provider CLI's sign-out in the host's own home folder and stops the provider.
// The provider then needs a sign-in; its agents keep it and wait. The host's other accounts of the
// provider and their folders stay. The host refuses a provider it does not know, a provider that is
// working on a turn, and one whose CLI has no sign-out.
//
// A provider is an open bounded string. No credential travels on this route.
import { adminRoute, empty, fields, type OptionalRouteCodec, string } from "./admin-wire";

export const PROVIDER_SIGN_OUT_CAPABILITY = "provider-sign-out-v1";

export const PROVIDER_SIGN_OUT_ROUTES = {
  signOut: "/v1/admin/providers/sign-out",
} as const;

const PROVIDER_LIMIT = 64;

export const PROVIDER_SIGN_OUT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PROVIDER_SIGN_OUT_ROUTES.signOut, adminRoute(fields({ provider: string(PROVIDER_LIMIT) }), empty)],
]);
