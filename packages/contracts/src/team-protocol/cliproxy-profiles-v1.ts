// Frozen optional cliproxy-profiles-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can create, list, and update dedicated CLIProxy-backed profiles on Claude, Codex, and
// Antigravity without modifying the provider's native sign-in. Each profile runs in its own
// isolated account folder with its proxy URL and optional encrypted API key. `provider-accounts-v1`
// lists, renames, and removes such a profile as any other account; `list` overlays the proxy base
// URLs so clients can badge and edit them without changing the frozen `provider-accounts-v1` shape.
//
// `save` creates a profile when `accountId` is null, and updates an existing CLIProxy profile when
// `accountId` names one. The API key travels to the host only; no route gives a key back.
// `requireAdmin` on the host is the only gate, as on `provider-accounts-v1`.
import { adminRoute, empty, fields, list, nullable, type OptionalRouteCodec, string } from "./admin-wire";
import { PROVIDER_ACCOUNT_ID, PROVIDER_ACCOUNTS_LABEL_LIMIT } from "./provider-accounts-v1";

export const CLIPROXY_PROFILES_CAPABILITY = "cliproxy-profiles-v1";

export const CLIPROXY_PROFILES_ROUTES = {
  list: "/v1/admin/providers/accounts/cliproxy/list",
  save: "/v1/admin/providers/accounts/cliproxy/save",
} as const;

export const CLIPROXY_PROFILE_URL_LIMIT = 2_048;
const CLIPROXY_PROFILE_LIST_LIMIT = 64;

export const CLIPROXY_PROFILES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    CLIPROXY_PROFILES_ROUTES.list,
    adminRoute(
      empty,
      fields({
        profiles: list(
          fields({
            provider: string(64),
            accountId: PROVIDER_ACCOUNT_ID,
            baseUrl: string(CLIPROXY_PROFILE_URL_LIMIT),
          }),
          CLIPROXY_PROFILE_LIST_LIMIT,
        ),
      }),
    ),
  ],
  [
    CLIPROXY_PROFILES_ROUTES.save,
    adminRoute(
      fields({
        provider: string(64),
        accountId: nullable(PROVIDER_ACCOUNT_ID),
        label: nullable(string(PROVIDER_ACCOUNTS_LABEL_LIMIT)),
        baseUrl: string(CLIPROXY_PROFILE_URL_LIMIT),
        apiKey: nullable(string(512)),
      }),
      empty,
    ),
  ],
]);
