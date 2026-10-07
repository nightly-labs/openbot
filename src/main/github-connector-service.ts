// The built-in GitHub connection of this computer: one sign-in to the GitHub App, shared by every
// agent as the GitHub MCP server and as the credential that `gh` and `git` read.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  GITHUB_CONNECTOR_MCP_SERVER_ID,
  GITHUB_CONNECTOR_MCP_SERVER_NAME,
  GITHUB_CONNECTOR_MCP_SERVER_URL,
  type GitHubConnectorRepositories,
  type GitHubConnectorRepository,
  type GitHubConnectorState,
  type GitHubConnectorStatus,
  type McpServerConfig,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, registerSecretValue, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, type Layer, Result, Scope, Semaphore } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { GitHubBotTokens } from "./github-bot-tokens";
import type { GitHubAppConfig } from "./github-connector-config";
import type { GitHubConnectorRecord, GitHubConnectorStore } from "./github-connector-store";
import {
  GITHUB_REQUEST_TIMEOUT_MS,
  type GitHubDeviceCode,
  GitHubDeviceFlowError,
  type GitHubFetch,
  type GitHubTokenSet,
  pollGitHubDeviceToken,
  refreshGitHubToken,
  requestGitHubDeviceCode,
} from "./github-device-flow";
import { GitHubOperationError, GitHubPlatform, githubCall, toGitHubOperationError } from "./github-effects";
import { GitHubMcpProxy } from "./github-mcp-proxy";

const logger = createOpenBotLogger("github-connector");

/** A token with less time left than this is refreshed before it is handed out. */
const REFRESH_MARGIN_MS = 10 * 60_000;
/**
 * How often the token's time left is read against the wall clock. A timer set for the expiry would
 * fire late after the computer sleeps, and a refresh that failed on the network is tried again at
 * the next check.
 */
const REFRESH_CHECK_MS = 60_000;
const GIT_CREDENTIAL_KEY = "credential.https://github.com.helper";
/** Git then sends the repository path to the helper, which picks the bot token of that repository. */
const GIT_USE_HTTP_PATH_KEY = "credential.https://github.com.useHttpPath";
/** The fields of `GET /user` that the status shows. */
const githubUserSchema = z.object({
  login: z.string().min(1),
  id: z.number(),
  avatar_url: z.string().nullish(),
});
/** GitHub's largest page. */
const GITHUB_PAGE_SIZE = 100;
/** The list stops here. The status still counts every repository. */
const MAX_LISTED_REPOSITORIES = 500;
const githubInstallationsSchema = z.object({
  installations: z.array(z.object({ id: z.number() })),
});
const githubRepositoriesSchema = z.object({
  total_count: z.number(),
  repositories: z.array(z.object({ full_name: z.string().min(1), private: z.boolean() })),
});

export interface GitHubConnectorServiceOptions {
  /** Null when this build has no GitHub App. The connection is then not offered. */
  app: GitHubAppConfig | null;
  store: GitHubConnectorStore;
  /**
   * A folder that OpenBot owns, outside every root an agent can write. It holds the `gh` hosts file
   * and the token file that the git credential helper reads, while the connection is active.
   */
  toolDirectory: string;
  /** The OpenBot API, which gives the installation tokens that make GitHub show the app as the author. */
  apiUrl: string;
  openExternal: (url: string) => Promise<void>;
  fetch?: GitHubFetch;
  now?: () => number;
}

interface PendingSignIn {
  controller: AbortController;
  /** Null while GitHub has not answered the device code request. */
  device: GitHubDeviceCode | null;
}

/**
 * Owns the GitHub sign-in of this computer: the device flow, the stored token set, its refresh, and
 * the files that `gh` and `git` read. It never imports the agent service. The agent service reads
 * `mcpServer`, `accessToken` and `agentEnvironment`, and `onAgentAccessChanged` tells it when that
 * answer changes.
 *
 * The user token never leaves the main process except to GitHub, to the OpenBot API as the proof
 * for the installation tokens, and into the files below for `gh` and `git`. Agents reach GitHub's
 * MCP server through `GitHubMcpProxy`, which adds the token for each call. Each token is registered
 * for redaction before it is used.
 *
 * `gh` has one token for each host, so it keeps the user token: GitHub shows its work as "user with
 * OpenBotGit". `git` and the MCP tools use the bot token of each repository where the user can push.
 */
export class GitHubConnectorService {
  readonly #app: GitHubAppConfig | null;
  readonly #store: GitHubConnectorStore;
  readonly #toolDirectory: string;
  readonly #platform: Layer.Layer<GitHubPlatform>;
  readonly #scope = Scope.makeUnsafe();
  readonly #operations = new Set<Deferred.Deferred<void>>();
  readonly #fetch: GitHubFetch;
  readonly #now: () => number;
  readonly #statusListeners = new Set<(status: GitHubConnectorStatus) => void>();
  readonly #accessListeners = new Set<() => void>();
  #pending: PendingSignIn | null = null;
  /** The stored sign-in can no longer refresh. The record stays, so the panel can name the account. */
  #expired = false;
  #error: string | null = null;
  #refreshing: Deferred.Deferred<GitHubConnectorRecord | null, GitHubOperationError> | null = null;
  #refreshCheck: ReturnType<typeof setInterval> | null = null;
  /** Network failures of the refresh in a row. Only the first is logged. */
  #refreshFailures = 0;
  /**
   * Changes each time the stored sign-in is replaced or removed. A refresh that started before the
   * change does not write its answer back.
   */
  #generation = 0;
  #disposed = false;
  #disposal: Deferred.Deferred<void, GitHubOperationError> | null = null;
  /** Store writes and the `gh` and `git` files change in this order, one change at a time. */
  #queue = Semaphore.makeUnsafe(1);
  /** What agents were last told, so a change that does not alter it replaces no session. */
  #agentAccess = false;
  readonly #botTokens: GitHubBotTokens;
  #renewingBotTokens: Deferred.Deferred<void, GitHubOperationError> | null = null;
  /** The content of the repositories file, or null when it is not there. */
  #repositoriesWritten: string | null = null;
  /** Null when the loopback server could not start: agents then reach GitHub's server with the user token. */
  #mcpProxy: GitHubMcpProxy | null = null;
  /** Generated at the first start, then kept in the record. */
  #mcpProxySecret = randomBytes(32).toString("base64url");

  constructor(options: GitHubConnectorServiceOptions) {
    this.#app = options.app;
    this.#store = options.store;
    this.#toolDirectory = options.toolDirectory;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#platform = GitHubPlatform.layer(this.#fetch, options.openExternal);
    this.#now = options.now ?? Date.now;
    this.#botTokens = new GitHubBotTokens({ apiUrl: options.apiUrl, fetch: this.#fetch, now: this.#now });
    registerSecretValue(this.#mcpProxySecret);
  }

  #owned<A>(operation: Effect.Effect<A, GitHubOperationError, GitHubPlatform>): Effect.Effect<A, GitHubOperationError> {
    return Effect.suspend(() => {
      const done = Deferred.makeUnsafe<void>();
      this.#operations.add(done);
      return operation.pipe(
        Effect.provide(this.#platform),
        Effect.ensuring(
          Effect.gen({ self: this }, function* () {
            this.#operations.delete(done);
            yield* Deferred.succeed(done, undefined);
          }),
        ),
      );
    });
  }

  /**
   * Reads the stored sign-in and prepares the `gh` and `git` files. Call once, before an agent starts.
   * A file that cannot be read is logged and treated as no sign-in: a new sign-in replaces it.
   */

  readonly load = Effect.fn("GitHubConnector.load")(
    function* (this: GitHubConnectorService): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
      const error = yield* this.#store.load();
      if (error) logger.warn("The GitHub connection file could not be read.", { cause: toLogValue(error) });
      const record = this.#store.read();
      if (this.#app) yield* this.#startMcpProxyEffect(record);
      yield* this.#serialize(() =>
        Effect.gen({ self: this }, function* () {
          if (!record || !this.#app) {
            yield* this.#removeToolFiles();
            return;
          }
          registerTokenSecrets(record);
          if (!this.#canRefresh(record) && this.#accessTokenExpired(record)) {
            this.#expired = true;
            yield* this.#removeToolFiles();
          } else {
            // A file that cannot be written must not stop the app. The next refresh writes it again.
            yield* this.#writeToolFilesEffect(record).pipe(
              Effect.catch(({ cause: error }) =>
                Effect.sync(() => {
                  logger.warn("The GitHub token files could not be written.", { cause: toLogValue(error) });
                }),
              ),
            );
          }
        }),
      );
      this.#agentAccess = this.#agentConnected();
      if (!this.#app || this.#disposed) return;
      this.#refreshCheck = setInterval(() => {
        void Effect.runPromise(this.#owned(this.#checkRefresh()).pipe(Effect.catch(() => Effect.void)));
      }, REFRESH_CHECK_MS);
      this.#refreshCheck.unref?.();
      yield* this.#checkRefresh();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  status(): GitHubConnectorStatus {
    const record = this.#store.read();
    const device = this.#pending?.device ?? null;
    return {
      available: this.#app !== null,
      state: this.#state(),
      login: record?.login ?? null,
      avatarUrl: record?.avatarUrl ?? null,
      userCode: device?.userCode ?? null,
      verificationUri: device?.verificationUri ?? null,
      error: this.#error,
    };
  }

  onChanged(listener: (status: GitHubConnectorStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  /** Told when agents gain or lose GitHub. A token refresh alone is not a change. */
  onAgentAccessChanged(listener: () => void): () => void {
    this.#accessListeners.add(listener);
    return () => this.#accessListeners.delete(listener);
  }

  /**
   * Starts the device flow and opens GitHub's code page. Returns at once with the user code; the
   * wait for the user runs in the background and reports through `onChanged`.
   */

  readonly connect = Effect.fn("GitHubConnector.connect")(
    function* (
      this: GitHubConnectorService,
    ): Effect.fn.Return<GitHubConnectorStatus, GitHubOperationError, GitHubPlatform> {
      const app = this.#app;
      if (!app)
        return yield* new GitHubOperationError({ cause: new Error(sourceText("error.connector.githubUnavailable")) });
      this.#pending?.controller.abort();
      const pending: PendingSignIn = { controller: new AbortController(), device: null };
      this.#pending = pending;
      this.#error = null;
      this.#emitStatus();
      const attempt0 = yield* Effect.gen({ self: this }, function* () {
        return yield* requestGitHubDeviceCode({
          clientId: app.clientId,
          fetch: this.#fetch,
          now: this.#now,
          signal: pending.controller.signal,
        });
      }).pipe(Effect.result);
      if (Result.isFailure(attempt0)) {
        const error = attempt0.failure.cause;
        if (this.#pending === pending && !pending.controller.signal.aborted) this.#fail(pending, error);
        return this.status();
      }
      pending.device = attempt0.success;
      if (this.#pending !== pending) return this.status();
      this.#emitStatus();
      yield* Effect.forkIn(this.openVerification(), this.#scope);
      yield* Effect.forkIn(this.#owned(this.#finishSignIn(app, pending, pending.device)), this.#scope);
      return this.status();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  cancel(): GitHubConnectorStatus {
    this.#pending?.controller.abort();
    this.#pending = null;
    this.#error = null;
    this.#emitStatus();
    return this.status();
  }

  /**
   * Forgets the sign-in. GitHub revokes a token only with the client secret, which OpenBot does not
   * hold, so the GitHub page where the user can revoke it opens as well.
   */

  readonly disconnect = Effect.fn("GitHubConnector.disconnect")(
    function* (
      this: GitHubConnectorService,
    ): Effect.fn.Return<GitHubConnectorStatus, GitHubOperationError, GitHubPlatform> {
      this.#pending?.controller.abort();
      this.#pending = null;
      this.#generation += 1;
      const hadRecord = this.#store.read() !== null;
      yield* this.#serialize(() =>
        Effect.gen({ self: this }, function* () {
          yield* this.#store.clear();
          this.#botTokens.clear();
          if (this.#mcpProxy) yield* this.#mcpProxy.retain(new Set());
          yield* this.#removeToolFiles();
        }),
      );
      this.#expired = false;
      this.#error = null;
      this.#emitStatus();
      this.#syncAgentAccess();
      if (hadRecord && this.#app) {
        yield* Effect.forkIn(
          this.#owned(
            this.#open(
              `https://github.com/settings/connections/applications/${encodeURIComponent(this.#app.clientId)}`,
            ),
          ),
          this.#scope,
        );
      }
      return this.status();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly openVerification = Effect.fn("GitHubConnector.openVerification")(
    function* (this: GitHubConnectorService): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
      const uri = this.#pending?.device?.verificationUri;
      if (uri) yield* this.#open(uri);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /**
   * The repositories that agents reach: those of each installation of the app that the user can use.
   * Empty while the connection is not active.
   */

  readonly repositories = Effect.fn("GitHubConnector.repositories")(
    function* (
      this: GitHubConnectorService,
    ): Effect.fn.Return<GitHubConnectorRepositories, GitHubOperationError, GitHubPlatform> {
      const token = yield* this.accessToken();
      if (!token) return { repositories: [], total: 0 };
      // The panel reads the list again after an install, which can add repositories.
      this.#botTokens.invalidate();
      yield* this.#checkRefresh();
      const { installations } = yield* this.#getGitHubEffect(
        `https://api.github.com/user/installations?per_page=${GITHUB_PAGE_SIZE}`,
        token,
        githubInstallationsSchema,
      );
      const repositories: GitHubConnectorRepository[] = [];
      let total = 0;
      for (const installation of installations) {
        for (let page = 1; ; page += 1) {
          const answer = yield* this.#getGitHubEffect(
            `https://api.github.com/user/installations/${installation.id}/repositories?per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
            token,
            githubRepositoriesSchema,
          );
          if (page === 1) total += answer.total_count;
          for (const repository of answer.repositories) {
            repositories.push({ fullName: repository.full_name, private: repository.private });
          }
          const listedAll = page * GITHUB_PAGE_SIZE >= answer.total_count || answer.repositories.length === 0;
          if (listedAll || repositories.length >= MAX_LISTED_REPOSITORIES) break;
        }
        if (repositories.length >= MAX_LISTED_REPOSITORIES) break;
      }
      repositories.sort((left, right) => left.fullName.localeCompare(right.fullName, "en", { sensitivity: "base" }));
      return {
        repositories: repositories.slice(0, MAX_LISTED_REPOSITORIES),
        total: Math.max(total, repositories.length),
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /** GitHub's page where the user picks the repositories the app may reach. */

  readonly openInstall = Effect.fn("GitHubConnector.openInstall")(
    function* (this: GitHubConnectorService): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
      if (this.#app) yield* this.#open(`https://github.com/apps/${this.#app.slug}/installations/new`);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /**
   * The user token, refreshed first when it has less than ten minutes left. Null while the
   * connection is not active.
   */

  readonly accessToken = Effect.fn("GitHubConnector.accessToken")(
    function* (this: GitHubConnectorService): Effect.fn.Return<string | null, GitHubOperationError, GitHubPlatform> {
      const record = this.#store.read();
      if (!record || !this.#agentConnected()) return null;
      if (!this.#needsRefresh(record)) return record.accessToken;
      // A sign-in that replaced this one during the refresh gives its own token.
      const current = (yield* this.#refresh()) ?? this.#store.read();
      return current && this.#agentConnected() && !this.#accessTokenExpired(current) ? current.accessToken : null;
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /**
   * The bearer that agents send to the GitHub MCP server: the loopback server's own secret, or the
   * user token when that server did not start.
   */

  readonly mcpAuthorization = Effect.fn("GitHubConnector.mcpAuthorization")(
    function* (this: GitHubConnectorService): Effect.fn.Return<string | null, GitHubOperationError, GitHubPlatform> {
      if (!this.#agentConnected()) return null;
      return this.#mcpProxy ? this.#mcpProxySecret : yield* this.accessToken();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  /** The GitHub MCP server that agents are given, or null while the connection is not active. */
  mcpServer(): McpServerConfig | null {
    if (!this.#agentConnected()) return null;
    return {
      id: GITHUB_CONNECTOR_MCP_SERVER_ID,
      name: GITHUB_CONNECTOR_MCP_SERVER_NAME,
      transport: "http",
      enabled: true,
      command: "",
      args: [],
      env: [],
      envPassthrough: [],
      workingDirectory: "",
      url: this.#mcpProxy?.url() ?? GITHUB_CONNECTOR_MCP_SERVER_URL,
      headers: [],
    };
  }

  /**
   * The environment that makes `gh` and `git` use this connection. It holds paths only, never the
   * token: a provider process runs for many hours, and a new sign-in or a refresh changes the token,
   * so the token lives in files that each change rewrites.
   *
   * The empty helper value clears the helpers from the user's own git configuration for github.com.
   * Without it, a system helper such as the macOS keychain would store the short-lived token after
   * the first push, and give it back after it expired. The entries go after the `GIT_CONFIG_*`
   * entries in `inherited`, the environment the process starts with, so those entries still apply.
   *
   * The helper reads the repository path that `useHttpPath` makes git send, and gives the bot token
   * from the repositories file when that file names the repository. Otherwise it gives the user token.
   */
  agentEnvironment(inherited: NodeJS.ProcessEnv = process.env): Record<string, string> {
    if (!this.#agentConnected()) return {};
    const tokenFile = shellQuote(this.#credentialFile().replaceAll("\\", "/"));
    const repositoriesFile = shellQuote(this.#repositoriesFile().replaceAll("\\", "/"));
    const first = gitConfigCount(inherited.GIT_CONFIG_COUNT);
    const helper = [
      '!f() { test "$1" = get || exit 0; p=',
      "while IFS='=' read -r k v; do test \"$k\" = path && p=$v; done",
      // Git sends `owner/name.git`, and the file holds `owner/name`.
      `t=; test -n "$p" && t=$(awk -F '\\t' -v r="$p" 'BEGIN { sub(/\\/+$/, "", r); sub(/\\.git$/, "", r) } tolower($1) == tolower(r) { print $2; exit }' ${repositoriesFile} 2>/dev/null)`,
      "echo username=x-access-token; printf 'password='",
      `if test -n "$t"; then printf '%s' "$t"; else cat ${tokenFile}; fi; echo; }; f`,
    ].join("; ");
    return {
      GH_CONFIG_DIR: this.#ghConfigDirectory(),
      GIT_CONFIG_COUNT: String(first + 3),
      [`GIT_CONFIG_KEY_${first}`]: GIT_CREDENTIAL_KEY,
      [`GIT_CONFIG_VALUE_${first}`]: "",
      [`GIT_CONFIG_KEY_${first + 1}`]: GIT_CREDENTIAL_KEY,
      [`GIT_CONFIG_VALUE_${first + 1}`]: helper,
      [`GIT_CONFIG_KEY_${first + 2}`]: GIT_USE_HTTP_PATH_KEY,
      [`GIT_CONFIG_VALUE_${first + 2}`]: "true",
    };
  }

  /**
   * Stops the refresh check and the sign-in, and removes the token files after the change in
   * progress. The encrypted sign-in stays.
   */
  readonly dispose = Effect.fn("GitHubConnector.disposeOwned")(function* (this: GitHubConnectorService) {
    if (this.#disposal) return yield* Deferred.await(this.#disposal);
    const done = Deferred.makeUnsafe<void, GitHubOperationError>();
    this.#disposal = done;
    return yield* this.#disposeWork().pipe(
      Effect.provide(this.#platform),
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          yield* Scope.close(this.#scope, Exit.void);
          while (this.#operations.size)
            yield* Effect.forEach([...this.#operations], Deferred.await, { concurrency: "unbounded" });
        }),
      ),
      Effect.onExit((exit) => Deferred.done(done, exit)),
    );
  }).bind(this);
  readonly #disposeWork = Effect.fn("GitHubConnector.dispose")(function* (
    this: GitHubConnectorService,
  ): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
    this.#disposed = true;
    this.#generation += 1;
    this.#pending?.controller.abort();
    this.#pending = null;
    if (this.#refreshCheck) clearInterval(this.#refreshCheck);
    this.#refreshCheck = null;
    this.#statusListeners.clear();
    this.#accessListeners.clear();
    this.#botTokens.clear();
    const proxy = this.#mcpProxy;
    if (proxy) yield* proxy.stop();
    yield* this.#serialize(() => this.#removeToolFiles());
  });

  /**
   * Whether agents get GitHub. A sign-in that runs while a stored one is still valid does not take
   * GitHub away: agents keep the old account until the new one replaces it.
   */
  #agentConnected(): boolean {
    return this.#app !== null && this.#store.read() !== null && !this.#expired;
  }

  #state(): GitHubConnectorState {
    if (!this.#app) return "disconnected";
    if (this.#pending) return "pending";
    if (!this.#store.read()) return "disconnected";
    return this.#expired ? "expired" : "connected";
  }

  readonly #finishSignIn = Effect.fn("GitHubConnector.finishSignIn")(function* (
    this: GitHubConnectorService,
    app: GitHubAppConfig,
    pending: PendingSignIn,
    device: GitHubDeviceCode,
  ): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
    return yield* Effect.gen({ self: this }, function* () {
      const tokens = yield* pollGitHubDeviceToken({
        clientId: app.clientId,
        device,
        fetch: this.#fetch,
        now: this.#now,
        signal: pending.controller.signal,
      });
      registerTokenSecrets(tokens);
      const user = yield* this.#readUserEffect(tokens.accessToken, pending.controller.signal);
      const record: GitHubConnectorRecord = { ...tokens, ...user, mcpProxy: this.#mcpProxySettings() };
      // Checked in the queue: a cancel or disconnect that ran while the last change was written wins.
      const committed = yield* this.#serialize(() =>
        Effect.gen({ self: this }, function* () {
          if (this.#pending !== pending || this.#disposed) return false;
          yield* this.#store.write(record);
          this.#generation += 1;
          this.#pending = null;
          this.#expired = false;
          this.#error = null;
          this.#botTokens.clear();
          // The sign-in is stored: the MCP server works without the files, so a write failure does not undo it.
          yield* this.#writeToolFilesEffect(record).pipe(
            Effect.catch(({ cause: error }) =>
              Effect.sync(() => {
                logger.warn("The GitHub token files could not be written.", { cause: toLogValue(error) });
              }),
            ),
          );
          return true;
        }),
      );
      if (!committed) return;
      this.#emitStatus();
      this.#syncAgentAccess();
      yield* this.#checkRefresh();
    }).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.sync(() => {
          if (pending.controller.signal.aborted || this.#pending !== pending) return;
          this.#fail(pending, error);
        }),
      ),
    );
  });

  #fail(pending: PendingSignIn, error: unknown): void {
    pending.controller.abort();
    this.#pending = null;
    this.#error = redactText(error instanceof Error ? error.message : String(error));
    if (!(error instanceof GitHubDeviceFlowError)) {
      logger.warn("The GitHub sign-in failed.", { cause: toLogValue(error) });
    }
    this.#emitStatus();
  }

  readonly #readUserEffect = Effect.fn("GitHubConnector.readUser")(function* (
    this: GitHubConnectorService,
    accessToken: string,
    signal: AbortSignal,
  ): Effect.fn.Return<
    Pick<GitHubConnectorRecord, "login" | "userId" | "avatarUrl">,
    GitHubOperationError,
    GitHubPlatform
  > {
    const user = yield* this.#getGitHubEffect("https://api.github.com/user", accessToken, githubUserSchema, signal);
    return { login: user.login, userId: user.id, avatarUrl: user.avatar_url ?? null };
  });

  /** One GitHub API read. A failure is a `GitHubDeviceFlowError` whose message the panel can show. */

  readonly #getGitHubEffect = Effect.fn("GitHubConnector.getGitHub")(function* <T>(
    this: GitHubConnectorService,
    url: string,
    accessToken: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Effect.fn.Return<T, GitHubOperationError, GitHubPlatform> {
    const timeout = AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS);
    const attempt2 = yield* Effect.gen({ self: this }, function* () {
      return yield* GitHubPlatform.use((platform) =>
        platform.fetch(url, {
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "OpenBot",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }),
      );
    }).pipe(Effect.result);
    if (Result.isFailure(attempt2)) {
      const cause = attempt2.failure.cause;
      if (signal?.aborted) return yield* new GitHubOperationError({ cause: signal.reason });
      return yield* new GitHubOperationError({
        cause: new GitHubDeviceFlowError(
          "unreachable",
          sourceText("error.connector.githubUnreachable", {
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
        ),
      });
    }
    const response = attempt2.success;
    const answer = schema.safeParse(yield* githubCall(() => response.json().catch(() => null)));
    if (!response.ok || !answer.success) {
      const path = new URL(url).pathname;
      return yield* new GitHubOperationError({
        cause: new GitHubDeviceFlowError(
          "unexpected",
          sourceText("error.connector.githubUnexpected", { detail: `${path} HTTP ${response.status}` }),
        ),
      });
    }
    return answer.data;
  });

  #needsRefresh(record: GitHubConnectorRecord): boolean {
    return record.accessTokenExpiresAt !== null && record.accessTokenExpiresAt - this.#now() < REFRESH_MARGIN_MS;
  }

  #accessTokenExpired(record: GitHubConnectorRecord): boolean {
    return record.accessTokenExpiresAt !== null && record.accessTokenExpiresAt <= this.#now();
  }

  #canRefresh(record: GitHubConnectorRecord): boolean {
    return (
      record.refreshToken !== null &&
      (record.refreshTokenExpiresAt === null || record.refreshTokenExpiresAt > this.#now())
    );
  }

  /**
   * Starts a refresh when the user token has less than ten minutes left, so `gh` and `git` keep a
   * valid one, and asks for new installation tokens when they are due.
   */
  readonly #checkRefresh = Effect.fn("GitHubConnector.checkRefresh")(function* (this: GitHubConnectorService) {
    const record = this.#store.read();
    if (this.#disposed || !record || !this.#agentConnected()) return;
    if (this.#needsRefresh(record)) yield* Effect.forkIn(this.#owned(this.#refresh()), this.#scope);
    if (this.#botTokens.due()) yield* Effect.forkIn(this.#owned(this.#renewBotTokens()), this.#scope);
  });

  /** One request at a time. A new set is written to the repositories file for the git helper. */
  readonly #renewBotTokens = Effect.fn("GitHubConnector.renewBotTokensAdmission")(function* (
    this: GitHubConnectorService,
  ) {
    if (this.#renewingBotTokens) return yield* Deferred.await(this.#renewingBotTokens);
    const done = Deferred.makeUnsafe<void, GitHubOperationError>();
    this.#renewingBotTokens = done;
    return yield* this.#runBotTokenRenewal().pipe(
      Effect.onExit((exit) => Deferred.done(done, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#renewingBotTokens === done) this.#renewingBotTokens = null;
        }),
      ),
    );
  });

  readonly #runBotTokenRenewal = Effect.fn("GitHubConnector.runBotTokenRenewal")(function* (
    this: GitHubConnectorService,
  ): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
    const generation = this.#generation;
    const userToken = yield* this.accessToken();
    if (!userToken) return;
    yield* this.#botTokens.renew(userToken);
    // Also after a failure: a token that expired while the API was not reachable leaves the file.
    const current = yield* this.#serialize(() =>
      Effect.gen({ self: this }, function* () {
        if (this.#disposed || this.#generation !== generation || !this.#agentConnected()) return false;
        yield* this.#writeRepositoriesFileEffect();
        return true;
      }),
    );
    if (!current) return;
    if (this.#mcpProxy)
      yield* this.#mcpProxy.retain(new Set([userToken, ...this.#botTokens.entries().map(([, token]) => token)]));
  });

  /** One refresh at a time: a hand-off and the check can ask together, and GitHub rotates the refresh token. */
  readonly #refresh = Effect.fn("GitHubConnector.refreshAdmission")(function* (this: GitHubConnectorService) {
    if (this.#refreshing) return yield* Deferred.await(this.#refreshing);
    const done = Deferred.makeUnsafe<GitHubConnectorRecord | null, GitHubOperationError>();
    this.#refreshing = done;
    return yield* this.#runRefresh().pipe(
      Effect.onExit((exit) => Deferred.done(done, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#refreshing === done) this.#refreshing = null;
        }),
      ),
    );
  });

  /**
   * Resolves with the record to use: the new one, the old one after a network failure, or null when
   * the sign-in expired or changed during the refresh. It does not reject.
   */

  readonly #runRefresh = Effect.fn("GitHubConnector.runRefresh")(function* (
    this: GitHubConnectorService,
  ): Effect.fn.Return<GitHubConnectorRecord | null, GitHubOperationError, GitHubPlatform> {
    const generation = this.#generation;
    const record = this.#store.read();
    const app = this.#app;
    if (!record || !app || this.#expired) return null;
    // A disconnect, a new sign-in or a shutdown that ran during the refresh wins.
    const current = () => !this.#disposed && this.#generation === generation && this.#store.read() === record;
    return yield* Effect.gen({ self: this }, function* () {
      if (!record.refreshToken || !this.#canRefresh(record)) {
        yield* this.#serialize(() =>
          Effect.gen({ self: this }, function* () {
            if (current()) yield* this.#expireEffect();
          }),
        );
        return null;
      }
      const refreshToken = record.refreshToken;
      const attempt4 = yield* Effect.gen({ self: this }, function* () {
        return yield* refreshGitHubToken({
          clientId: app.clientId,
          refreshToken,
          fetch: this.#fetch,
          now: this.#now,
        });
      }).pipe(Effect.result);
      if (Result.isFailure(attempt4)) {
        const error = attempt4.failure.cause;
        if (!(error instanceof GitHubDeviceFlowError && error.failure === "refresh_rejected"))
          return yield* new GitHubOperationError({ cause: error });
        yield* this.#serialize(() =>
          Effect.gen({ self: this }, function* () {
            if (!current()) return;
            // Saved without the refresh token, so the next start shows the sign-in as expired too.
            const now = this.#now();
            yield* this.#store.write({
              ...record,
              accessTokenExpiresAt: Math.min(record.accessTokenExpiresAt ?? now, now),
              refreshToken: null,
              refreshTokenExpiresAt: null,
            });
            yield* this.#expireEffect();
          }),
        );
        return null;
      }
      const tokens = attempt4.success;
      registerTokenSecrets(tokens);
      const next: GitHubConnectorRecord = {
        ...record,
        ...tokens,
        refreshToken: tokens.refreshToken ?? record.refreshToken,
        refreshTokenExpiresAt: tokens.refreshToken ? tokens.refreshTokenExpiresAt : record.refreshTokenExpiresAt,
      };
      const committed = yield* this.#serialize(() =>
        Effect.gen({ self: this }, function* () {
          if (!current()) return false;
          yield* this.#store.write(next);
          yield* this.#writeToolFilesEffect(next);
          return true;
        }),
      );
      this.#refreshFailures = 0;
      return committed ? next : null;
    }).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.sync(() => {
          this.#refreshFailures += 1;
          if (this.#refreshFailures === 1) {
            logger.warn("The GitHub token could not be refreshed. OpenBot tries again each minute.", {
              cause: toLogValue(error),
            });
          }
          return record;
        }),
      ),
    );
  });

  /** Runs in the queue. */

  readonly #expireEffect = Effect.fn("GitHubConnector.expire")(function* (
    this: GitHubConnectorService,
  ): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
    this.#expired = true;
    this.#error = sourceText("error.connector.githubExpired");
    this.#botTokens.clear();
    if (this.#mcpProxy) yield* this.#mcpProxy.retain(new Set());
    yield* this.#removeToolFiles();
    this.#emitStatus();
    this.#syncAgentAccess();
  });

  #serialize<T>(change: () => Effect.Effect<T, GitHubOperationError, GitHubPlatform>) {
    return this.#queue.withPermit(Effect.suspend(change)).pipe(Effect.uninterruptible);
  }

  #ghConfigDirectory(): string {
    return join(this.#toolDirectory, "gh");
  }

  #credentialFile(): string {
    return join(this.#toolDirectory, "token");
  }

  /** One line for each repository with a bot token: `owner/name`, a tab, the token. */
  #repositoriesFile(): string {
    return join(this.#toolDirectory, "repositories");
  }

  /** Writes only a change: a renewal runs each 15 minutes while the API is not reachable. */

  readonly #writeRepositoriesFileEffect = Effect.fn("GitHubConnector.writeRepositoriesFile")(function* (
    this: GitHubConnectorService,
  ): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
    const content = this.#botTokens
      .entries()
      .map(([repository, token]) => `${repository}\t${token}\n`)
      .join("");
    if (content === this.#repositoriesWritten) return;
    yield* writeFileAtomically(this.#repositoriesFile(), content).pipe(toGitHubOperationError);
    this.#repositoriesWritten = content;
  });

  /**
   * Starts the loopback GitHub MCP server on the port it had, so that a resumed session finds it. A
   * server that cannot start is logged: agents then reach GitHub's server with the user token.
   */

  readonly #startMcpProxyEffect = Effect.fn("GitHubConnector.startMcpProxy")(function* (
    this: GitHubConnectorService,
    record: GitHubConnectorRecord | null,
  ): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
    if (record?.mcpProxy) {
      this.#mcpProxySecret = record.mcpProxy.secret;
      registerSecretValue(this.#mcpProxySecret);
    }
    const proxy = new GitHubMcpProxy({
      upstreamUrl: GITHUB_CONNECTOR_MCP_SERVER_URL,
      secret: () => this.#mcpProxySecret,
      userToken: () => this.accessToken(),
      botToken: (owner, name) => this.#botTokens.forRepository(owner, name),
    });
    const attempt5 = yield* Effect.gen({ self: this }, function* () {
      return yield* proxy.start(record?.mcpProxy?.port ?? null);
    }).pipe(Effect.result);
    if (Result.isFailure(attempt5)) {
      const error = attempt5.failure.cause;
      logger.warn("The GitHub MCP server of this computer did not start.", { cause: toLogValue(error) });
      return;
    }
    const port = attempt5.success;
    this.#mcpProxy = proxy;
    if (!record || record.mcpProxy?.port === port) return;
    if (record.mcpProxy) {
      // Resumed sessions send the old secret to the old port, where another program now listens.
      this.#mcpProxySecret = randomBytes(32).toString("base64url");
      registerSecretValue(this.#mcpProxySecret);
    }
    yield* this.#store.write({ ...record, mcpProxy: this.#mcpProxySettings() }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("The GitHub MCP server port could not be saved.", { cause: toLogValue(error.cause) });
        }),
      ),
    );
  });

  #mcpProxySettings(): GitHubConnectorRecord["mcpProxy"] {
    const url = this.#mcpProxy?.url();
    const port = url ? Number(new URL(url).port) : null;
    return port ? { port, secret: this.#mcpProxySecret } : null;
  }

  /**
   * Both `hosts.yml` layouts: `users` for `gh` 2.40 and later, the flat keys for older releases. A
   * `GH_TOKEN` in the user's own environment still wins, as `gh` documents.
   */
  readonly #writeToolFilesEffect = Effect.fn("GitHubConnector.writeToolFiles")(function* (
    this: GitHubConnectorService,
    record: GitHubConnectorRecord,
  ): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
    yield* githubCall(() => mkdir(this.#ghConfigDirectory(), { recursive: true, mode: 0o700 }));
    // `mkdir` leaves a directory that is already there as it is. The files are 0600 either way.
    yield* githubCall(() => chmod(this.#toolDirectory, 0o700));
    yield* githubCall(() => chmod(this.#ghConfigDirectory(), 0o700));
    const hosts = [
      "github.com:",
      "    users:",
      `        ${record.login}:`,
      `            oauth_token: ${record.accessToken}`,
      "    git_protocol: https",
      `    oauth_token: ${record.accessToken}`,
      `    user: ${record.login}`,
      "",
    ].join("\n");
    yield* writeFileAtomically(join(this.#ghConfigDirectory(), "hosts.yml"), hosts).pipe(toGitHubOperationError);
    yield* writeFileAtomically(this.#credentialFile(), record.accessToken).pipe(toGitHubOperationError);
    yield* this.#writeRepositoriesFileEffect();
  });

  readonly #removeToolFiles = Effect.fn("GitHubConnector.removeToolFiles")(function* (
    this: GitHubConnectorService,
  ): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
    this.#repositoriesWritten = null;
    yield* githubCall(() =>
      rm(this.#toolDirectory, { recursive: true, force: true }).catch((error: unknown) => {
        logger.warn("The GitHub token files could not be removed.", { cause: toLogValue(error) });
      }),
    );
  });

  readonly #open = Effect.fn("GitHubConnector.open")(function* (
    this: GitHubConnectorService,
    url: string,
  ): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
    yield* GitHubPlatform.use((platform) => platform.openPage(url)).pipe(
      Effect.catch(({ cause: error }) =>
        Effect.sync(() => {
          logger.warn("The GitHub page could not be opened.", { cause: toLogValue(error) });
        }),
      ),
    );
  });

  #emitStatus(): void {
    const status = this.status();
    for (const listener of this.#statusListeners) listener(status);
  }

  #syncAgentAccess(): void {
    const access = this.#agentConnected();
    if (access === this.#agentAccess) return;
    this.#agentAccess = access;
    for (const listener of this.#accessListeners) listener();
  }
}

function registerTokenSecrets(tokens: Pick<GitHubTokenSet, "accessToken" | "refreshToken">): void {
  registerSecretValue(tokens.accessToken);
  if (tokens.refreshToken) registerSecretValue(tokens.refreshToken);
}

/** The count of `GIT_CONFIG_*` entries already set. Git refuses a count that is not a number. */
function gitConfigCount(value: string | undefined): number {
  return value && /^\d+$/u.test(value) ? Number(value) : 0;
}

/** One POSIX shell word. Git runs a `!` helper with `sh`, on Windows too. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
