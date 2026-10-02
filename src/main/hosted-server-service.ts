import {
  type CreateHostedServerInput,
  type DeleteHostedServerInput,
  HOSTING_DEVELOPER_KEY_HEADER,
  type HostedServerCatalog,
  type HostedServerCheckout,
  type HostedServerList,
  type HostedServerSummary,
  parseHostedServerCatalog,
  parseHostedServerCheckout,
  parseHostedServerList,
  parseHostedServerSummary,
} from "@openbot/contracts/hosted-servers";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  createHostedServerStatusCheck,
  createHostedServerWake,
  type HostedServerAvailability,
  type HostedServerWakeResponse,
  WAKE_RECONNECT_STATES,
} from "@openbot/team-client/hosted-server-wake";

/** A running server that the joined list does not have yet makes the list refresh at most this often. */
const RUNNING_REFRESH_INTERVAL_MS = 15_000;

export interface HostedServerAuthClient {
  requestAuthorized<T>(path: string, init: RequestInit, decoder: (value: unknown) => T, timeoutMs?: number): Promise<T>;
}

/**
 * `bun run dev --hosting=test` sets the shared developer key from the encrypted `.env.shared`. This
 * removes it from `environment`, because agents and their tools inherit the environment of this
 * process. A packaged build never sends it.
 */
export function takeHostingDeveloperKey(environment: NodeJS.ProcessEnv, isPackaged: boolean): string | null {
  const key = environment.OPENBOT_HOSTING_DEVELOPER_KEY?.trim() || null;
  delete environment.OPENBOT_HOSTING_DEVELOPER_KEY;
  return isPackaged ? null : key;
}

/** Sends the developer key with each hosted server request, so the test Worker lets the account create servers. */
export function withHostingDeveloperKey(auth: HostedServerAuthClient, key: string | null): HostedServerAuthClient {
  if (!key) return auth;
  return {
    requestAuthorized(path, init, decoder, timeoutMs) {
      const headers = new Headers(init.headers);
      headers.set(HOSTING_DEVELOPER_KEY_HEADER, key);
      return auth.requestAuthorized(path, { ...init, headers }, decoder, timeoutMs);
    },
  };
}

/**
 * The account server's hosted servers, for the signed-in account. A new server waits for its first
 * payment. The renderer never gets or sends the payment URL: this service opens it only when it is an
 * https Stripe Checkout page.
 */
export class HostedServerDesktopService {
  readonly #lastRunningAt = new Map<string, number>();
  readonly #statusCheck: ReturnType<typeof createHostedServerStatusCheck>;

  /**
   * `onRunning` gets each running server from a list, so the caller can refresh the joined servers
   * when a new server is ready and does not wait for the next directory poll. `onWake` gets each server
   * that starts after a wake request, so the caller reconnects to it soon.
   */
  constructor(
    private readonly auth: HostedServerAuthClient,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly onRunning: (serverId: string) => void = () => {},
    private readonly onWake: (serverId: string) => void = () => {},
  ) {
    const wake = createHostedServerWake((serverId) => respond(() => this.#requestWake(serverId)), now);
    this.#statusCheck = createHostedServerStatusCheck(
      (serverId) =>
        respond(() =>
          this.auth.requestAuthorized(
            `/v2/hosting/servers/${encodeURIComponent(serverId)}/status`,
            { method: "GET" },
            (value) => value,
          ),
        ),
      wake,
      now,
    );
  }

  async list(): Promise<HostedServerList> {
    const list = await this.auth.requestAuthorized("/v2/hosting/servers/", { method: "GET" }, decodeList);
    for (const server of list.servers) {
      if (server.state !== "running") continue;
      const last = this.#lastRunningAt.get(server.serverId);
      if (last !== undefined && this.now() - last < RUNNING_REFRESH_INTERVAL_MS) continue;
      this.#lastRunningAt.set(server.serverId, this.now());
      this.onRunning(server.serverId);
    }
    return list;
  }

  plans(): Promise<HostedServerCatalog> {
    return this.auth.requestAuthorized("/v2/hosting/plans", { method: "GET" }, decodeCatalog);
  }

  async create(input: CreateHostedServerInput): Promise<HostedServerSummary> {
    const checkout = await this.auth.requestAuthorized(
      "/v2/hosting/servers/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": input.requestId },
        body: JSON.stringify({
          name: input.name,
          plan: input.plan,
          interval: input.interval,
          currency: input.currency,
        }),
      },
      decodeCheckout,
      30_000,
    );
    return this.#open(checkout);
  }

  /** Opens the payment page again for a server that waits for its first payment. */
  async openCheckout(serverId: string): Promise<HostedServerSummary> {
    const checkout = await this.auth.requestAuthorized(
      `/v2/hosting/servers/${encodeURIComponent(serverId)}/checkout`,
      { method: "POST" },
      decodeCheckout,
      30_000,
    );
    return this.#open(checkout);
  }

  async delete(input: DeleteHostedServerInput): Promise<void> {
    await this.auth.requestAuthorized(
      `/v2/hosting/servers/${encodeURIComponent(input.serverId)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: input.confirmName }),
      },
      () => undefined,
      30_000,
    );
  }

  /** The user starts the server. Async, so a missing session rejects and does not throw into a listener. */
  async wake(serverId: string): Promise<HostedServerSummary> {
    this.#statusCheck.forget(serverId);
    return await this.#requestWake(serverId);
  }

  /**
   * Signal answered that the host is not connected. A server that the account server stopped for no use
   * stays stopped until the user's next input. Another hosted server starts when `wake` is true. Any
   * other host is not a hosted server, and the account server answers 404.
   */
  unavailableHost(serverId: string, wake: boolean): Promise<HostedServerAvailability> {
    return this.#statusCheck.unavailable(serverId, { wake });
  }

  async #requestWake(serverId: string): Promise<HostedServerSummary> {
    const server = await this.auth.requestAuthorized(
      `/v2/hosting/servers/${encodeURIComponent(serverId)}/wake`,
      { method: "POST" },
      decodeSummary,
    );
    if (WAKE_RECONNECT_STATES.has(server.state)) this.onWake(serverId);
    return server;
  }

  /** A null URL means that the payment is done already, so there is no page to open. */
  async #open(checkout: HostedServerCheckout): Promise<HostedServerSummary> {
    if (checkout.checkoutUrl) await this.openExternal(checkout.checkoutUrl);
    return checkout.server;
  }
}

/** The account client throws an error with the status and the error code of the answer. The wake helper reads a response. */
async function respond(request: () => Promise<unknown>): Promise<HostedServerWakeResponse> {
  try {
    const value = await request();
    return { ok: true, status: 200, json: async () => value };
  } catch (error) {
    if (!isDynamicRecord(error) || typeof error.status !== "number") throw error;
    const body = { error: { code: typeof error.code === "string" ? error.code : null } };
    return { ok: false, status: error.status, json: async () => body };
  }
}

function decodeList(value: unknown): HostedServerList {
  const list = parseHostedServerList(value);
  if (!list) throw new Error(sourceText("error.auth.invalidHostedServer"));
  return list;
}

function decodeSummary(value: unknown): HostedServerSummary {
  const summary = parseHostedServerSummary(value);
  if (!summary) throw new Error(sourceText("error.auth.invalidHostedServer"));
  return summary;
}

function decodeCheckout(value: unknown): HostedServerCheckout {
  const checkout = parseHostedServerCheckout(value);
  if (!checkout) throw new Error(sourceText("error.auth.invalidHostedServer"));
  return checkout;
}

function decodeCatalog(value: unknown): HostedServerCatalog {
  const catalog = parseHostedServerCatalog(value);
  if (!catalog) throw new Error(sourceText("error.auth.invalidHostedServer"));
  return catalog;
}
