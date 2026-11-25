const FIRE_AT_TTL_SHARE = 0.9;
const LATE_LIMIT_MS = 60_000;
const CACHE_EXPIRY_COMPACTION_MIN_TOKENS = 200_000;
const CACHE_EXPIRY_COMPACTION_MIN_TTL_MS = 60 * 60_000;

interface CacheExpiryCompactionOptions {
  usedTokens(threadId: string): number | null;
  start(agentId: string, threadId: string): void;
  delayMs?: number | undefined;
  enabled?: (() => boolean) | undefined;
}

interface ArmedCompaction {
  agentId: string;
  timer: NodeJS.Timeout;
}

export class CacheExpiryCompaction {
  readonly #options: CacheExpiryCompactionOptions;
  readonly #armed = new Map<string, ArmedCompaction>();

  constructor(options: CacheExpiryCompactionOptions) {
    this.#options = options;
  }

  idle(agentId: string, threadId: string, ttlMs: number | null): void {
    this.cancel(threadId);
    if (!this.#enabled() || ttlMs === null || ttlMs < CACHE_EXPIRY_COMPACTION_MIN_TTL_MS) return;
    const delayMs = this.#options.delayMs ?? Math.round(ttlMs * FIRE_AT_TTL_SHARE);
    const dueAt = Date.now() + delayMs;
    const timer = setTimeout(() => this.#fire(agentId, threadId, dueAt), delayMs);
    timer.unref?.();
    this.#armed.set(threadId, { agentId, timer });
  }

  cancel(threadId: string): void {
    const armed = this.#armed.get(threadId);
    if (!armed) return;
    clearTimeout(armed.timer);
    this.#armed.delete(threadId);
  }

  forgetAgent(agentId: string): void {
    for (const [threadId, armed] of this.#armed) if (armed.agentId === agentId) this.cancel(threadId);
  }

  dispose(): void {
    for (const armed of this.#armed.values()) clearTimeout(armed.timer);
    this.#armed.clear();
  }

  #enabled(): boolean {
    return this.#options.enabled?.() ?? true;
  }

  #fire(agentId: string, threadId: string, dueAt: number): void {
    this.#armed.delete(threadId);
    if (!this.#enabled() || Date.now() - dueAt > LATE_LIMIT_MS) return;
    if ((this.#options.usedTokens(threadId) ?? 0) < CACHE_EXPIRY_COMPACTION_MIN_TOKENS) return;
    this.#options.start(agentId, threadId);
  }
}
