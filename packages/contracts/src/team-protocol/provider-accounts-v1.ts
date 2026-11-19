import {
  type AdminDecoder,
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";

export const PROVIDER_ACCOUNTS_CAPABILITY = "provider-accounts-v1";

export const PROVIDER_ACCOUNTS_ROUTES = {
  list: "/v1/admin/providers/accounts/list",
  usage: "/v1/admin/providers/accounts/usage",
  signInStart: "/v1/admin/providers/accounts/sign-in/start",
  signInStatus: "/v1/admin/providers/accounts/sign-in/status",
  signInCancel: "/v1/admin/providers/accounts/sign-in/cancel",
  rename: "/v1/admin/providers/accounts/rename",
  remove: "/v1/admin/providers/accounts/remove",
  agent: "/v1/admin/providers/accounts/agent",
} as const;

export const PROVIDER_ACCOUNTS_MESSAGE_LIMIT = 2_000;
export const PROVIDER_ACCOUNTS_LABEL_LIMIT = 60;
const PROVIDER_LIMIT = 64;
const ACCOUNTS_PER_PROVIDER = 10;
const AGENT_LIMIT = 10_000;

const ACCOUNT_ID = /^(?:default|a[0-9a-f]{16})$/u;

const accountId: AdminDecoder = (value) => {
  if (typeof value !== "string" || !ACCOUNT_ID.test(value)) throw new Error("Invalid provider account.");
  return value;
};
export const PROVIDER_ACCOUNT_ID: AdminDecoder = accountId;
const provider = string(PROVIDER_LIMIT);
const finite: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid admin number.");
  return value;
};

const account = fields({
  id: accountId,
  label: nullable(string(PROVIDER_ACCOUNTS_LABEL_LIMIT)),
  email: nullable(string(254)),
  state: string(64),
  message: nullable(string(PROVIDER_ACCOUNTS_MESSAGE_LIMIT)),
});

const window = fields({ usedPercent: finite, windowDurationMins: nullable(count), resetsAt: nullable(finite) });

const byProvider = fields({ provider });
const byAccount = fields({ provider, accountId });

export const PROVIDER_ACCOUNTS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNTS_ROUTES.list,
    adminRoute(
      empty,
      fields({
        providers: list(fields({ provider, accounts: list(account, ACCOUNTS_PER_PROVIDER) }), PROVIDER_LIMIT),
        agents: list(fields({ agentId: identifier, accountId }), AGENT_LIMIT),
      }),
    ),
  ],
  [
    PROVIDER_ACCOUNTS_ROUTES.usage,
    adminRoute(
      empty,
      fields({
        limits: list(
          fields({ id: provider, accountId, primary: nullable(window), secondary: nullable(window) }),
          PROVIDER_LIMIT * ACCOUNTS_PER_PROVIDER,
        ),
      }),
    ),
  ],
  [PROVIDER_ACCOUNTS_ROUTES.signInStart, adminRoute(fields({ provider, accountId: nullable(accountId) }), empty)],
  [
    PROVIDER_ACCOUNTS_ROUTES.signInStatus,
    adminRoute(
      byProvider,
      fields({
        tabId: nullable(string(128)),
        result: nullable(fields({ error: nullable(string(PROVIDER_ACCOUNTS_MESSAGE_LIMIT)) })),
      }),
    ),
  ],
  [PROVIDER_ACCOUNTS_ROUTES.signInCancel, adminRoute(byProvider, empty)],
  [
    PROVIDER_ACCOUNTS_ROUTES.rename,
    adminRoute(fields({ provider, accountId, label: nullable(string(PROVIDER_ACCOUNTS_LABEL_LIMIT)) }), empty),
  ],
  [PROVIDER_ACCOUNTS_ROUTES.remove, adminRoute(byAccount, empty)],
  [PROVIDER_ACCOUNTS_ROUTES.agent, adminRoute(fields({ agentId: identifier, accountId: nullable(accountId) }), empty)],
]);
