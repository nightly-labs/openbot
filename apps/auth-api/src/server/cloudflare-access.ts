import { Effect } from "effect";
import { createRemoteJWKSet, jwtVerify } from "jose";

const CLOUDFLARE_ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
const JWKS_TIMEOUT_MS = 5_000;

export interface CloudflareAccessConfig {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_ADMIN_AUD?: string;
}

let cachedKeys: { teamDomain: string; keys: ReturnType<typeof createRemoteJWKSet> } | null = null;

function accessKeys(teamDomain: string) {
  if (cachedKeys?.teamDomain !== teamDomain) {
    cachedKeys = {
      teamDomain,
      keys: createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`), {
        timeoutDuration: JWKS_TIMEOUT_MS,
      }),
    };
  }
  return cachedKeys.keys;
}

export const cloudflareAccessAllows = Effect.fn("Auth.cloudflareAccessAllows")(function* (
  config: CloudflareAccessConfig,
  request: Request,
) {
  const teamDomain = config.CF_ACCESS_TEAM_DOMAIN?.trim() ?? "";
  const audience = config.CF_ACCESS_ADMIN_AUD?.trim() ?? "";
  if (!teamDomain && !audience) return true;
  if (!teamDomain || !audience || !/^[a-z0-9.-]+$/u.test(teamDomain)) return false;
  const assertion = request.headers.get(CLOUDFLARE_ACCESS_JWT_HEADER);
  if (!assertion) return false;
  return yield* Effect.tryPromise(() =>
    jwtVerify(assertion, accessKeys(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience,
      algorithms: ["RS256"],
    }),
  ).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
});
