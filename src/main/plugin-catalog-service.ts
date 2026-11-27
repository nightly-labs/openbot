import { decodePluginCatalog, PLUGIN_CATALOG_PATH, type PluginCatalog } from "@openbot/contracts/plugin-catalog";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Schema } from "effect";
import { type CatalogPluginServer, catalogPluginServersOf } from "./analytics-plugin-catalog";

const logger = createOpenBotLogger("plugin-catalog");

const CATALOG_LIFETIME_MS = 30 * 60 * 1000;
const CATALOG_REQUEST_TIMEOUT_MS = 10_000;
const CATALOG_REFRESH_INTERVAL = "30 minutes";

class PluginCatalogLoadFailed extends Schema.TaggedError<PluginCatalogLoadFailed>()("PluginCatalogLoadFailed", {
  cause: Schema.Defect(),
}) {}

export interface PluginCatalogOptions {
  bundled: readonly CatalogPluginServer[];
  resolveApiUrl: (path: string) => string;
  request?: typeof fetch;
  now?: () => number;
}

export class PluginCatalogService {
  readonly #bundled: readonly CatalogPluginServer[];
  readonly #resolveApiUrl: (path: string) => string;
  readonly #request: typeof fetch;
  readonly #now: () => number;
  #catalog: PluginCatalog | null = null;
  #loadedAt = Number.NEGATIVE_INFINITY;
  #servers: readonly CatalogPluginServer[];

  constructor(options: PluginCatalogOptions) {
    this.#bundled = options.bundled;
    this.#resolveApiUrl = options.resolveApiUrl;
    this.#request = options.request ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#servers = options.bundled;
  }

  loaded(): boolean {
    return this.#catalog !== null;
  }

  servers(): readonly CatalogPluginServer[] {
    return this.#servers;
  }

  load(): Effect.Effect<PluginCatalog | null> {
    return Effect.gen({ self: this }, function* () {
      if (this.#catalog && this.#now() - this.#loadedAt < CATALOG_LIFETIME_MS) return this.#catalog;
      const catalog = yield* this.#fetch().pipe(
        Effect.tapError((error) =>
          Effect.sync(() => logger.warn("The plugin catalog did not load.", toLogValue(error.cause))),
        ),
        Effect.catch(() => Effect.succeed(null)),
      );
      if (catalog) this.#accept(catalog);
      return this.#catalog;
    });
  }

  refreshLoop(): Effect.Effect<never> {
    return Effect.forever(this.load().pipe(Effect.andThen(Effect.sleep(CATALOG_REFRESH_INTERVAL))));
  }

  #fetch(): Effect.Effect<PluginCatalog, PluginCatalogLoadFailed> {
    return Effect.gen({ self: this }, function* () {
      const url = this.#resolveApiUrl(PLUGIN_CATALOG_PATH);
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          this.#request(url, {
            headers: { accept: "application/json" },
            signal: AbortSignal.any([signal, AbortSignal.timeout(CATALOG_REQUEST_TIMEOUT_MS)]),
          }),
        catch: (cause) => new PluginCatalogLoadFailed({ cause }),
      });
      if (!response.ok)
        return yield* new PluginCatalogLoadFailed({ cause: new Error(`Plugin catalog HTTP ${response.status}.`) });
      const body = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) => new PluginCatalogLoadFailed({ cause }),
      });
      return yield* Effect.try({
        try: () => decodePluginCatalog(body),
        catch: (cause) => new PluginCatalogLoadFailed({ cause }),
      });
    });
  }

  #accept(catalog: PluginCatalog): void {
    const remote = catalogPluginServersOf(catalog.plugins);
    const listed = new Set(catalog.plugins.map((plugin) => plugin.slug));
    this.#catalog = catalog;
    this.#loadedAt = this.#now();
    this.#servers = [...remote, ...this.#bundled.filter((server) => !listed.has(server.slug))];
  }
}
