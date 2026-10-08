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
import { Effect, type Layer } from "effect";
import {
  type AccountRequestClient,
  type AccountServiceFailure,
  AccountServicePlatform,
} from "./account-service-platform";

/** A running server that the joined list does not have yet makes the list refresh at most this often. */
const RUNNING_REFRESH_INTERVAL_MS = 15_000;

export type HostedServerAuthClient = AccountRequestClient;

/**
 * `bun run dev --hosting=test` sets the shared developer key from the encrypted `.env.dev`. This
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
  readonly #platform: Layer.Layer<AccountServicePlatform>;
  readonly #lastRunningAt = new Map<string, number>();
  readonly #statusCheck: {
    unavailable(serverId: string, options: { wake: boolean }): Effect.Effect<HostedServerAvailability>;
    forget(serverId: string): void;
  };

  /**
   * `onRunning` gets each running server from a list, so the caller can refresh the joined servers
   * when a new server is ready and does not wait for the next directory poll. `onWake` gets each server
   * that starts after a wake request, so the caller reconnects to it soon.
   */
  constructor(
    auth: HostedServerAuthClient,
    openExternal: (url: string) => Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly onRunning: (serverId: string) => void = () => {},
    private readonly onWake: (serverId: string) => void = () => {},
  ) {
    this.#platform = AccountServicePlatform.layer(auth, openExternal);
    const wake = createHostedServerWake(
      (serverId) => respond(this.#requestWakeEffect(serverId).pipe(Effect.provide(this.#platform))),
      now,
    );
    this.#statusCheck = createHostedServerStatusCheck(
      (serverId) =>
        respond(
          auth.requestAuthorized(
            `/v2/hosting/servers/${encodeURIComponent(serverId)}/status`,
            { method: "GET" },
            (value) => value,
          ),
        ),
      wake,
      now,
    );
  }

  list(): Effect.Effect<HostedServerList, AccountServiceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      HostedServerList,
      AccountServiceFailure,
      AccountServicePlatform
    > {
      const platform = yield* AccountServicePlatform;
      const list = yield* platform.request("/v2/hosting/servers/", { method: "GET" }, decodeList);
      for (const server of list.servers) {
        if (server.state !== "running") continue;
        const last = this.#lastRunningAt.get(server.serverId);
        if (last !== undefined && this.now() - last < RUNNING_REFRESH_INTERVAL_MS) continue;
        this.#lastRunningAt.set(server.serverId, this.now());
        this.onRunning(server.serverId);
      }
      return list;
    }).pipe(Effect.provide(this.#platform));
  }

  plans(): Effect.Effect<HostedServerCatalog, AccountServiceFailure> {
    return AccountServicePlatform.use((platform) =>
      platform.request("/v2/hosting/plans", { method: "GET" }, decodeCatalog),
    ).pipe(Effect.provide(this.#platform));
  }

  create(input: CreateHostedServerInput): Effect.Effect<HostedServerSummary, AccountServiceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      HostedServerSummary,
      AccountServiceFailure,
      AccountServicePlatform
    > {
      const platform = yield* AccountServicePlatform;
      const checkout = yield* platform.request(
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
      return yield* this.#open(checkout);
    }).pipe(Effect.provide(this.#platform));
  }

  /** Opens the payment page again for a server that waits for its first payment. */

  openCheckout(serverId: string): Effect.Effect<HostedServerSummary, AccountServiceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      HostedServerSummary,
      AccountServiceFailure,
      AccountServicePlatform
    > {
      const platform = yield* AccountServicePlatform;
      const checkout = yield* platform.request(
        `/v2/hosting/servers/${encodeURIComponent(serverId)}/checkout`,
        { method: "POST" },
        decodeCheckout,
        30_000,
      );
      return yield* this.#open(checkout);
    }).pipe(Effect.provide(this.#platform));
  }

  delete(input: DeleteHostedServerInput): Effect.Effect<void, AccountServiceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      void,
      AccountServiceFailure,
      AccountServicePlatform
    > {
      const platform = yield* AccountServicePlatform;
      yield* platform.request(
        `/v2/hosting/servers/${encodeURIComponent(input.serverId)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmName: input.confirmName }),
        },
        () => undefined,
        30_000,
      );
    }).pipe(Effect.provide(this.#platform));
  }

  /** The user starts the server. */

  readonly wake = Effect.fn("HostedServer.wake")(
    function* (this: HostedServerDesktopService, serverId: string) {
      this.#statusCheck.forget(serverId);
      return yield* this.#requestWakeEffect(serverId);
    },
    (operation) => operation.pipe(Effect.provide(this.#platform)),
  ).bind(this);

  unavailableHost(serverId: string, wake: boolean): Effect.Effect<HostedServerAvailability> {
    return this.#statusCheck.unavailable(serverId, { wake });
  }

  readonly #requestWakeEffect = Effect.fn("HostedServer.requestWake")(function* (
    this: HostedServerDesktopService,
    serverId: string,
  ) {
    const platform = yield* AccountServicePlatform;
    const server = yield* platform.request(
      `/v2/hosting/servers/${encodeURIComponent(serverId)}/wake`,
      { method: "POST" },
      decodeSummary,
    );
    if (WAKE_RECONNECT_STATES.has(server.state)) this.onWake(serverId);
    return server;
  });

  /** A null URL means that the payment is done already, so there is no page to open. */
  #open(
    checkout: HostedServerCheckout,
  ): Effect.Effect<HostedServerSummary, AccountServiceFailure, AccountServicePlatform> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<
      HostedServerSummary,
      AccountServiceFailure,
      AccountServicePlatform
    > {
      const platform = yield* AccountServicePlatform;
      if (checkout.checkoutUrl) yield* platform.openPage(checkout.checkoutUrl);
      return checkout.server;
    });
  }
}

/** The account client throws an error with the status and the error code of the answer. The wake helper reads a response. */
function respond<E extends { cause: unknown }>(
  request: Effect.Effect<unknown, E>,
): Effect.Effect<HostedServerWakeResponse, E> {
  return request.pipe(
    Effect.map((value) => ({ ok: true, status: 200, json: async () => value })),
    Effect.catch((failure) => {
      const error = failure.cause;
      if (!isDynamicRecord(error) || typeof error.status !== "number") return Effect.fail(failure);
      const body = { error: { code: typeof error.code === "string" ? error.code : null } };
      return Effect.succeed({ ok: false, status: error.status, json: async () => body });
    }),
  );
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
