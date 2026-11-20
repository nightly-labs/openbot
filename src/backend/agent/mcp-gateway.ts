import type {
  McpServerConfig,
  McpSignInAppInput,
  McpSignInAppState,
  McpSignInState,
  RemoveMcpServerInput,
  SaveMcpServerInput,
  SaveMcpSignInAppInput,
  SetMcpServerEnabledInput,
  SignOutMcpServerInput,
  TestMcpServerInput,
} from "@openbot/contracts/ipc";
import { GITHUB_CONNECTOR_MCP_SERVER_ID, mcpConfigErrors, normalizeMcpConfig } from "@openbot/contracts/ipc";
import { mcpAccountFragment, withoutMcpAccountFragment } from "@openbot/contracts/mcp-accounts";
import { matchingSourceKeys, sourceText } from "@openbot/i18n/source";
import { type Logger, redactSecrets, toLogValue } from "@openbot/logging";
import { Effect, Exit, Result, Schema, Scope } from "effect";
import type { AgentProvider } from "../agent-client";
import { causeHelpers } from "../effect-boundary";
import type { McpOperationError } from "../mcp-effects";
import { McpHandoffLog } from "../mcp-handoff-log";
import {
  type McpOAuthAuthority,
  type McpSignInOffer,
  type McpSignInOpener,
  mcpOAuthAccountKey,
} from "../mcp-oauth-provider";
import { McpOAuthProxy, type McpOAuthProxyTarget, mcpOAuthProxyAgentKey, mcpOAuthProxyRoute } from "../mcp-oauth-proxy";
import {
  callMcpServerTool,
  hasCredentialHeader,
  inspectMcpServer,
  type McpProbeOutcome,
  type McpSignInPlace,
  type McpToolArguments,
} from "../mcp-probe";
import {
  type McpEndpoint,
  type McpEndpointRefusal,
  type McpServerDrop,
  type McpToolRuntimeSource,
  type McpToolRuntimes,
  mcpFingerprintValues,
  NO_MCP_TOOL_RUNTIMES,
} from "../mcp-provider-shapes";
import { mcpSecretValues, redactMcpValues } from "../mcp-redaction";
import { McpServerError, type McpServerStore } from "../mcp-server-store";
import type { ProviderClientContext } from "../provider-drivers";
import { providerLabel } from "./thread-items";

export interface TestMcpServerOptions {
  interactive?: boolean;
  storedCredentials?: boolean;
  signInPlace?: McpSignInPlace;
  open?: McpSignInOpener;
  deepLinkRedirectUrl?: string;
}

export interface McpServiceSignIn {
  id: string;
  name: string | null;
  url: string;
  token: () => Effect.Effect<string | null, McpOperationError>;
  refresh: (rejected: string) => Effect.Effect<string | null, McpOperationError>;
}

export interface McpGatewayHooks {
  emitError(code: string, error: unknown): void;
  refreshAllAgentRuntimes(): Effect.Effect<void, McpGatewayFailed>;
}

export interface GitHubConnectorSource {
  mcpServer(): McpServerConfig | null;
  mcpAuthorization(): Effect.Effect<string | null, McpGatewayFailed>;
}

export interface McpGatewayOptions {
  servers: McpServerStore;
  credentials: ProviderClientContext;
  computerUseMcpServer: () => McpServerConfig | null;
  githubConnector?: GitHubConnectorSource | null;
  agents?: () => ReadonlyArray<{ id: string; name: string }>;
  logger: Logger;
  hooks: McpGatewayHooks;
}

export class McpGateway {
  readonly #servers: McpServerStore;
  readonly #computerUseMcpServer: () => McpServerConfig | null;
  readonly #githubConnector: GitHubConnectorSource | null;
  readonly #toolRuntimes: McpToolRuntimeSource;
  readonly #oauth: McpOAuthAuthority | null;
  readonly #handoff = new McpHandoffLog();
  readonly #reportedDrops = new Set<string>();
  readonly #testedTools = new Map<string, string>();
  readonly #signInFailures = new Map<string, string>();
  readonly #proxy: McpOAuthProxy;
  readonly #logger: Logger;
  readonly #hooks: McpGatewayHooks;
  readonly #scope = Scope.makeUnsafe();

  constructor(options: McpGatewayOptions) {
    const { credentials } = options;
    this.#servers = options.servers;
    this.#computerUseMcpServer = options.computerUseMcpServer;
    this.#githubConnector = options.githubConnector ?? null;
    this.#toolRuntimes = () => credentials.mcpToolRuntimes?.() ?? NO_MCP_TOOL_RUNTIMES;
    this.#oauth = credentials.mcpOAuth ?? null;
    this.#logger = options.logger;
    this.#hooks = options.hooks;
    const oauth = this.#oauth;
    const agents = options.agents;
    this.#proxy = new McpOAuthProxy({
      settings: credentials.mcpOAuthProxySettings ?? null,
      target: (route) => this.#proxyTarget(route),
      refresh: (url, rejected) => (oauth ? oauth.refreshAccessToken(url, rejected) : Effect.succeed(null)),
      signInEnded: (url) => !oauth?.signedIn(url),
      ...(credentials.appVersion
        ? {
            client: {
              version: credentials.appVersion,
              agentName: (agentKey) =>
                agents?.().find((agent) => mcpOAuthProxyAgentKey(agent.id) === agentKey)?.name ?? null,
            },
          }
        : {}),
    });
  }

  handoffLog(): McpHandoffLog {
    return this.#handoff;
  }

  toolRuntimes(): McpToolRuntimes {
    return this.#toolRuntimes();
  }

  readonly endpoint = Effect.fnUntraced(function* (
    this: McpGateway,
    config: McpServerConfig,
    agentId: string | null = null,
  ): Effect.fn.Return<McpEndpoint | McpEndpointRefusal, McpGatewayFailed> {
    if (config.id === GITHUB_CONNECTOR_MCP_SERVER_ID)
      return { url: config.url, authorization: yield* this.#githubAuthorization(), proxied: false };
    if (!this.#proxied(config))
      return { url: withoutMcpAccountFragment(config.url), authorization: null, proxied: false };
    const route = yield* this.#proxy
      .route(mcpOAuthProxyRoute(config.id, config.url), agentId === null ? null : mcpOAuthProxyAgentKey(agentId))
      .pipe(Effect.result);
    if (Result.isFailure(route)) {
      this.#logger.warn("The MCP sign-in proxy did not start.", { cause: toLogValue(route.failure.cause) });
      return { error: sourceText("error.backend.mcpOAuthProxyUnavailable") };
    }
    this.#handoff.recordSecret(route.success.bearer);
    return { url: route.success.url, authorization: route.success.bearer, proxied: true };
  });

  readonly #githubAuthorization = Effect.fnUntraced(function* (this: McpGateway) {
    const github = this.#githubConnector;
    const token = github ? yield* github.mcpAuthorization().pipe(toMcpGatewayFailed) : null;
    if (token) this.#handoff.recordSecret(token);
    return token;
  });

  readonly proxyFingerprint = Effect.fnUntraced(function* (
    this: McpGateway,
    configs: readonly McpServerConfig[],
  ): Effect.fn.Return<string | null, McpGatewayFailed> {
    const proxied = this.proxiedServerIds(configs);
    if (proxied.length === 0) return null;
    const identity = yield* this.#proxy.identity().pipe(Effect.result);
    if (Result.isFailure(identity)) return JSON.stringify([null, proxied]);
    return JSON.stringify([identity.success, proxied]);
  });

  proxiedServerIds(configs: readonly McpServerConfig[]): string[] {
    return configs
      .filter((config) => config.enabled && this.#proxied(config))
      .map((config) => config.id)
      .sort();
  }

  readonly close = Effect.fnUntraced(function* (this: McpGateway) {
    yield* Scope.close(this.#scope, Exit.void);
    yield* this.#proxy.close();
  });

  #proxied(config: McpServerConfig): boolean {
    const oauth = this.#oauth;
    return (
      oauth !== null &&
      config.transport === "http" &&
      config.id !== GITHUB_CONNECTOR_MCP_SERVER_ID &&
      !config.headers.some((pair) => pair.key.trim().toLowerCase() === "authorization") &&
      oauth.hasSignIn(config.url)
    );
  }

  #proxyTarget(route: string): Effect.Effect<McpOAuthProxyTarget | null, McpOperationError> {
    const oauth = this.#oauth;
    const config = this.#servers
      .listEnabled()
      .find((row) => this.#proxied(row) && mcpOAuthProxyRoute(row.id, row.url) === route);
    if (!config || !oauth) return Effect.succeed(null);
    return oauth
      .accessToken(config.url)
      .pipe(Effect.map((token) => (token ? { url: config.url, headers: config.headers, token } : null)));
  }

  record(configs: readonly McpServerConfig[]): McpServerConfig[] {
    return this.#handoff.record(configs);
  }

  list(): McpServerConfig[] {
    return this.#servers.list();
  }

  readonly save = Effect.fn("McpGateway.save")(function* (this: McpGateway, input: SaveMcpServerInput) {
    yield* Effect.try({
      try: () => this.#servers.save(input.config),
      catch: (cause) => new McpGatewayFailed({ cause }),
    });
    return yield* this.changed();
  }, Effect.uninterruptible);

  readonly remove = Effect.fn("McpGateway.remove")(function* (this: McpGateway, input: RemoveMcpServerInput) {
    const removed = this.#servers.list().find((config) => config.id === input.mcpServerId);
    yield* Effect.try({
      try: () => this.#servers.remove(input.mcpServerId),
      catch: (cause) => new McpGatewayFailed({ cause }),
    });
    const list = yield* this.changed();
    const removedResource = removed?.transport === "http" ? mcpOAuthAccountKey(removed.url) : null;
    if (
      removed &&
      removedResource &&
      !list.some((config) => config.transport === "http" && mcpOAuthAccountKey(config.url) === removedResource)
    ) {
      this.#signInFailures.delete(removedResource);
      if (this.#oauth) yield* this.#oauth.forget(removed.url).pipe(toMcpGatewayFailed);
    }
    return list;
  }, Effect.uninterruptible);

  readonly setEnabled = Effect.fn("McpGateway.setEnabled")(function* (
    this: McpGateway,
    input: SetMcpServerEnabledInput,
  ) {
    yield* Effect.try({
      try: () => this.#servers.setEnabled(input.mcpServerId, input.enabled),
      catch: (cause) => new McpGatewayFailed({ cause }),
    });
    return yield* this.changed();
  }, Effect.uninterruptible);

  readonly changed = Effect.fn("McpGateway.changed")(function* (this: McpGateway) {
    this.#reportedDrops.clear();
    yield* this.#hooks.refreshAllAgentRuntimes();
    return this.list();
  });

  migrateCatalogRows(): void {
    this.#servers.migrateCatalogRows();
  }

  readonly test = Effect.fnUntraced(function* (
    this: McpGateway,
    input: TestMcpServerInput,
    options: TestMcpServerOptions = {},
  ) {
    const config = normalizeMcpConfig(input.config);
    const errors = mcpConfigErrors(config);
    const firstError = errors.name ?? errors.command ?? errors.url;
    if (firstError) return yield* new McpGatewayFailed({ cause: new Error(firstError) });
    const stored = this.#oauth;
    const silent: Pick<McpOAuthAuthority, "accessToken" | "signIn"> | undefined =
      !options.interactive && options.storedCredentials && stored
        ? { accessToken: (url) => stored.accessToken(url), signIn: () => null }
        : undefined;
    const open = options.open;
    const opened: Pick<McpOAuthAuthority, "accessToken" | "signIn"> | undefined =
      stored && open
        ? {
            accessToken: (url) => stored.accessToken(url),
            signIn: (url) => stored.signIn(url, open, options.deepLinkRedirectUrl),
          }
        : (stored ?? undefined);
    const oauth = options.interactive ? opened : silent;
    const outcome = yield* inspectMcpServer(
      config,
      undefined,
      this.#toolRuntimes(),
      oauth,
      options.signInPlace ?? null,
    ).pipe(toMcpGatewayFailed);
    if (!options.interactive) yield* this.#refreshForTestedTools(config, outcome);
    return { toolCount: outcome.toolCount, error: outcome.error };
  });

  readonly #refreshForTestedTools = Effect.fnUntraced(function* (
    this: McpGateway,
    config: McpServerConfig,
    outcome: McpProbeOutcome,
  ) {
    if (outcome.error !== null) return;
    const saved = this.#servers.listEnabled().find((row) => row.id === config.id);
    const [key] = saved ? mcpFingerprintValues([saved]) : [];
    if (key === undefined || key !== mcpFingerprintValues([{ ...config, enabled: true }])[0]) return;
    const tools = [String(outcome.toolCount), ...[...outcome.tools].sort()].join("\u0000");
    const route = saved !== undefined && this.#proxied(saved) ? mcpOAuthProxyRoute(saved.id, saved.url) : null;
    const failedStart = route !== null && this.#proxy.failedStart(route);
    if (this.#testedTools.get(key) === tools && !failedStart) return;
    yield* this.#hooks.refreshAllAgentRuntimes();
    if (route !== null && failedStart) this.#proxy.reportedFailedStart(route);
    this.#testedTools.set(key, tools);
  });

  readonly inspect = Effect.fnUntraced(function* (this: McpGateway, config: McpServerConfig, tested = false) {
    const normalized = normalizeMcpConfig(config);
    const errors = mcpConfigErrors(normalized);
    const firstError = errors.name ?? errors.command ?? errors.url;
    if (firstError) return yield* new McpGatewayFailed({ cause: new Error(firstError) });
    const stored = this.#oauth;
    const silent: Pick<McpOAuthAuthority, "accessToken" | "signIn"> | undefined = stored
      ? { accessToken: (url) => stored.accessToken(url), signIn: () => null }
      : undefined;
    const outcome = yield* inspectMcpServer(normalized, undefined, this.#toolRuntimes(), silent, "here").pipe(
      toMcpGatewayFailed,
    );
    if (tested) yield* this.#refreshForTestedTools(normalized, outcome);
    return outcome;
  });

  readonly callTool = Effect.fnUntraced(function* (
    this: McpGateway,
    config: McpServerConfig,
    name: string,
    args: McpToolArguments,
  ) {
    const github = config.id === GITHUB_CONNECTOR_MCP_SERVER_ID ? yield* this.#githubAuthorization() : null;
    const stored = this.#oauth;
    return yield* callMcpServerTool(
      config,
      name,
      args,
      this.#toolRuntimes(),
      config.id === GITHUB_CONNECTOR_MCP_SERVER_ID
        ? { accessToken: () => Effect.succeed(github) }
        : stored
          ? { accessToken: (url) => stored.accessToken(url) }
          : undefined,
    ).pipe(toMcpGatewayFailed);
  });

  readonly signIn = Effect.fnUntraced(function* (
    this: McpGateway,
    input: TestMcpServerInput,
    open?: McpSignInOpener,
    deepLinkRedirectUrl?: string,
  ) {
    const result = yield* this.test(input, {
      interactive: true,
      signInPlace: "here",
      ...(open ? { open } : {}),
      ...(open && deepLinkRedirectUrl !== undefined ? { deepLinkRedirectUrl } : {}),
    });
    const resource = mcpOAuthAccountKey(input.config.url);
    const inUse =
      resource !== null &&
      this.#servers
        .listEnabled()
        .some((config) => config.transport === "http" && mcpOAuthAccountKey(config.url) === resource);
    if (result.error === null && inUse) yield* this.#hooks.refreshAllAgentRuntimes();
    if (resource !== null) {
      if (result.error === null) this.#signInFailures.delete(resource);
      else if (matchingSourceKeys(result.error)[0] !== "error.backend.mcpSignInCancelled")
        this.#signInFailures.set(resource, result.error);
    }
    return result;
  });

  signInFailure(url: string): string | null {
    const resource = mcpOAuthAccountKey(url);
    return (resource !== null && this.#signInFailures.get(resource)) || null;
  }

  cancelSignIn(url: string): void {
    this.#oauth?.cancelSignIn(url);
  }

  signInLink(url: string): string | null {
    return this.#oauth?.signInLink(url) ?? null;
  }

  readonly signOut = Effect.fn("McpGateway.signOut")(function* (this: McpGateway, input: SignOutMcpServerInput) {
    const config = this.#httpRow(input.mcpServerId);
    if (config && this.#oauth) {
      this.#oauth.cancelSignIn(config.url);
      const resource = mcpOAuthAccountKey(config.url);
      if (resource !== null) this.#signInFailures.delete(resource);
      yield* this.#oauth.signOut(config.url).pipe(toMcpGatewayFailed);
      yield* this.#hooks.refreshAllAgentRuntimes();
    }
    return this.signIns();
  }, Effect.uninterruptible);

  signInApp(input: McpSignInAppInput): McpSignInAppState {
    const config = this.#httpRow(input.mcpServerId);
    return {
      redirectUrl: this.#oauth?.redirectUrl ?? null,
      app: config && this.#oauth ? this.#oauth.signInApp(config.url) : null,
    };
  }

  readonly saveSignInApp = Effect.fn("McpGateway.saveSignInApp")(function* (
    this: McpGateway,
    input: SaveMcpSignInAppInput,
  ) {
    const { config, oauth } = yield* this.#signInAppTarget(input.mcpServerId);
    if (!input.clientId.trim())
      return yield* new McpGatewayFailed({
        cause: new McpServerError(sourceText("error.backend.mcpSignInAppClientId")),
      });
    const dropped = yield* oauth
      .saveSignInApp(config.url, { clientId: input.clientId, clientSecret: input.clientSecret, scope: input.scope })
      .pipe(toMcpGatewayFailed);
    if (dropped) yield* this.#hooks.refreshAllAgentRuntimes();
    return this.signInApp(input);
  }, Effect.uninterruptible);

  readonly removeSignInApp = Effect.fn("McpGateway.removeSignInApp")(function* (
    this: McpGateway,
    input: McpSignInAppInput,
  ) {
    const { config, oauth } = yield* this.#signInAppTarget(input.mcpServerId);
    if (yield* oauth.removeSignInApp(config.url).pipe(toMcpGatewayFailed)) yield* this.#hooks.refreshAllAgentRuntimes();
    return this.signInApp(input);
  }, Effect.uninterruptible);

  #signInAppTarget(
    mcpServerId: string,
  ): Effect.Effect<{ config: McpServerConfig; oauth: McpOAuthAuthority }, McpGatewayFailed> {
    const config = this.#httpRow(mcpServerId);
    if (!config)
      return new McpGatewayFailed({ cause: new McpServerError(sourceText("error.backend.mcpSignInAppNoServer")) });
    if (!this.#oauth)
      return new McpGatewayFailed({ cause: new McpServerError(sourceText("error.backend.mcpSignInAppUnavailable")) });
    return Effect.succeed({ config, oauth: this.#oauth });
  }

  #httpRow(mcpServerId: string): McpServerConfig | undefined {
    return this.#servers.list().find((row) => row.id === mcpServerId && row.transport === "http");
  }

  signIns(): McpSignInState[] {
    const oauth = this.#oauth;
    return this.#servers
      .list()
      .filter((config) => config.transport === "http")
      .map((config) => ({
        mcpServerId: config.id,
        signedIn: oauth?.signedIn(config.url) ?? false,
        needsSignIn: oauth?.needsSignIn(config.url) ?? false,
      }));
  }

  serviceSignIns(host: string): McpServiceSignIn[] {
    const oauth = this.#oauth;
    if (!oauth) return [];
    const rows = this.#servers.listEnabled().filter((row) => {
      if (!this.#proxied(row) || !oauth.signedIn(row.url)) return false;
      try {
        return new URL(row.url).hostname === host;
      } catch {
        return false;
      }
    });
    return [
      ...rows.filter((row) => mcpAccountFragment(row.url) === null),
      ...rows.filter((row) => mcpAccountFragment(row.url) !== null),
    ].map((config) => ({
      id: config.id,
      name: mcpAccountFragment(config.url) === null ? null : config.name,
      url: withoutMcpAccountFragment(config.url),
      token: () => oauth.accessToken(config.url),
      refresh: (rejected: string) => oauth.refreshAccessToken(config.url, rejected),
    }));
  }

  serviceSignIn(host: string, accountId: string | null = null): McpServiceSignIn | null {
    const accounts = this.serviceSignIns(host);
    return (accountId === null ? accounts[0] : accounts.find((account) => account.id === accountId)) ?? null;
  }

  signInOffer(config: McpServerConfig): Effect.Effect<McpSignInOffer> {
    const oauth = this.#oauth;
    if (!oauth || config.transport !== "http" || hasCredentialHeader(config)) return Effect.succeed("none");
    return oauth.signInOffer(config.url);
  }

  enabled(): McpServerConfig[] {
    const configured = this.#servers.listEnabled();
    return this.#handoff.record([...configured, ...this.#builtIn(configured)]);
  }

  builtIn(): McpServerConfig[] {
    return this.#builtIn(this.#servers.listEnabled());
  }

  #builtIn(configured: readonly McpServerConfig[]): McpServerConfig[] {
    const builtIn: McpServerConfig[] = [];
    const computerUse = this.#computerUseMcpServer();
    if (computerUse) builtIn.push(computerUse);
    const github = this.#githubConnector?.mcpServer() ?? null;
    if (github && !configured.some((config) => config.name === github.name)) builtIn.push(github);
    return builtIn;
  }

  reportDrops(provider: AgentProvider, drops: readonly McpServerDrop[]): void {
    for (const drop of drops) {
      const key = [provider, drop.name, drop.reason, drop.detail].join("\u0000");
      if (this.#reportedDrops.has(key)) continue;
      this.#reportedDrops.add(key);
      this.#logger.warn("An MCP server was not given to a provider.", {
        provider,
        server: drop.name,
        reason: drop.reason,
        detail: this.redact(drop.detail),
      });
      if (drop.signIn) {
        this.reportSignInFailure(provider, drop.name, drop.detail);
        continue;
      }
      this.#hooks.emitError(
        "mcp_server_not_started",
        drop.reason === "failed_in_provider"
          ? drop.detail
          : `${providerLabel(provider)} did not get the MCP server "${drop.name}". ${drop.detail}`,
      );
    }
  }

  reportSignInFailure(provider: AgentProvider, name: string, signInText: string): void {
    const config = this.#servers.listEnabled().find((row) => row.transport === "http" && row.name === name);
    const emit = (text: string) => this.#hooks.emitError("mcp_server_not_started", text);
    if (!config) {
      emit(signInText);
      return;
    }
    const keyText = sourceText("error.backend.mcpServerKeyForProvider", { provider: providerLabel(provider), name });
    Effect.runFork(
      this.inspect(config).pipe(
        Effect.map((outcome) => (outcome.needs === "key" ? keyText : signInText)),
        Effect.orElseSucceed(() => signInText),
        Effect.flatMap((text) => Effect.sync(() => emit(text))),
        Effect.forkIn(this.#scope),
      ),
    );
  }

  redact(text: string): string {
    return redactMcpValues(text, this.#secretValues());
  }

  redactForAgent(text: string): string {
    return redactMcpValues(text, this.#secretValues(), redactSecrets);
  }

  #secretValues(): string[] {
    return [...mcpSecretValues(this.#servers.list()), ...this.#handoff.values()];
  }
}

export class McpGatewayFailed extends Schema.TaggedError<McpGatewayFailed>()("McpGatewayFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toMcpGatewayFailed } = causeHelpers(McpGatewayFailed);
