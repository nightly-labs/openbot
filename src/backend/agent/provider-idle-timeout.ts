/**
 * How long a provider CLI stays running with nothing to do before its process is stopped.
 * Can be overridden with `OPENBOT_PROVIDER_IDLE_TIMEOUT_MS` (0 disables idle release).
 */
export const DEFAULT_PROVIDER_IDLE_RELEASE_MS = 10 * 60_000;

export function configuredProviderIdleReleaseMs(envValue?: string): number | null {
  const env = (envValue !== undefined ? envValue : process.env.OPENBOT_PROVIDER_IDLE_TIMEOUT_MS)?.trim();
  if (!env) return DEFAULT_PROVIDER_IDLE_RELEASE_MS;
  const parsed = Number(env);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_PROVIDER_IDLE_RELEASE_MS;
  return parsed === 0 ? null : parsed;
}
