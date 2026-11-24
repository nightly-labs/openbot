const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Statuses that mean "slow down": the site is rate limiting or unavailable. */
const BACK_OFF_STATUSES: ReadonlySet<number> = new Set([429, 503]);

export interface SiteCooldownOptions {
  readonly now?: () => number;
  readonly defaultMs?: number;
  readonly maxMs?: number;
}

export interface SiteCooldown {
  /** Record the status of a page load. 429 and 503 start or extend a cooldown; a 2xx or 3xx clears it. */
  readonly recordStatus: (origin: string, status: number, retryAfter?: string | null) => void;
  /** Record a bot check or captcha that the browser could not pass. It always starts the default cooldown. */
  readonly recordBlock: (origin: string) => void;
  /** Milliseconds until the origin may be loaded again, 0 when it may be loaded now. */
  readonly waitMs: (origin: string) => number;
}

/** Retry-After is either whole seconds or an HTTP date. Returns milliseconds from `now`, or null when unusable. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (/^\d+$/u.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * A per-origin cooldown that the browser host can consult before it loads a page. It only keeps origins,
 * statuses and times: no URLs, paths or page content.
 */
export function createSiteCooldown(options: SiteCooldownOptions = {}): SiteCooldown {
  const now = options.now ?? Date.now;
  const defaultMs = options.defaultMs ?? DEFAULT_COOLDOWN_MS;
  const maxMs = options.maxMs ?? MAX_COOLDOWN_MS;
  // Rate limits clear on the next good load. A bot-check block does not: a cached 200 must not end it.
  const rateUntil = new Map<string, number>();
  const blockUntil = new Map<string, number>();

  const start = (map: Map<string, number>, origin: string, ms: number): void => {
    const end = now() + Math.min(maxMs, Math.max(0, ms));
    map.set(origin, Math.max(map.get(origin) ?? 0, end));
  };

  return {
    recordStatus(origin, status, retryAfter) {
      if (BACK_OFF_STATUSES.has(status)) {
        start(rateUntil, origin, parseRetryAfter(retryAfter, now()) ?? defaultMs);
        return;
      }
      if (status < 400) rateUntil.delete(origin);
    },
    recordBlock(origin) {
      start(blockUntil, origin, defaultMs);
    },
    waitMs(origin) {
      const left = Math.max((rateUntil.get(origin) ?? 0) - now(), (blockUntil.get(origin) ?? 0) - now());
      if (left > 0) return left;
      rateUntil.delete(origin);
      blockUntil.delete(origin);
      return 0;
    },
  };
}
