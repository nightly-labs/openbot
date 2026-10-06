import { Effect, Schema } from "effect";
import type { WorkerBindings } from "./types";

const RETRY_AFTER_SECONDS = 60;

export type MarketplaceMutationKind = "mutation" | "upload";

export class MarketplaceRateLimitError extends Schema.TaggedError<MarketplaceRateLimitError>()(
  "MarketplaceRateLimitError",
  { message: Schema.String },
) {
  readonly status = 429;
  readonly code = "rate_limited";
  readonly retryAfterSeconds = RETRY_AFTER_SECONDS;

  constructor() {
    super({ message: "Too many marketplace requests. Try again later." });
  }
}

class MarketplaceLimiterError extends Schema.TaggedError<MarketplaceLimiterError>()("MarketplaceLimiterError", {}) {}

export const enforceMarketplaceIngress = Effect.fn("MarketplacePolicy.enforceMarketplaceIngress")(function* (
  request: Request,
  bindings: Pick<WorkerBindings, "MARKETPLACE_INGRESS_RATE_LIMITER">,
) {
  if (!isMarketplacePath(new URL(request.url).pathname)) return;
  const sourceIp =
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown";
  const result = yield* Effect.tryPromise({
    try: () => bindings.MARKETPLACE_INGRESS_RATE_LIMITER.limit({ key: `ip:${sourceIp}` }),
    catch: () => new MarketplaceLimiterError({}),
  });
  if (!result.success) return yield* new MarketplaceRateLimitError();
});

export const enforceMarketplaceMutation = Effect.fn("MarketplacePolicy.enforceMarketplaceMutation")(function* (
  bindings: Pick<WorkerBindings, "MARKETPLACE_MUTATION_RATE_LIMITER" | "MARKETPLACE_UPLOAD_RATE_LIMITER">,
  kind: MarketplaceMutationKind,
  principal: string,
) {
  const limiter =
    kind === "upload" ? bindings.MARKETPLACE_UPLOAD_RATE_LIMITER : bindings.MARKETPLACE_MUTATION_RATE_LIMITER;
  const result = yield* Effect.tryPromise({
    try: () => limiter.limit({ key: `${kind}:${principal}` }),
    catch: () => new MarketplaceLimiterError({}),
  });
  if (!result.success) return yield* new MarketplaceRateLimitError();
});

function isMarketplacePath(pathname: string): boolean {
  return (
    pathname === "/v1/skills" ||
    pathname.startsWith("/v1/skills/") ||
    pathname.startsWith("/v1/marketplace/agents") ||
    pathname.startsWith("/v1/agent-templates")
  );
}
