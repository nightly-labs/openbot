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
  type WorkflowGitHubCatalog,
} from "@openbot/contracts/ipc";
import { GITHUB_ROUTE_EVENTS } from "@openbot/contracts/signal-protocol/github-route";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, registerSecretValue, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, type Layer, Result, Scope, Semaphore } from "effect";
import { z } from "zod";
import { writeFileAtomically } from "../backend/atomic-json-file";
import type { AgentGitConfigForm } from "../backend/provider-drivers";
import { GitHubBotTokens } from "./github-bot-tokens";
import type { GitHubAppConfig } from "./github-connector-config";
import type { GitHubConnectorRecord, GitHubConnectorStore } from "./github-connector-store";
import {
  GITHUB_REQUEST_TIMEOUT_MS,
  type GitHubDeviceCode,
  GitHubDeviceFlowError,
  type GitHubFetch,
  type GitHubTokenSet,
  githubUnreachable,
  pollGitHubDeviceToken,
  refreshGitHubToken,
  requestGitHubDeviceCode,
} from "./github-device-flow";
import { GitHubOperationError, GitHubPlatform, githubCall, toGitHubOperationError } from "./github-effects";
import { GitHubMcpProxy } from "./github-mcp-proxy";

const logger = createOpenBotLogger("github-connector");

const REFRESH_MARGIN_MS = 10 * 60_000;
const REFRESH_CHECK_MS = 60_000;
const GIT_CREDENTIAL_KEY = "credential.https://github.com.helper";
const GIT_USE_HTTP_PATH_KEY = "credential.https://github.com.useHttpPath";
const githubUserSchema = z.object({
  login: z.string().min(1),
  id: z.number(),
  avatar_url: z.string().nullish(),
});
const GITHUB_PAGE_SIZE = 100;
const MAX_LISTED_REPOSITORIES = 500;
const PUBLIC_REPOSITORIES_CACHE_MS = 60_000;
const githubInstallationsSchema = z.object({
  installations: z.array(z.object({ id: z.number(), events: z.array(z.string()).optional() })),
});

interface InstallationRepository extends GitHubConnectorRepository {
  events: boolean;
}
const githubRepositoriesSchema = z.object({
  total_count: z.number(),
  repositories: z.array(z.object({ full_name: z.string().min(1), private: z.boolean() })),
});
const publicRepositoriesSchema = z.object({
  repositories: z.array(z.object({ installationId: z.number(), fullName: z.string().min(1) })),
});

export interface GitHubConnectorServiceOptions {
  app: GitHubAppConfig | null;
  store: GitHubConnectorStore;
  toolDirectory: string;
  apiUrl: string;
  openExternal: (url: string) => Promise<void>;
  fetch?: GitHubFetch;
  now?: () => number;
}

interface PendingSignIn {
  controller: AbortController;
  device: GitHubDeviceCode | null;
}

export class GitHubConnectorService {
  readonly #app: GitHubAppConfig | null;
  readonly #store: GitHubConnectorStore;
  readonly #toolDirectory: string;
  readonly #platform: Layer.Layer<GitHubPlatform>;
  readonly #scope = Scope.makeUnsafe();
  readonly #operations = new Set<Deferred.Deferred<void>>();
  readonly #fetch: GitHubFetch;
  readonly #apiUrl: string;
  readonly #now: () => number;
  readonly #statusListeners = new Set<(status: GitHubConnectorStatus) => void>();
  readonly #accessListeners = new Set<() => void>();
  #pending: PendingSignIn | null = null;
  #expired = false;
  #error: string | null = null;
  #refreshing: Deferred.Deferred<GitHubConnectorRecord | null, GitHubOperationError> | null = null;
  #refreshCheck: ReturnType<typeof setInterval> | null = null;
  #refreshFailures = 0;
  #generation = 0;
  #disposed = false;
  #disposal: Deferred.Deferred<void, GitHubOperationError> | null = null;
  #queue = Semaphore.makeUnsafe(1);
  #agentAccess = false;
  readonly #botTokens: GitHubBotTokens;
  #renewingBotTokens: Deferred.Deferred<void, GitHubOperationError> | null = null;
  #repositoriesWritten: string | null = null;
  #mcpProxy: GitHubMcpProxy | null = null;
  #mcpProxySecret = randomBytes(32).toString("base64url");
  #publicRepositoriesCache: {
    token: string;
    at: number;
    repositories: z.infer<typeof publicRepositoriesSchema>["repositories"];
  } | null = null;

  constructor(options: GitHubConnectorServiceOptions) {
    this.#app = options.app;
    this.#store = options.store;
    this.#toolDirectory = options.toolDirectory;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#platform = GitHubPlatform.layer(this.#fetch, options.openExternal);
    this.#now = options.now ?? Date.now;
    this.#apiUrl = options.apiUrl;
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

  onAgentAccessChanged(listener: () => void): () => void {
    this.#accessListeners.add(listener);
    return () => this.#accessListeners.delete(listener);
  }

  readonly connect = Effect.fn("GitHubConnector.connect")(
    function* (
      this: GitHubConnectorService,
      opensPage: boolean,
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
      if (opensPage) yield* Effect.forkIn(this.openVerification(), this.#scope);
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

  readonly disconnect = Effect.fn("GitHubConnector.disconnect")(
    function* (
      this: GitHubConnectorService,
      opensPage: boolean,
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
      const { revokeUrl } = this.pages();
      if (hadRecord && revokeUrl && opensPage) yield* Effect.forkIn(this.#owned(this.#open(revokeUrl)), this.#scope);
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

  readonly repositories = Effect.fn("GitHubConnector.repositories")(
    function* (
      this: GitHubConnectorService,
    ): Effect.fn.Return<GitHubConnectorRepositories, GitHubOperationError, GitHubPlatform> {
      const token = yield* this.accessToken();
      if (!token) return { repositories: [], total: 0 };
      this.#botTokens.invalidate();
      yield* this.#checkRefresh();
      const { repositories, total } = yield* this.#installationRepositories(token);
      return {
        repositories: repositories.map((repository) => ({
          fullName: repository.fullName,
          private: repository.private,
        })),
        total,
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly workflowCatalog = Effect.fn("GitHubConnector.workflowCatalog")(
    function* (
      this: GitHubConnectorService,
    ): Effect.fn.Return<WorkflowGitHubCatalog, GitHubOperationError, GitHubPlatform> {
      const token = yield* this.accessToken();
      if (!token) return { connected: false, repositories: [] };
      if (this.#botTokens.due()) yield* this.#renewBotTokens().pipe(Effect.catch(() => Effect.void));
      const { repositories } = yield* this.#installationRepositories(token);
      return {
        connected: true,
        repositories: repositories.map((repository) => {
          const [owner = "", name = ""] = repository.fullName.split("/");
          return {
            fullName: repository.fullName,
            private: repository.private,
            canWrite: this.#botTokens.forRepository(owner, name) !== null,
            events: repository.events,
          };
        }),
      };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  pages(): { installUrl: string | null; revokeUrl: string | null } {
    const app = this.#app;
    if (!app) return { installUrl: null, revokeUrl: null };
    return {
      installUrl: `https://github.com/apps/${app.slug}/installations/new`,
      revokeUrl: `https://github.com/settings/connections/applications/${encodeURIComponent(app.clientId)}`,
    };
  }

  readonly openInstall = Effect.fn("GitHubConnector.openInstall")(
    function* (this: GitHubConnectorService): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
      const { installUrl } = this.pages();
      if (installUrl) yield* this.#open(installUrl);
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly accessToken = Effect.fn("GitHubConnector.accessToken")(
    function* (this: GitHubConnectorService): Effect.fn.Return<string | null, GitHubOperationError, GitHubPlatform> {
      const record = this.#store.read();
      if (!record || !this.#agentConnected()) return null;
      if (!this.#needsRefresh(record)) return record.accessToken;
      const current = (yield* this.#refresh()) ?? this.#store.read();
      return current && this.#agentConnected() && !this.#accessTokenExpired(current) ? current.accessToken : null;
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly repositoryTokens = Effect.fn("GitHubConnector.repositoryTokens")(
    function* (
      this: GitHubConnectorService,
      fullName: string,
    ): Effect.fn.Return<{ user: string; bot: string | null } | null, GitHubOperationError, GitHubPlatform> {
      const user = yield* this.accessToken();
      if (!user) return null;
      if (this.#botTokens.due()) yield* this.#renewBotTokens().pipe(Effect.catch(() => Effect.void));
      const [owner = "", name = ""] = fullName.split("/");
      return { user, bot: this.#botTokens.forRepository(owner, name) };
    },
    (operation) => this.#owned(operation),
  ).bind(this);

  readonly mcpAuthorization = Effect.fn("GitHubConnector.mcpAuthorization")(
    function* (this: GitHubConnectorService): Effect.fn.Return<string | null, GitHubOperationError, GitHubPlatform> {
      if (!this.#agentConnected()) return null;
      return this.#mcpProxy ? this.#mcpProxySecret : yield* this.accessToken();
    },
    (operation) => this.#owned(operation),
  ).bind(this);

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

  agentEnvironment(
    inherited: NodeJS.ProcessEnv = process.env,
    gitConfig: AgentGitConfigForm = "parameters",
  ): Record<string, string> {
    if (!this.#agentConnected()) return {};
    const tokenFile = shellQuote(this.#credentialFile().replaceAll("\\", "/"));
    const repositoriesFile = shellQuote(this.#repositoriesFile().replaceAll("\\", "/"));
    const inheritedGitConfig = inherited.GIT_CONFIG_PARAMETERS;
    const first = gitConfigCount(inherited.GIT_CONFIG_COUNT);
    const ownGhConfig =
      inherited.GH_CONFIG_DIR === undefined
        ? "unset GH_CONFIG_DIR"
        : `GH_CONFIG_DIR=${shellQuote(inherited.GH_CONFIG_DIR)}; export GH_CONFIG_DIR`;
    const ownGitConfig =
      gitConfig === "count"
        ? `GIT_CONFIG_COUNT=${first}; export GIT_CONFIG_COUNT`
        : ownGitConfigParameters(inheritedGitConfig);
    const helper = [
      '!f() { test "$1" = get || exit 0; p=; s=; h=; u=',
      "while IFS='=' read -r k v; do case $k in (path) p=$v;; (protocol) s=$v;; (host) h=$v;; (username) u=$v;; esac; done",
      `t=; test -n "$p" && t=$(awk -F '\\t' -v r="$p" 'BEGIN { sub(/\\/+$/, "", r); sub(/\\.git$/, "", r) } tolower($1) == tolower(r) { print $2; exit }' ${repositoriesFile} 2>/dev/null)`,
      `test -n "$t" || { o=$({ printf 'protocol=%s\\nhost=%s\\n' "$s" "$h"; test -z "$p" || printf 'path=%s\\n' "$p"; test -z "$u" || printf 'username=%s\\n' "$u"; echo; } | (${ownGhConfig}; ${ownGitConfig}; GIT_ASKPASS= SSH_ASKPASS= GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never exec git credential fill) 2>/dev/null) || o=`,
      "c=$(printf '%s\\n' \"$o\" | while IFS= read -r l; do case $l in (username=?*|password=?*) printf '%s\\n' \"$l\";; esac; done)",
      "case $c in (*password=*) printf '%s\\n' \"$c\"; exit 0;; esac; }",
      "echo username=x-access-token; printf 'password='",
      `if test -n "$t"; then printf '%s' "$t"; else cat ${tokenFile}; fi; echo; }; f`,
    ].join("; ");
    const settings: readonly (readonly [string, string])[] = [
      [GIT_CREDENTIAL_KEY, ""],
      [GIT_CREDENTIAL_KEY, helper],
      [GIT_USE_HTTP_PATH_KEY, "true"],
    ];
    if (gitConfig === "count")
      return {
        GH_CONFIG_DIR: this.#ghConfigDirectory(),
        GIT_CONFIG_COUNT: String(first + settings.length),
        ...Object.fromEntries(
          settings.flatMap(([key, value], offset) => [
            [`GIT_CONFIG_KEY_${first + offset}`, key],
            [`GIT_CONFIG_VALUE_${first + offset}`, value],
          ]),
        ),
      };
    return {
      GH_CONFIG_DIR: this.#ghConfigDirectory(),
      GIT_CONFIG_PARAMETERS: [
        ...(inheritedGitConfig ? [inheritedGitConfig] : []),
        ...settings.map(([key, value]) => gitConfigParameter(key, value)),
      ].join(" "),
    };
  }

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
      const committed = yield* this.#serialize(() =>
        Effect.gen({ self: this }, function* () {
          if (this.#pending !== pending || this.#disposed) return false;
          yield* this.#store.write(record);
          this.#generation += 1;
          this.#pending = null;
          this.#expired = false;
          this.#error = null;
          this.#botTokens.clear();
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

  readonly #installationRepositories = Effect.fn("GitHubConnector.installationRepositories")(function* (
    this: GitHubConnectorService,
    token: string,
  ): Effect.fn.Return<{ repositories: InstallationRepository[]; total: number }, GitHubOperationError, GitHubPlatform> {
    const [{ installations }, publicRepositories] = yield* Effect.all(
      [
        this.#getGitHubEffect(
          `https://api.github.com/user/installations?per_page=${GITHUB_PAGE_SIZE}`,
          token,
          githubInstallationsSchema,
        ),
        this.#publicRepositories(token).pipe(Effect.orElseSucceed(() => [])),
      ],
      { concurrency: "unbounded" },
    );
    const repositories: InstallationRepository[] = [];
    const eventsByInstallation = new Map(
      installations.map((installation) => {
        const subscribed = installation.events ?? [];
        return [installation.id, GITHUB_ROUTE_EVENTS.every((event) => subscribed.includes(event))] as const;
      }),
    );
    let total = 0;
    for (const installation of installations) {
      const events = eventsByInstallation.get(installation.id) ?? false;
      for (let page = 1; ; page += 1) {
        const answer = yield* this.#getGitHubEffect(
          `https://api.github.com/user/installations/${installation.id}/repositories?per_page=${GITHUB_PAGE_SIZE}&page=${page}`,
          token,
          githubRepositoriesSchema,
        );
        if (page === 1) total += answer.total_count;
        for (const repository of answer.repositories) {
          repositories.push({ fullName: repository.full_name, private: repository.private, events });
        }
        const listedAll = page * GITHUB_PAGE_SIZE >= answer.total_count || answer.repositories.length === 0;
        if (listedAll || repositories.length >= MAX_LISTED_REPOSITORIES) break;
      }
      if (repositories.length >= MAX_LISTED_REPOSITORIES) break;
    }
    const listed = new Set(repositories.map((repository) => repository.fullName.toLowerCase()));
    for (const repository of publicRepositories) {
      if (repositories.length >= MAX_LISTED_REPOSITORIES) break;
      const events = eventsByInstallation.get(repository.installationId);
      if (events === undefined || listed.has(repository.fullName.toLowerCase())) continue;
      listed.add(repository.fullName.toLowerCase());
      repositories.push({ fullName: repository.fullName, private: false, events });
      total += 1;
    }
    repositories.sort((left, right) => left.fullName.localeCompare(right.fullName, "en", { sensitivity: "base" }));
    return {
      repositories: repositories.slice(0, MAX_LISTED_REPOSITORIES),
      total: Math.max(total, repositories.length),
    };
  });

  readonly #publicRepositories = Effect.fn("GitHubConnector.publicRepositories")(function* (
    this: GitHubConnectorService,
    token: string,
  ): Effect.fn.Return<z.infer<typeof publicRepositoriesSchema>["repositories"], GitHubOperationError, GitHubPlatform> {
    const cached = this.#publicRepositoriesCache;
    if (cached?.token === token && this.#now() - cached.at < PUBLIC_REPOSITORIES_CACHE_MS) return cached.repositories;
    const response = yield* GitHubPlatform.use((platform) =>
      platform.fetch(new URL("/v1/github/public-repositories", this.#apiUrl).toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
      }),
    );
    if (!response.ok) {
      void response.body?.cancel();
      return [];
    }
    const answer = publicRepositoriesSchema.safeParse(yield* githubCall(() => response.json().catch(() => null)));
    if (!answer.success) return [];
    this.#publicRepositoriesCache = { token, at: this.#now(), repositories: answer.data.repositories };
    return answer.data.repositories;
  });

  readonly #canRead = Effect.fn("GitHubConnector.canRead")(
    function* (
      this: GitHubConnectorService,
      owner: string,
      name: string,
      signal: AbortSignal,
    ): Effect.fn.Return<boolean | null, GitHubOperationError, GitHubPlatform> {
      const token = yield* this.accessToken();
      if (!token) return null;
      const response = yield* GitHubPlatform.use((platform) =>
        platform.fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS)]),
          headers: githubApiHeaders(token),
        }),
      );
      void response.body?.cancel();
      if (response.status === 404) return false;
      return response.ok ? true : null;
    },
    (operation) => this.#owned(operation).pipe(Effect.catch(() => Effect.succeed(null))),
  ).bind(this);

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
          headers: githubApiHeaders(accessToken),
        }),
      );
    }).pipe(Effect.result);
    if (Result.isFailure(attempt2)) {
      const cause = attempt2.failure.cause;
      if (signal?.aborted) return yield* new GitHubOperationError({ cause: signal.reason });
      return yield* new GitHubOperationError({ cause: githubUnreachable(cause) });
    }
    const response = attempt2.success;
    const answer = schema.safeParse(yield* githubCall(() => response.json().catch(() => null)));
    if (response.status === 401) yield* this.#refused(accessToken);
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

  readonly #checkRefresh = Effect.fn("GitHubConnector.checkRefresh")(function* (this: GitHubConnectorService) {
    const record = this.#store.read();
    if (this.#disposed || !record || !this.#agentConnected()) return;
    if (this.#needsRefresh(record)) yield* Effect.forkIn(this.#owned(this.#refresh()), this.#scope);
    if (this.#botTokens.due()) yield* Effect.forkIn(this.#owned(this.#renewBotTokens()), this.#scope);
  });

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
    if (yield* this.#botTokens.renew(userToken)) yield* this.#refused(userToken);
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

  readonly #refused = Effect.fn("GitHubConnector.refused")(function* (this: GitHubConnectorService, token: string) {
    if (this.#disposed || this.#store.read()?.accessToken !== token || !this.#agentConnected()) return;
    yield* Effect.forkIn(this.#owned(this.#refresh()), this.#scope);
  });

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

  readonly #runRefresh = Effect.fn("GitHubConnector.runRefresh")(function* (
    this: GitHubConnectorService,
  ): Effect.fn.Return<GitHubConnectorRecord | null, GitHubOperationError, GitHubPlatform> {
    const generation = this.#generation;
    const record = this.#store.read();
    const app = this.#app;
    if (!record || !app || this.#expired) return null;
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

  #repositoriesFile(): string {
    return join(this.#toolDirectory, "repositories");
  }

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
      canRead: (owner, name, signal) => this.#canRead(owner, name, signal),
      refused: (token) => this.#refused(token),
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

  readonly #writeToolFilesEffect = Effect.fn("GitHubConnector.writeToolFiles")(function* (
    this: GitHubConnectorService,
    record: GitHubConnectorRecord,
  ): Effect.fn.Return<void, GitHubOperationError, GitHubPlatform> {
    yield* githubCall(() => mkdir(this.#ghConfigDirectory(), { recursive: true, mode: 0o700 }));
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

function ownGitConfigParameters(inherited: string | undefined): string {
  return [
    `m=$(printf '\\047%s\\047' ${GIT_USE_HTTP_PATH_KEY}=true)`,
    `case $GIT_CONFIG_PARAMETERS in (*"$m"*) a=\${GIT_CONFIG_PARAMETERS##*"$m"};; (*) a=;; esac`,
    `a=${shellQuote(inherited ?? "")}$a; GIT_CONFIG_PARAMETERS=\${a# }; export GIT_CONFIG_PARAMETERS`,
  ].join("; ");
}

function gitConfigCount(value: string | undefined): number {
  return value && /^\d+$/u.test(value) ? Number(value) : 0;
}

function gitConfigParameter(key: string, value: string): string {
  return shellQuote(`${key}=${value}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function githubApiHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "OpenBot",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
