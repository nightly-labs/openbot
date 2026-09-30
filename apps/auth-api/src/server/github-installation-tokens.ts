import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

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

export class GitHubInstallationTokensError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
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

const appSchema = z.object({ id: z.number() });
const installationsSchema = z.object({
  installations: z.array(z.object({ id: z.number(), app_id: z.number(), account: z.object({ login: z.string() }) })),
});
const repositoriesSchema = z.object({
  total_count: z.number(),
  repositories: z.array(
    z.object({
      id: z.number(),
      full_name: z.string(),
      permissions: z
        .object({ push: z.boolean().optional(), maintain: z.boolean().optional(), admin: z.boolean().optional() })
        .optional(),
    }),
  ),
});
const accessTokenSchema = z.object({ token: z.string().min(1), expires_at: z.string() });

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

  /** The tokens for each installation of this app where the user of `userToken` can push to a repository. */
  async issue(userToken: string): Promise<GitHubInstallationToken[]> {
    const appId = await this.#readAppId();
    const user: Credential = { kind: "user", token: userToken };
    const { installations } = await this.#get(`/user/installations?per_page=${PAGE_SIZE}`, user, installationsSchema);
    const tokens: GitHubInstallationToken[] = [];
    // `/user/installations` lists the installations of the app that issued the user token. A token
    // from another app lists that app's installations, which this app has no token for.
    for (const installation of installations.filter((entry) => entry.app_id === appId).slice(0, MAX_INSTALLATIONS)) {
      try {
        tokens.push(...(await this.#issueForInstallation(installation.id, installation.account.login, user)));
      } catch (error) {
        // GitHub can refuse one installation, as for an organization with SAML SSO or a suspended
        // app. The other installations still get their tokens.
        if (!(error instanceof GitHubInstallationTokensError && error.code === "github_failed")) throw error;
      }
    }
    return tokens;
  }

  async #issueForInstallation(
    installationId: number,
    account: string,
    user: Credential,
  ): Promise<GitHubInstallationToken[]> {
    const writable = await this.#writableRepositories(installationId, user);
    const tokens: GitHubInstallationToken[] = [];
    for (let start = 0; start < writable.length; start += MAX_REPOSITORIES_PER_TOKEN) {
      const part = writable.slice(start, start + MAX_REPOSITORIES_PER_TOKEN);
      const minted = await this.#post(
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
  }

  async #writableRepositories(installationId: number, user: Credential): Promise<WritableRepository[]> {
    const writable: WritableRepository[] = [];
    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const answer = await this.#get(
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
  }

  async #readAppId(): Promise<number> {
    this.#appId ??= (await this.#get("/app", APP, appSchema)).id;
    return this.#appId;
  }

  /** GitHub accepts an app JWT for at most 10 minutes. `iat` is 60 s early for a clock that is behind. */
  async #appJwt(): Promise<string> {
    try {
      this.#key ??= await importPKCS8(this.#options.privateKey, "RS256");
    } catch {
      throw new GitHubInstallationTokensError(
        503,
        "github_app_unavailable",
        "The OpenBot GitHub App key is not a PKCS #8 key.",
      );
    }
    const seconds = Math.floor(this.#now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.#options.clientId)
      .setIssuedAt(seconds - 60)
      .setExpirationTime(seconds + 9 * 60)
      .sign(this.#key);
  }

  #get<T>(path: string, credential: Credential, schema: z.ZodType<T>): Promise<T> {
    return this.#request(path, credential, { method: "GET" }, schema);
  }

  #post<T>(path: string, credential: Credential, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.#request(
      path,
      credential,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      schema,
    );
  }

  /** An error names the path and the status only: a GitHub answer can echo a request header. */
  async #request<T>(path: string, credential: Credential, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    const route = path.split("?")[0];
    const authorization = credential.kind === "user" ? `token ${credential.token}` : `Bearer ${await this.#appJwt()}`;
    let response: Response;
    try {
      response = await this.#options.fetch(`${GITHUB_API}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Accept: "application/vnd.github+json",
          Authorization: authorization,
          "User-Agent": "OpenBot",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GitHubInstallationTokensError(502, "github_unreachable", "GitHub did not answer.");
    }
    if (response.status === 401) {
      throw credential.kind === "user"
        ? new GitHubInstallationTokensError(401, "github_unauthorized", "GitHub refused the GitHub sign-in.")
        : new GitHubInstallationTokensError(
            503,
            "github_app_unavailable",
            "GitHub refused the OpenBot GitHub App key.",
          );
    }
    if (!response.ok) {
      throw new GitHubInstallationTokensError(
        502,
        "github_failed",
        `GitHub refused ${route} (HTTP ${response.status}).`,
      );
    }
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new GitHubInstallationTokensError(502, "github_failed", `GitHub sent an unexpected answer for ${route}.`);
    }
    return parsed.data;
  }
}
