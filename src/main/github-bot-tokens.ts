// The installation tokens of the OpenBot GitHub App that the OpenBot API gives this computer, so
// that GitHub shows an agent's work as the app and not as the signed-in user.

import { createOpenBotLogger, registerSecretValue, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { z } from "zod";
import type { GitHubFetch } from "./github-device-flow";
import { GitHubOperationError, githubCall, githubDecode } from "./github-effects";

const logger = createOpenBotLogger("github-bot-tokens");

/** An installation token lasts one hour. It is replaced when less than this is left. */
const RENEW_MARGIN_MS = 10 * 60_000;
/** After a failure, an API with no app key, or an answer with no token, the next request waits this long. */
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
  /** The origin of the OpenBot API, such as `https://api.openbot.run`. */
  apiUrl: string;
  fetch: GitHubFetch;
  now: () => number;
}

/**
 * The bot token for each repository where the signed-in user can push. A repository with no bot
 * token uses the user token: the API gives a bot token only where the user can already write, so
 * the bot never reaches more than the user.
 *
 * The API gets the user token as its bearer and keeps nothing. When it has no app key, or cannot be
 * reached, agents keep working as the user.
 */
export class GitHubBotTokens {
  readonly #apiUrl: string;
  readonly #fetch: GitHubFetch;
  readonly #now: () => number;
  /** `owner/name` in lower case, as GitHub compares it. */
  #byRepository = new Map<string, GitHubBotToken>();
  /** When the next request is due. */
  #nextAt = 0;
  /** Increased by `clear`, so that an answer for the account before it is not kept. */
  #epoch = 0;
  #failureLogged = false;

  constructor(options: GitHubBotTokensOptions) {
    this.#apiUrl = options.apiUrl;
    this.#fetch = options.fetch;
    this.#now = options.now;
  }

  /** The bot token for `owner/name`, or null when the user token applies. */
  forRepository(owner: string, name: string): string | null {
    const entry = this.#byRepository.get(`${owner}/${name}`.toLowerCase());
    return entry && entry.expiresAt > this.#now() ? entry.token : null;
  }

  /** Each repository with a valid bot token, for the file that the git credential helper reads. */
  entries(): Array<[repository: string, token: string]> {
    const now = this.#now();
    return [...this.#byRepository]
      .filter(([, entry]) => entry.expiresAt > now)
      .map(([repository, entry]) => [repository, entry.token]);
  }

  /** Whether a request is due: a token is near its end, or the last failure was long enough ago. */
  due(): boolean {
    return this.#now() >= this.#nextAt;
  }

  /** Asks for a new set at the next check, as after an install that added repositories. */
  invalidate(): void {
    this.#nextAt = 0;
  }

  clear(): void {
    this.#byRepository = new Map();
    this.#nextAt = 0;
    this.#epoch += 1;
  }

  /**
   * Replaces the set with the API's answer. A failure keeps the tokens that are still valid and
   * does not reject. An answer that arrives after `clear` is discarded.
   */

  readonly renew = Effect.fn("GitHubBotTokens.renew")(function* (
    this: GitHubBotTokens,
    userToken: string,
    signal?: AbortSignal,
  ): Effect.fn.Return<void, GitHubOperationError> {
    const epoch = this.#epoch;
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
        // This API has no app key: agents act as the user until it does.
        this.#byRepository = new Map();
        this.#nextAt = this.#now() + RETRY_MS;
        return;
      }
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
          // Due again when the first token ends, so that the caller removes it from its files.
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
  });
}
