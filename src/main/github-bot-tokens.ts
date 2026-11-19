import { createOpenBotLogger, registerSecretValue, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import type { GitHubFetch } from "./github-device-flow";
import { GitHubOperationError, githubCall, githubDecode } from "./github-effects";

const logger = createOpenBotLogger("github-bot-tokens");

const RENEW_MARGIN_MS = 10 * 60_000;
const RETRY_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

const answerSchema = z.object({
  installations: z.array(
    z.object({
      installationId: z.number(),
      account: z.string(),
      token: z.string().min(1),
      expiresAt: z.string(),
      repositories: z.array(z.string().min(1)),
    }),
  ),
});

export interface GitHubBotToken {
  token: string;
  expiresAt: number;
}

export interface GitHubBotTokensOptions {
  apiUrl: string;
  fetch: GitHubFetch;
  now: () => number;
}

export class GitHubBotTokens {
  readonly #apiUrl: string;
  readonly #fetch: GitHubFetch;
  readonly #now: () => number;
  #byRepository = new Map<string, GitHubBotToken>();
  #nextAt = 0;
  #epoch = 0;
  #failureLogged = false;

  constructor(options: GitHubBotTokensOptions) {
    this.#apiUrl = options.apiUrl;
    this.#fetch = options.fetch;
    this.#now = options.now;
  }

  forRepository(owner: string, name: string): string | null {
    const entry = this.#byRepository.get(`${owner}/${name}`.toLowerCase());
    return entry && entry.expiresAt > this.#now() ? entry.token : null;
  }

  entries(): Array<[repository: string, token: string]> {
    const now = this.#now();
    return [...this.#byRepository]
      .filter(([, entry]) => entry.expiresAt > now)
      .map(([repository, entry]) => [repository, entry.token]);
  }

  due(): boolean {
    return this.#now() >= this.#nextAt;
  }

  invalidate(): void {
    this.#nextAt = 0;
  }

  clear(): void {
    this.#byRepository = new Map();
    this.#nextAt = 0;
    this.#epoch += 1;
  }

  readonly renew = Effect.fn("GitHubBotTokens.renew")(function* (
    this: GitHubBotTokens,
    userToken: string,
    signal?: AbortSignal,
  ): Effect.fn.Return<boolean, GitHubOperationError> {
    const epoch = this.#epoch;
    let refused = false;
    yield* Effect.gen({ self: this }, function* () {
      const response = yield* githubCall((fiberSignal) =>
        this.#fetch(new URL("/v1/github/installation-tokens", this.#apiUrl).toString(), {
          method: "POST",
          headers: { Authorization: `Bearer ${userToken}`, Accept: "application/json" },
          signal: signal
            ? AbortSignal.any([signal, fiberSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
            : AbortSignal.any([fiberSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        }),
      );
      if (epoch !== this.#epoch) return;
      if (response.status === 503) {
        this.#byRepository = new Map();
        this.#nextAt = this.#now() + RETRY_MS;
        return;
      }
      refused = response.status === 401;
      if (!response.ok)
        return yield* new GitHubOperationError({
          cause: new Error(`The OpenBot API refused the GitHub token request (HTTP ${response.status}).`),
        });
      const json = yield* githubCall(() => response.json());
      const answer = yield* githubDecode(() => answerSchema.parse(json));
      if (epoch !== this.#epoch) return;
      const next = new Map<string, GitHubBotToken>();
      for (const installation of answer.installations) {
        const expiresAt = Date.parse(installation.expiresAt);
        if (!Number.isFinite(expiresAt)) continue;
        registerSecretValue(installation.token);
        for (const repository of installation.repositories) {
          next.set(repository.toLowerCase(), { token: installation.token, expiresAt });
        }
      }
      this.#byRepository = next;
      const firstExpiry = Math.min(...[...next.values()].map((entry) => entry.expiresAt));
      this.#nextAt = next.size > 0 ? firstExpiry - RENEW_MARGIN_MS : this.#now() + RETRY_MS;
      this.#failureLogged = false;
    }).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.sync(() => {
          if (signal?.aborted || epoch !== this.#epoch) return;
          const now = this.#now();
          const expiries = [...this.#byRepository.values()].map((entry) => entry.expiresAt).filter((at) => at > now);
          this.#nextAt = Math.min(now + RETRY_MS, ...expiries);
          if (!this.#failureLogged) {
            this.#failureLogged = true;
            logger.warn("The GitHub App tokens could not be renewed. Agents act on GitHub as the signed-in user.", {
              cause: toLogValue(error),
            });
          }
        }),
      ),
    );
    return refused;
  });
}
