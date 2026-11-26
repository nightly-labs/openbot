import { type AgentProviderId, isAgentProvider } from "../agent-providers";
import {
  isProviderAccountPoolStrategy,
  PROVIDER_ACCOUNT_POOL_STRATEGIES,
  type ProviderAccountPool,
  type ProviderAccountPoolStrategy,
} from "../ipc-agent-status";
import { isDynamicRecord } from "../runtime-values";
import { adminRoute, empty, fields, list, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const PROVIDER_ACCOUNT_POOL_STRATEGY_CAPABILITY = "provider-account-pool-strategy-v1";

export const PROVIDER_ACCOUNT_POOL_STRATEGY_ROUTES = {
  list: "/v1/admin/providers/accounts/pool/strategy",
  update: "/v1/admin/providers/accounts/pool/strategy/update",
} as const;

const PROVIDER_LIMIT = 64;
const provider = string(PROVIDER_LIMIT);
const strategy = oneOf(...PROVIDER_ACCOUNT_POOL_STRATEGIES);

export const PROVIDER_ACCOUNT_POOL_STRATEGY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    PROVIDER_ACCOUNT_POOL_STRATEGY_ROUTES.list,
    adminRoute(empty, fields({ strategies: list(fields({ provider, strategy }), PROVIDER_LIMIT) })),
  ],
  [PROVIDER_ACCOUNT_POOL_STRATEGY_ROUTES.update, adminRoute(fields({ provider, strategy }), empty)],
]);

export interface ProviderAccountPoolStrategyRow {
  provider: AgentProviderId;
  strategy: ProviderAccountPoolStrategy;
}

export function decodeProviderAccountPoolStrategies(value: unknown): ProviderAccountPoolStrategyRow[] {
  const invalid = () => new Error("Invalid provider account pool strategies.");
  if (!isDynamicRecord(value) || !Array.isArray(value.strategies)) throw invalid();
  return value.strategies.flatMap((row: unknown) => {
    if (!isDynamicRecord(row) || !isProviderAccountPoolStrategy(row.strategy)) throw invalid();
    return isAgentProvider(row.provider) ? [{ provider: row.provider, strategy: row.strategy }] : [];
  });
}

export function withProviderAccountPoolStrategies<Row extends { provider: AgentProviderId; pool: ProviderAccountPool }>(
  pools: readonly Row[],
  strategies: readonly ProviderAccountPoolStrategyRow[],
): Row[] {
  const byProvider = new Map(strategies.map((row) => [row.provider, row.strategy] as const));
  return pools.map((row) => {
    const strategy = byProvider.get(row.provider);
    return strategy ? { ...row, pool: { ...row.pool, strategy } } : row;
  });
}
