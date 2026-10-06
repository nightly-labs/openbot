import { Effect, Result, Schema } from "effect";
import { importPKCS8, SignJWT } from "jose";

/**
 * Installation tokens of the OpenBot GitHub App for one signed-in GitHub user.
 *
 * A user token (`ghu_`) makes GitHub show "user with OpenBotGit". An installation token (`ghs_`)
 * makes GitHub show `openbotgit[bot]`, but it needs the app's private key, which only this Worker
 * holds. An installation token can do everything that the installation allows, so this service
 * gives one only for the repositories where the user of the token can push. The desktop keeps the
 * user token for every other repository.
 *
 * The Worker keeps nothing: it does not store or log a token.
 */

export type GitHubFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface GitHubInstallationToken {
  installationId: number;
  /** The login of the user or organization that installed the app. */
  account: string;
  token: string;
  expiresAt: string;
  /** `owner/name`, as GitHub spells it. */
  repositories: string[];
}

export interface GitHubInstallationTokensOptions {
  /** The client ID of the app. GitHub accepts it as the `iss` of the app JWT. */
  clientId: string;
  /** The app's private key as a PKCS #8 PEM. */
  privateKey: string;
  /** Wraps the global `fetch`, as `(input, init) => fetch(input, init)`: workerd refuses a bare method reference. */
  fetch: GitHubFetch;
  now?: () => number;
}

export class GitHubInstallationTokensError extends Schema.TaggedError<GitHubInstallationTokensError>()(
  "GitHubInstallationTokensError",
  { status: Schema.Number, code: Schema.String, message: Schema.String },
) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
/** A Worker request can make a limited count of subrequests, so a very large account gets a part of its installations. */
const MAX_INSTALLATIONS = 20;
const MAX_REPOSITORY_PAGES = 10;
/** GitHub limits `repository_ids` to 500 in one token. */
const MAX_REPOSITORIES_PER_TOKEN = 500;

const appSchema = Schema.Struct({ id: Schema.Number });
const installationsSchema = Schema.Struct({
  installations: Schema.Array(
    Schema.Struct({ id: Schema.Number, app_id: Schema.Number, account: Schema.Struct({ login: Schema.String }) }),
  ),
});
const repositoriesSchema = Schema.Struct({
  total_count: Schema.Number,
  repositories: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      full_name: Schema.String,
      permissions: Schema.optional(
        Schema.Struct({
          push: Schema.optional(Schema.Boolean),
          maintain: Schema.optional(Schema.Boolean),
          admin: Schema.optional(Schema.Boolean),
        }),
      ),
    }),
  ),
});
const accessTokenSchema = Schema.Struct({ token: Schema.NonEmptyString, expires_at: Schema.String });

type Credential = { kind: "user"; token: string } | { kind: "app" };
const APP: Credential = { kind: "app" };

interface WritableRepository {
  id: number;
  fullName: string;
}

export class GitHubInstallationTokens {
  readonly #options: GitHubInstallationTokensOptions;
  readonly #now: () => number;
  #key: CryptoKey | null = null;
  #appId: number | null = null;

  constructor(options: GitHubInstallationTokensOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** The tokens for installations where this user can push to a repository. */

  readonly issue = Effect.fn("GitHubInstallationTokens.issue")(function* (
    this: GitHubInstallationTokens,
    userToken: string,
  ): Effect.fn.Return<GitHubInstallationToken[], GitHubInstallationTokensError> {
    const appId = yield* this.#readAppId();
    const user: Credential = { kind: "user", token: userToken };
    const { installations } = yield* this.#get(`/user/installations?per_page=${PAGE_SIZE}`, user, installationsSchema);
    const tokens: GitHubInstallationToken[] = [];
    for (const installation of installations.filter((entry) => entry.app_id === appId).slice(0, MAX_INSTALLATIONS)) {
      const result = yield* Effect.result(
        this.#issueForInstallation(installation.id, installation.account.login, user),
      );
      // A suspended installation or SAML SSO refusal must not block the others.
      if (Result.isFailure(result)) {
        if (result.failure.code !== "github_failed") return yield* result.failure;
      } else tokens.push(...result.success);
    }
    return tokens;
  }).bind(this);

  readonly #issueForInstallation = Effect.fn("GitHubInstallationTokens.issueForInstallation")(function* (
    this: GitHubInstallationTokens,
    installationId: number,
    account: string,
    user: Credential,
  ): Effect.fn.Return<GitHubInstallationToken[], GitHubInstallationTokensError> {
    const writable = yield* this.#writableRepositories(installationId, user);
    const tokens: GitHubInstallationToken[] = [];
    for (let start = 0; start < writable.length; start += MAX_REPOSITORIES_PER_TOKEN) {
      const part = writable.slice(start, start + MAX_REPOSITORIES_PER_TOKEN);
      const minted = yield* this.#post(
        `/app/installations/${installationId}/access_tokens`,
        APP,
        { repository_ids: part.map((repository) => repository.id) },
        accessTokenSchema,
      );
      tokens.push({
        installationId,
        account,
        token: minted.token,
        expiresAt: minted.expires_at,
        repositories: part.map((repository) => repository.fullName),
      });
    }
    return tokens;
  });

  readonly #writableRepositories = Effect.fn("GitHubInstallationTokens.writableRepositories")(function* (
    this: GitHubInstallationTokens,
    installationId: number,
    user: Credential,
  ): Effect.fn.Return<WritableRepository[], GitHubInstallationTokensError> {
    const writable: WritableRepository[] = [];
    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const answer = yield* this.#get(
        `/user/installations/${installationId}/repositories?per_page=${PAGE_SIZE}&page=${page}`,
        user,
        repositoriesSchema,
      );
      for (const repository of answer.repositories) {
        const permissions = repository.permissions;
        if (permissions?.push || permissions?.maintain || permissions?.admin) {
          writable.push({ id: repository.id, fullName: repository.full_name });
        }
      }
      if (answer.repositories.length < PAGE_SIZE || page * PAGE_SIZE >= answer.total_count) break;
    }
    return writable;
  });

  readonly #readAppId = Effect.fn("GitHubInstallationTokens.readAppId")(function* (
    this: GitHubInstallationTokens,
  ): Effect.fn.Return<number, GitHubInstallationTokensError> {
    this.#appId ??= (yield* this.#get("/app", APP, appSchema)).id;
    return this.#appId;
  });

  /** The JWT expires within ten minutes and allows sixty seconds of clock skew. */
  readonly #appJwt = Effect.fn("GitHubInstallationTokens.appJwt")(function* (
    this: GitHubInstallationTokens,
  ): Effect.fn.Return<string, GitHubInstallationTokensError> {
    this.#key ??= yield* Effect.tryPromise({
      try: () => importPKCS8(this.#options.privateKey, "RS256"),
      catch: () =>
        new GitHubInstallationTokensError(
          503,
          "github_app_unavailable",
          "The OpenBot GitHub App key is not a PKCS #8 key.",
        ),
    });
    const key = this.#key;
    const seconds = Math.floor(this.#now() / 1000);
    return yield* Effect.tryPromise({
      try: () =>
        new SignJWT({})
          .setProtectedHeader({ alg: "RS256", typ: "JWT" })
          .setIssuer(this.#options.clientId)
          .setIssuedAt(seconds - 60)
          .setExpirationTime(seconds + 9 * 60)
          .sign(key),
      catch: () =>
        new GitHubInstallationTokensError(
          503,
          "github_app_unavailable",
          "The OpenBot GitHub App could not sign a request.",
        ),
    });
  });

  #get<T>(
    path: string,
    credential: Credential,
    schema: Schema.Decoder<T>,
  ): Effect.Effect<T, GitHubInstallationTokensError> {
    return this.#request(path, credential, { method: "GET" }, schema);
  }

  #post<T>(
    path: string,
    credential: Credential,
    body: unknown,
    schema: Schema.Decoder<T>,
  ): Effect.Effect<T, GitHubInstallationTokensError> {
    return this.#request(
      path,
      credential,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      schema,
    );
  }

  /** Do not retain response bodies or causes that can contain a credential. */
  readonly #request = Effect.fn("GitHubInstallationTokens.request")(function* <T>(
    this: GitHubInstallationTokens,
    path: string,
    credential: Credential,
    init: RequestInit,
    schema: Schema.Decoder<T>,
  ): Effect.fn.Return<T, GitHubInstallationTokensError> {
    const route = path.split("?")[0];
    const authorization = credential.kind === "user" ? `token ${credential.token}` : `Bearer ${yield* this.#appJwt()}`;
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        this.#options.fetch(`${GITHUB_API}${path}`, {
          ...init,
          headers: {
            ...init.headers,
            Accept: "application/vnd.github+json",
            Authorization: authorization,
            "User-Agent": "OpenBot",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        }),
      catch: () => new GitHubInstallationTokensError(502, "github_unreachable", "GitHub did not answer."),
    });
    if (response.status === 401) {
      return yield* credential.kind === "user"
        ? new GitHubInstallationTokensError(401, "github_unauthorized", "GitHub refused the GitHub sign-in.")
        : new GitHubInstallationTokensError(
            503,
            "github_app_unavailable",
            "GitHub refused the OpenBot GitHub App key.",
          );
    }
    if (!response.ok)
      return yield* new GitHubInstallationTokensError(
        502,
        "github_failed",
        `GitHub refused ${route} (HTTP ${response.status}).`,
      );
    const invalidResponse = () =>
      new GitHubInstallationTokensError(502, "github_failed", `GitHub sent an unexpected answer for ${route}.`);
    const payload = yield* Effect.tryPromise({ try: () => response.json(), catch: invalidResponse });
    return yield* Schema.decodeUnknownEffect(schema)(payload).pipe(Effect.mapError(invalidResponse));
  });
}
