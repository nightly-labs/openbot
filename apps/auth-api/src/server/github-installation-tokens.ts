import {
  GITHUB_ROUTE_EVENTS,
  GITHUB_ROUTE_REPOSITORIES_LIMIT,
  type GitHubRouteRepository,
} from "@openbot/contracts/signal-protocol/github-route";
import { Effect, Result, Schema } from "effect";
import { importPKCS8, SignJWT } from "jose";

type GitHubFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface GitHubInstallationToken {
  installationId: number;
  account: string;
  token: string;
  expiresAt: string;
  repositories: string[];
}

export interface GitHubPublicRepository {
  installationId: number;
  fullName: string;
}

export interface GitHubRepositoryRoute extends GitHubRouteRepository {
  fullName: string;
  events: boolean;
}

export interface GitHubInstallationTokensOptions {
  clientId: string;
  privateKey: string;
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
const MAX_INSTALLATIONS = 20;
const MAX_REPOSITORY_PAGES = 10;
const MAX_REPOSITORIES_PER_TOKEN = 500;
const USER_ONLY_PERMISSIONS: ReadonlySet<string> = new Set(["administration"]);
const LISTING_TOKEN_MARGIN_MS = 5 * 60_000;
const LISTING_PERMISSIONS = { metadata: "read" } as const;
const PUBLIC_LISTING_CONCURRENCY = 4;

const appSchema = Schema.Struct({ id: Schema.Number });
const installationsSchema = Schema.Struct({
  installations: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      app_id: Schema.Number,
      account: Schema.Struct({ login: Schema.String }),
      events: Schema.optional(Schema.Array(Schema.String)),
      permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
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
const installationRepositoriesSchema = Schema.Struct({
  total_count: Schema.Number,
  repositories: Schema.Array(Schema.Struct({ id: Schema.Number, full_name: Schema.String, private: Schema.Boolean })),
});
const accessTokenSchema = Schema.Struct({ token: Schema.NonEmptyString, expires_at: Schema.String });
const repositoryInstallationSchema = Schema.Struct({ id: Schema.Number });
const issueSchema = Schema.Struct({ number: Schema.Number, html_url: Schema.String });
const issueStateSchema = Schema.Struct({
  number: Schema.Number,
  html_url: Schema.String,
  state: Schema.String,
  locked: Schema.Boolean,
  pull_request: Schema.optional(Schema.Unknown),
  user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
});
const searchSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      number: Schema.Number,
      title: Schema.String,
      html_url: Schema.String,
      body: Schema.optional(Schema.NullOr(Schema.String)),
      pull_request: Schema.optional(Schema.Unknown),
    }),
  ),
});
const commentSchema = Schema.Struct({ id: Schema.Number });
const authorSchema = Schema.NullOr(Schema.Struct({ login: Schema.String }));
const feedbackIssueSchema = Schema.Struct({
  node_id: Schema.String,
  repository_url: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  pull_request: Schema.optional(Schema.Unknown),
  user: authorSchema,
});
const feedbackCommentsSchema = Schema.Array(
  Schema.Struct({ id: Schema.Number, body: Schema.optional(Schema.NullOr(Schema.String)), user: authorSchema }),
);
const repositoryNodeSchema = Schema.Struct({ node_id: Schema.String });
const graphqlSchema = Schema.Struct({ errors: Schema.optional(Schema.Array(Schema.Unknown)) });
const MAX_COMMENT_PAGES = 10;

const SIMILAR_ISSUES = 5;
const SIMILAR_SUMMARY_LENGTH = 300;
const FEEDBACK_APP = "openbotgit";

export interface GitHubIssue {
  number: number;
  url: string;
}

export type WithdrawnFeedback = "issue" | "comment" | "gone";

export type FeedbackSender = (body: string) => Effect.Effect<boolean, GitHubInstallationTokensError>;

function notSentBy(): GitHubInstallationTokensError {
  return new GitHubInstallationTokensError(404, "feedback_not_yours", "This account sent no report on this issue.");
}

export interface GitHubSimilarIssue {
  number: number;
  title: string;
  url: string;
  summary: string;
}

function issueSummary(body: string | null | undefined): string {
  const answer = /(?:^|\n)### (?:What happened\?|Problem|Proposed behavior)\n+([\s\S]*?)(?=\n### |\n---\n|$)/.exec(
    body ?? "",
  );
  return (answer?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, SIMILAR_SUMMARY_LENGTH);
}

type Credential = { kind: "user"; token: string } | { kind: "app" } | { kind: "installation"; token: string };
const APP: Credential = { kind: "app" };
const READ_ISSUES = { issues: "read" } as const;
const WRITE_ISSUES = { issues: "write" } as const;

interface WritableRepository {
  id: number;
  fullName: string;
}

function botPermissions(granted: Readonly<Record<string, string>> | undefined): Record<string, string> | null {
  if (!granted) return null;
  const permissions = Object.fromEntries(Object.entries(granted).filter(([name]) => !USER_ONLY_PERMISSIONS.has(name)));
  return Object.keys(permissions).length > 0 ? permissions : null;
}

export class GitHubInstallationTokens {
  readonly #options: GitHubInstallationTokensOptions;
  readonly #now: () => number;
  #key: CryptoKey | null = null;
  #appId: number | null = null;
  readonly #repositoryInstallations = new Map<string, number>();
  readonly #listingTokens = new Map<number, { token: string; expiresAt: number }>();

  constructor(options: GitHubInstallationTokensOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  readonly issue = Effect.fn("GitHubInstallationTokens.issue")(function* (
    this: GitHubInstallationTokens,
    userToken: string,
  ): Effect.fn.Return<GitHubInstallationToken[], GitHubInstallationTokensError> {
    const appId = yield* this.#readAppId();
    const user: Credential = { kind: "user", token: userToken };
    const { installations } = yield* this.#get(`/user/installations?per_page=${PAGE_SIZE}`, user, installationsSchema);
    const tokens: GitHubInstallationToken[] = [];
    for (const installation of installations.filter((entry) => entry.app_id === appId).slice(0, MAX_INSTALLATIONS)) {
      const permissions = botPermissions(installation.permissions);
      if (!permissions) continue;
      const result = yield* Effect.result(
        this.#issueForInstallation(installation.id, installation.account.login, permissions, user),
      );
      if (Result.isFailure(result)) {
        if (result.failure.code !== "github_failed") return yield* result.failure;
      } else tokens.push(...result.success);
    }
    return tokens;
  }).bind(this);

  readonly repositoryRoutes = Effect.fn("GitHubInstallationTokens.repositoryRoutes")(function* (
    this: GitHubInstallationTokens,
    userToken: string,
    names: readonly string[],
  ): Effect.fn.Return<GitHubRepositoryRoute[], GitHubInstallationTokensError> {
    const wanted = new Set(names.slice(0, GITHUB_ROUTE_REPOSITORIES_LIMIT).map((name) => name.toLowerCase()));
    if (wanted.size === 0) return [];
    const appId = yield* this.#readAppId();
    const user: Credential = { kind: "user", token: userToken };
    const { installations } = yield* this.#get(`/user/installations?per_page=${PAGE_SIZE}`, user, installationsSchema);
    const routes: GitHubRepositoryRoute[] = [];
    const ours = installations
      .filter((entry) => entry.app_id === appId)
      .slice(0, MAX_INSTALLATIONS)
      .map((installation) => ({
        id: installation.id,
        events: installation.events ? GITHUB_ROUTE_EVENTS.every((event) => installation.events?.includes(event)) : true,
      }));
    for (const installation of ours) {
      if (wanted.size === 0) break;
      const result = yield* Effect.result(
        this.#eachRepository(installation.id, user, (repository) => {
          const name = repository.full_name.toLowerCase();
          if (!wanted.delete(name)) return wanted.size > 0;
          routes.push({
            id: repository.id,
            installationId: installation.id,
            fullName: repository.full_name,
            events: installation.events,
          });
          return wanted.size > 0;
        }),
      );
      if (Result.isFailure(result) && result.failure.code !== "github_failed") return yield* result.failure;
    }
    for (const installation of ours) {
      if (wanted.size === 0) break;
      const listed = yield* this.#publicInstallationRepositories(installation.id).pipe(Effect.orElseSucceed(() => []));
      for (const repository of listed) {
        if (!wanted.delete(repository.full_name.toLowerCase())) continue;
        routes.push({
          id: repository.id,
          installationId: installation.id,
          fullName: repository.full_name,
          events: installation.events,
        });
      }
    }
    return routes;
  }).bind(this);

  readonly publicRepositories = Effect.fn("GitHubInstallationTokens.publicRepositories")(function* (
    this: GitHubInstallationTokens,
    userToken: string,
  ): Effect.fn.Return<GitHubPublicRepository[], GitHubInstallationTokensError> {
    const appId = yield* this.#readAppId();
    const user: Credential = { kind: "user", token: userToken };
    const { installations } = yield* this.#get(`/user/installations?per_page=${PAGE_SIZE}`, user, installationsSchema);
    const listed = yield* Effect.forEach(
      installations.filter((entry) => entry.app_id === appId).slice(0, MAX_INSTALLATIONS),
      (installation) =>
        this.#publicInstallationRepositories(installation.id).pipe(
          Effect.map((repositories) =>
            repositories.map((repository) => ({ installationId: installation.id, fullName: repository.full_name })),
          ),
          Effect.orElseSucceed((): GitHubPublicRepository[] => []),
        ),
      { concurrency: PUBLIC_LISTING_CONCURRENCY },
    );
    return listed.flat();
  }).bind(this);

  readonly openIssue = Effect.fn("GitHubInstallationTokens.openIssue")(function* (
    this: GitHubInstallationTokens,
    repository: string,
    issue: { title: string; body: string; labels: readonly string[] },
  ): Effect.fn.Return<GitHubIssue, GitHubInstallationTokensError> {
    const token = yield* this.#repositoryToken(repository, WRITE_ISSUES);
    const opened = yield* this.#post(`/repos/${repository}/issues`, token, issue, issueSchema);
    return { number: opened.number, url: opened.html_url };
  }).bind(this);

  readonly commentIssue = Effect.fn("GitHubInstallationTokens.commentIssue")(function* (
    this: GitHubInstallationTokens,
    repository: string,
    number: number,
    comment: string,
  ): Effect.fn.Return<GitHubIssue, GitHubInstallationTokensError> {
    const token = yield* this.#repositoryToken(repository, WRITE_ISSUES);
    const target = yield* this.#send(
      `/repos/${repository}/issues/${number}`,
      token,
      { method: "GET" },
      issueStateSchema,
      [404, 410],
    );
    if (
      target?.state !== "open" ||
      target.locked ||
      target.pull_request !== undefined ||
      target.user?.login !== `${FEEDBACK_APP}[bot]`
    )
      return yield* new GitHubInstallationTokensError(409, "issue_not_open", "The issue is not open.");
    yield* this.#post(`/repos/${repository}/issues/${number}/comments`, token, { body: comment }, commentSchema);
    return { number: target.number, url: target.html_url };
  }).bind(this);

  readonly withdrawFeedback = Effect.fn("GitHubInstallationTokens.withdrawFeedback")(function* (
    this: GitHubInstallationTokens,
    repository: string,
    number: number,
    sentBy: FeedbackSender,
    privateRepository: string | null,
  ): Effect.fn.Return<WithdrawnFeedback, GitHubInstallationTokensError> {
    const token = yield* this.#repositoryToken(repository, WRITE_ISSUES);
    const issue = yield* this.#send(
      `/repos/${repository}/issues/${number}`,
      token,
      { method: "GET" },
      feedbackIssueSchema,
      [404, 410],
    );
    if (!issue) return "gone";
    const inRepository = (name: string) => issue.repository_url.toLowerCase().endsWith(`/repos/${name.toLowerCase()}`);
    if (!inRepository(repository)) {
      if (privateRepository && inRepository(privateRepository)) return "gone";
      return yield* new GitHubInstallationTokensError(
        409,
        "feedback_moved",
        "The issue moved to another public repository.",
      );
    }
    if (issue.pull_request !== undefined) return yield* notSentBy();
    if (issue.user?.login === `${FEEDBACK_APP}[bot]` && (yield* sentBy(issue.body ?? ""))) {
      if (!privateRepository)
        return yield* new GitHubInstallationTokensError(
          503,
          "feedback_withdraw_unavailable",
          "A sent issue cannot be removed now.",
        );
      const both = yield* this.#repositoryToken(repository, WRITE_ISSUES, [privateRepository]);
      const target = yield* this.#get(`/repos/${privateRepository}`, both, repositoryNodeSchema);
      const moved = yield* this.#post(
        "/graphql",
        both,
        {
          query:
            "mutation($issue: ID!, $repository: ID!) { transferIssue(input: { issueId: $issue, repositoryId: $repository }) { issue { number } } }",
          variables: { issue: issue.node_id, repository: target.node_id },
        },
        graphqlSchema,
      );
      if (moved.errors?.length)
        return yield* new GitHubInstallationTokensError(502, "github_failed", "GitHub did not move the issue.");
      return "issue";
    }
    const own: number[] = [];
    for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
      const comments = yield* this.#get(
        `/repos/${repository}/issues/${number}/comments?per_page=${PAGE_SIZE}&page=${page}`,
        token,
        feedbackCommentsSchema,
      );
      for (const comment of comments)
        if (comment.user?.login === `${FEEDBACK_APP}[bot]` && (yield* sentBy(comment.body ?? ""))) own.push(comment.id);
      if (comments.length < PAGE_SIZE) break;
    }
    if (own.length === 0) return yield* notSentBy();
    for (const id of own)
      yield* this.#send(
        `/repos/${repository}/issues/comments/${id}`,
        token,
        { method: "DELETE" },
        Schema.Unknown,
        [204, 404],
      );
    return "comment";
  }).bind(this);

  readonly searchIssues = Effect.fn("GitHubInstallationTokens.searchIssues")(function* (
    this: GitHubInstallationTokens,
    repository: string,
    terms: readonly string[],
  ): Effect.fn.Return<GitHubSimilarIssue[], GitHubInstallationTokensError> {
    if (terms.length === 0) return [];
    const token = yield* this.#repositoryToken(repository, READ_ISSUES);
    const query = new URLSearchParams({
      q: `repo:${repository} is:issue is:open author:app/${FEEDBACK_APP} in:title ${terms.join(" OR ")}`,
      per_page: String(SIMILAR_ISSUES),
    });
    const found = yield* this.#get(`/search/issues?${query.toString()}`, token, searchSchema);
    return found.items
      .filter((item) => item.pull_request === undefined)
      .map((item) => ({
        number: item.number,
        title: item.title,
        url: item.html_url,
        summary: issueSummary(item.body),
      }));
  }).bind(this);

  readonly #repositoryToken = Effect.fn("GitHubInstallationTokens.repositoryToken")(function* (
    this: GitHubInstallationTokens,
    repository: string,
    permissions: Readonly<Record<string, string>>,
    others: readonly string[] = [],
  ): Effect.fn.Return<Credential, GitHubInstallationTokensError> {
    const names = [repository, ...others].map((fullName) => fullName.split("/")[1]);
    let installationId = this.#repositoryInstallations.get(repository);
    if (installationId === undefined) {
      installationId = (yield* this.#get(`/repos/${repository}/installation`, APP, repositoryInstallationSchema)).id;
      this.#repositoryInstallations.set(repository, installationId);
    }
    const minted = yield* this.#post(
      `/app/installations/${installationId}/access_tokens`,
      APP,
      { repositories: names, permissions },
      accessTokenSchema,
    ).pipe(Effect.tapError(() => Effect.sync(() => this.#repositoryInstallations.delete(repository))));
    return { kind: "installation", token: minted.token };
  });

  readonly #issueForInstallation = Effect.fn("GitHubInstallationTokens.issueForInstallation")(function* (
    this: GitHubInstallationTokens,
    installationId: number,
    account: string,
    permissions: Readonly<Record<string, string>>,
    user: Credential,
  ): Effect.fn.Return<GitHubInstallationToken[], GitHubInstallationTokensError> {
    const writable = yield* this.#writableRepositories(installationId, user);
    const tokens: GitHubInstallationToken[] = [];
    for (let start = 0; start < writable.length; start += MAX_REPOSITORIES_PER_TOKEN) {
      const part = writable.slice(start, start + MAX_REPOSITORIES_PER_TOKEN);
      const minted = yield* this.#post(
        `/app/installations/${installationId}/access_tokens`,
        APP,
        { repository_ids: part.map((repository) => repository.id), permissions },
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
    yield* this.#eachRepository(installationId, user, (repository) => {
      const permissions = repository.permissions;
      if (permissions?.push || permissions?.maintain || permissions?.admin) {
        writable.push({ id: repository.id, fullName: repository.full_name });
      }
      return true;
    });
    return writable;
  });

  readonly #publicInstallationRepositories = Effect.fn("GitHubInstallationTokens.publicInstallationRepositories")(
    function* (
      this: GitHubInstallationTokens,
      installationId: number,
    ): Effect.fn.Return<{ id: number; full_name: string }[], GitHubInstallationTokensError> {
      const credential = yield* this.#listingToken(installationId);
      const repositories: { id: number; full_name: string }[] = [];
      for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
        const answer = yield* this.#get(
          `/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`,
          credential,
          installationRepositoriesSchema,
        ).pipe(Effect.tapError(() => Effect.sync(() => this.#listingTokens.delete(installationId))));
        for (const repository of answer.repositories)
          if (!repository.private) repositories.push({ id: repository.id, full_name: repository.full_name });
        if (answer.repositories.length < PAGE_SIZE || page * PAGE_SIZE >= answer.total_count) break;
      }
      return repositories;
    },
  );

  readonly #listingToken = Effect.fn("GitHubInstallationTokens.listingToken")(function* (
    this: GitHubInstallationTokens,
    installationId: number,
  ): Effect.fn.Return<Credential, GitHubInstallationTokensError> {
    const cached = this.#listingTokens.get(installationId);
    if (cached && cached.expiresAt - this.#now() > LISTING_TOKEN_MARGIN_MS)
      return { kind: "installation", token: cached.token };
    const minted = yield* this.#post(
      `/app/installations/${installationId}/access_tokens`,
      APP,
      { permissions: LISTING_PERMISSIONS },
      accessTokenSchema,
    );
    this.#listingTokens.set(installationId, { token: minted.token, expiresAt: Date.parse(minted.expires_at) });
    return { kind: "installation", token: minted.token };
  });

  readonly #eachRepository = Effect.fn("GitHubInstallationTokens.eachRepository")(function* (
    this: GitHubInstallationTokens,
    installationId: number,
    user: Credential,
    visit: (repository: (typeof repositoriesSchema.Type)["repositories"][number]) => boolean,
  ): Effect.fn.Return<void, GitHubInstallationTokensError> {
    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const answer = yield* this.#get(
        `/user/installations/${installationId}/repositories?per_page=${PAGE_SIZE}&page=${page}`,
        user,
        repositoriesSchema,
      );
      for (const repository of answer.repositories) if (!visit(repository)) return;
      if (answer.repositories.length < PAGE_SIZE || page * PAGE_SIZE >= answer.total_count) return;
    }
  });

  readonly #readAppId = Effect.fn("GitHubInstallationTokens.readAppId")(function* (
    this: GitHubInstallationTokens,
  ): Effect.fn.Return<number, GitHubInstallationTokensError> {
    this.#appId ??= (yield* this.#get("/app", APP, appSchema)).id;
    return this.#appId;
  });

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

  #request<T>(
    path: string,
    credential: Credential,
    init: RequestInit,
    schema: Schema.Decoder<T>,
  ): Effect.Effect<T, GitHubInstallationTokensError> {
    return this.#send(path, credential, init, schema, []).pipe(
      Effect.flatMap((value) =>
        value === null
          ? Effect.fail(new GitHubInstallationTokensError(502, "github_failed", "GitHub sent an unexpected answer."))
          : Effect.succeed(value),
      ),
    );
  }

  readonly #send = Effect.fn("GitHubInstallationTokens.send")(function* <T>(
    this: GitHubInstallationTokens,
    path: string,
    credential: Credential,
    init: RequestInit,
    schema: Schema.Decoder<T>,
    nullStatuses: readonly number[],
  ): Effect.fn.Return<T | null, GitHubInstallationTokensError> {
    const route = path.split("?")[0];
    const authorization = credential.kind === "app" ? `Bearer ${yield* this.#appJwt()}` : `token ${credential.token}`;
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
    if (nullStatuses.includes(response.status)) {
      yield* Effect.tryPromise(() => response.body?.cancel() ?? Promise.resolve()).pipe(Effect.ignore);
      return null;
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
