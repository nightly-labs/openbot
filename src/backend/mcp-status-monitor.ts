import type { McpConnectionState, McpServerConfig, McpServerStatus } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { probeMcpServer } from "./mcp-probe";
import { usableMcpServers } from "./mcp-provider-shapes";

const logger = createOpenBotLogger("mcp-status");

/** How many servers are handshaken at once, so opening the panel does not start thirty processes. */
const PROBE_CONCURRENCY = 4;

export interface McpStatusMonitorOptions {
  configs: () => McpServerConfig[];
  emit: (statuses: McpServerStatus[]) => void;
}

interface OpenProbe {
  controller: AbortController;
  settled: Promise<void>;
}

/**
 * The connection states the MCP settings panel shows, for as long as it is open.
 *
 * The providers make their own connections when an agent starts and are entirely independent of
 * this class. Nothing here is a connection an agent uses, and closing the panel takes nothing away
 * from a running agent.
 */
export class McpStatusMonitor {
  #watchers = 0;
  #statuses = new Map<string, McpServerStatus>();
  readonly #probes = new Map<string, OpenProbe>();

  constructor(private readonly options: McpStatusMonitorOptions) {}

  /** The states known right now. A closed panel reports nothing, because it holds no connection. */
  statuses(): Map<string, McpServerStatus> {
    return new Map(this.#statuses);
  }

  /**
   * Starts watching. Refcounted, because the modal can reopen before a close has finished; the
   * second open must not begin a second set of probes.
   */
  open(): void {
    this.#watchers += 1;
    if (this.#watchers > 1) return;
    void this.#probeAll();
  }

  /** Re-runs one server after a save or a toggle. */
  reprobe(mcpServerId: string): void {
    if (this.#watchers === 0) return;
    const config = this.options.configs().find((candidate) => candidate.id === mcpServerId);
    if (!config) {
      this.#statuses.delete(mcpServerId);
      this.#publish();
      return;
    }
    void this.#probeOne(config);
  }

  /** Stops watching once the last panel closes, leaving no child process behind. */
  async close(): Promise<void> {
    if (this.#watchers === 0) return;
    this.#watchers -= 1;
    if (this.#watchers > 0) return;
    await this.stop();
  }

  async stop(): Promise<void> {
    this.#watchers = 0;
    const open = [...this.#probes.values()];
    this.#probes.clear();
    for (const probe of open) probe.controller.abort();
    await Promise.all(open.map((probe) => probe.settled));
    this.#statuses = new Map();
  }

  async #probeAll(): Promise<void> {
    const configs = this.options.configs();
    for (const config of configs) this.#statuses.set(config.id, seed(config));
    this.#publish();

    const pending = configs.filter((config) => config.enabled);
    const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, pending.length) }, async () => {
      for (let config = pending.shift(); config; config = pending.shift()) await this.#probeOne(config);
    });
    await Promise.all(workers);
  }

  async #probeOne(config: McpServerConfig): Promise<void> {
    this.#probes.get(config.id)?.controller.abort();
    this.#statuses.set(config.id, seed(config));
    this.#publish();
    if (!config.enabled) return;

    const controller = new AbortController();
    const settled = this.#run(config, controller);
    this.#probes.set(config.id, { controller, settled });
    await settled;
  }

  async #run(config: McpServerConfig, controller: AbortController): Promise<void> {
    try {
      const [server] = await usableMcpServers([config]);
      if (!server || controller.signal.aborted) return;
      const result = await probeMcpServer(server, controller.signal);
      if (controller.signal.aborted || this.#watchers === 0) return;
      this.#statuses.set(config.id, {
        id: config.id,
        state: result.error ? "failed" : "connected",
        toolCount: result.toolCount,
        error: result.error,
      });
      this.#publish();
    } catch (error) {
      // A probe reports its own failures, so reaching here means the resolution step itself broke.
      // The server name and transport are safe to log; the command line with `env` applied is not.
      logger.warn("MCP probe failed", { name: config.name, transport: config.transport, error });
    } finally {
      if (this.#probes.get(config.id)?.controller === controller) this.#probes.delete(config.id);
    }
  }

  #publish(): void {
    this.options.emit([...this.#statuses.values()]);
  }
}

function seed(config: McpServerConfig): McpServerStatus {
  const state: McpConnectionState = config.enabled ? "connecting" : "disabled";
  return { id: config.id, state, toolCount: 0, error: null };
}
