import type {
  McpServerConfig,
  McpTestResult,
  RemoveMcpServerInput,
  SaveMcpServerInput,
  SetMcpServerEnabledInput,
  TestMcpServerInput,
} from "@openbot/contracts/ipc";
import { mcpConfigErrors, normalizeMcpConfig } from "@openbot/contracts/ipc";
import type { Logger } from "@openbot/logging";
import type { AgentProvider } from "../agent-client";
import { McpHandoffLog } from "../mcp-handoff-log";
import { type McpOAuthAuthority, normalizeResource } from "../mcp-oauth-provider";
import { testMcpServer } from "../mcp-probe";
import {
  type McpServerDrop,
  type McpToolRuntimeSource,
  type McpToolRuntimes,
  NO_MCP_TOOL_RUNTIMES,
} from "../mcp-provider-shapes";
import { mcpSecretValues, redactMcpValues } from "../mcp-redaction";
import type { McpServerStore } from "../mcp-server-store";
import type { ProviderClientContext } from "../provider-drivers";
import { providerLabel } from "./thread-items";

/**
 * Whether a person is in front of this test.
 *
 * Only an interactive test may open a browser for a sign-in. The same method answers the remote
 * Team API, where opening a window on the host machine would be a surprise nobody asked for. A
 * remote test still spends the host's stored sign-ins: the administrator tests the host's servers,
 * not their own, and a stored token that works locally must work for them too.
 */
export interface TestMcpServerOptions {
  interactive?: boolean;
  /** Spend stored credentials without opening a browser. Implied by `interactive`. */
  storedCredentials?: boolean;
}

export interface McpGatewayHooks {
  emitError(code: string, error: unknown): void;
  /** Marks every agent's provider session for refresh. Read late: the threads are built after this. */
  refreshAllAgentRuntimes(): void;
}

export interface McpGatewayOptions {
  servers: McpServerStore;
  /** The main process's knowledge of this machine: the tool runtimes and the http sign-ins. */
  credentials: ProviderClientContext;
  computerUseMcpServer: () => McpServerConfig | null;
  /** The agent service logger, so a drop report keeps the `agent-service` prefix it always had. */
  logger: Logger;
  hooks: McpGatewayHooks;
}

/**
 * Owns the MCP servers this machine holds and everything that leaves with them: the stored
 * configurations, the Computer Use entry, the bearer tokens minted for http servers, the record of
 * what has been handed to a provider process, and the redaction that record makes possible.
 *
 * Holds no connection of its own. It never imports the agent service facade.
 */
export class McpGateway {
  readonly #servers: McpServerStore;
  readonly #computerUseMcpServer: () => McpServerConfig | null;
  /**
   * What OpenBot downloaded for the MCP servers, read at each use. It travels with the credentials
   * because both are the main process's knowledge of this machine, and because the clients already
   * take that object; this field is only for the two readers that are not a client: the Test button
   * and the Codex thread configuration.
   */
  readonly #toolRuntimes: McpToolRuntimeSource;
  /**
   * The sign-ins this machine holds for http MCP servers, or `null` when nothing signs in - a test
   * harness, and a build with no secret storage. It travels with the credentials for the same
   * reason as the runtimes above.
   */
  readonly #oauth: McpOAuthAuthority | null;
  /**
   * What has already been handed to a provider process, kept for redaction. Declared here because
   * both hand-off paths - the client credentials and `enabled` - start in this class.
   */
  readonly #handoff = new McpHandoffLog();
  /**
   * Every drop already reported, so a provider that respawns each turn does not repeat itself.
   * Cleared whenever the MCP list changes, because the user is then owed a fresh answer.
   */
  readonly #reportedDrops = new Set<string>();
  readonly #logger: Logger;
  readonly #hooks: McpGatewayHooks;

  constructor(options: McpGatewayOptions) {
    const { credentials } = options;
    this.#servers = options.servers;
    this.#computerUseMcpServer = options.computerUseMcpServer;
    this.#toolRuntimes = () => credentials.mcpToolRuntimes?.() ?? NO_MCP_TOOL_RUNTIMES;
    this.#oauth = credentials.mcpOAuth ?? null;
    this.#logger = options.logger;
    this.#hooks = options.hooks;
  }

  /** The hand-off record, for the provider runtime that reads the names it holds. */
  handoffLog(): McpHandoffLog {
    return this.#handoff;
  }

  toolRuntimes(): McpToolRuntimes {
    return this.#toolRuntimes();
  }

  /** The bearer token for one configuration, asked at every hand-off and never written to a row. */
  async authorization(config: McpServerConfig): Promise<string | null> {
    const token = (await this.#oauth?.accessToken(config.url)) ?? null;
    // The one place a minted token is known before it leaves this process. The row never holds
    // it, so this is what lets `redact` keep it out of a provider's own report of a failure.
    if (token) this.#handoff.recordSecret(token);
    return token;
  }

  /**
   * Remembers a set that leaves for a provider, so its secrets stay redactable after the user edits
   * them. This is the second of the two ways one leaves; the other is `enabled`, which the Codex
   * thread configuration reads.
   */
  record(configs: readonly McpServerConfig[]): McpServerConfig[] {
    return this.#handoff.record(configs);
  }

  /**
   * The MCP servers this machine holds.
   *
   * Configurations only: OpenBot holds no connection of its own to report. A connection is made
   * when the user asks for a test, and when an agent starts - and the second is the provider's own.
   */
  list(): McpServerConfig[] {
    return this.#servers.list();
  }

  save(input: SaveMcpServerInput): McpServerConfig[] {
    this.#servers.save(input.config);
    return this.changed();
  }

  remove(input: RemoveMcpServerInput): McpServerConfig[] {
    const removed = this.#servers.list().find((config) => config.id === input.mcpServerId);
    this.#servers.remove(input.mcpServerId);
    const list = this.changed();
    /*
     * A row that goes takes its sign-in with it: a refresh token nothing can reach again is a secret
     * kept for no reason. Only when no row is left naming the same account, because two rows on one
     * URL are one account to the server and dropping it would sign the other one out too. Compared
     * normalized, as the store keys it: `https://mcp.stripe.com` and `https://mcp.stripe.com/` share
     * one credential, and removing either row must keep the other's.
     */
    const removedResource = removed?.transport === "http" ? normalizeResource(removed.url) : null;
    if (
      removed &&
      removedResource &&
      !list.some((config) => config.transport === "http" && normalizeResource(config.url) === removedResource)
    ) {
      void this.#oauth?.forget(removed.url);
    }
    return list;
  }

  setEnabled(input: SetMcpServerEnabledInput): McpServerConfig[] {
    this.#servers.setEnabled(input.mcpServerId, input.enabled);
    return this.changed();
  }

  /**
   * The new list, and every agent marked to start a fresh provider session for its next turn.
   *
   * Without the mark, a provider session that is already loaded keeps the tools it was given: a
   * removed server stays callable and an added one is invisible until the app restarts. The public
   * thread and its history are untouched - only the private provider session is replaced.
   */
  changed(): McpServerConfig[] {
    // A user who edits a server and does not fix it has to be told again. Without this the first
    // report of a run would be the only one, and an edit that changed nothing would look like a fix.
    this.#reportedDrops.clear();
    this.#hooks.refreshAllAgentRuntimes();
    return this.list();
  }

  /**
   * Rows installed from the old catalog's `mcp-remote` bridge definitions reach their servers
   * natively from here on. Exact matches only; anything the user changed stays as it is.
   */
  migrateCatalogBridgesToHttp(): void {
    this.#servers.migrateCatalogBridgesToHttp();
  }

  /**
   * Connects to the configuration the user is looking at, once, and reports what it found.
   *
   * The configuration comes from the form, not from the table, so a draft can be tested before it
   * is saved. It is validated here first: a name this machine reserves, or a missing command, is a
   * sentence rather than a connection attempt.
   */
  async test(input: TestMcpServerInput, options: TestMcpServerOptions = {}): Promise<McpTestResult> {
    const config = normalizeMcpConfig(input.config);
    const errors = mcpConfigErrors(config);
    const firstError = errors.name ?? errors.command ?? errors.url;
    if (firstError) throw new Error(firstError);
    // A browser only opens when a person is waiting for it. The remote Team API route asks for the
    // same test and gets the silent answer, because nobody is at this machine to finish a sign-in.
    // The stored sign-ins are still spent: without them the probe cannot read or refresh the host's
    // token, and a remote administrator gets a false 401 for a server local agents use. `signIn`
    // stays `null`, so a 401 the stored token cannot fix is reported rather than waited on.
    const stored = this.#oauth;
    const silent: McpOAuthAuthority | undefined =
      !options.interactive && options.storedCredentials && stored
        ? {
            accessToken: (url) => stored.accessToken(url),
            signIn: () => null,
            forget: (url) => stored.forget(url),
          }
        : undefined;
    const oauth = options.interactive ? (stored ?? undefined) : silent;
    return testMcpServer(config, undefined, this.#toolRuntimes(), oauth);
  }

  /**
   * What the providers are given at spawn. They connect for themselves; a test is not used.
   *
   * The Computer Use entry is appended here rather than stored, because it exists only while the
   * driver daemon runs and the user never configured it. This one line is what gives Codex, Claude
   * and the ACP providers the same tools: all three read this function.
   */
  enabled(): McpServerConfig[] {
    const computerUse = this.#computerUseMcpServer();
    const configured = this.#servers.listEnabled();
    return this.#handoff.record(computerUse ? [...configured, computerUse] : configured);
  }

  /**
   * What a provider was not given, said once.
   *
   * The event carries no `agentId` on purpose. The MCP list is machine-scoped, so every agent on
   * this machine has the same problem: with an id the renderer would put a banner in each of ten
   * conversations, and without one it shows a single deduped toast, which is what this is.
   *
   * Nothing is stored. A drop is a fact about one hand-off, and a stored one would be a claim about
   * right now that nothing keeps true - the same reason the panel holds no health state.
   */
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
      this.#hooks.emitError(
        "mcp_server_not_started",
        `${providerLabel(provider)} did not get the MCP server "${drop.name}". ${drop.detail}`,
      );
    }
  }

  /**
   * One piece of provider text with the MCP credentials taken out of it.
   *
   * The stored configurations and the hand-off log together, so a credential a running process
   * still holds stays covered after the user edits or removes the server that named it. Every
   * reader of provider text that leaves the agent service - a renderer error event, and the failure
   * reason the queue writes to the database - goes through here. `redactMcpValues` ends with
   * `redactText`, which covers the patterns shared across the app.
   */
  redact(text: string): string {
    return redactMcpValues(text, [...mcpSecretValues(this.#servers.list()), ...this.#handoff.values()]);
  }
}
