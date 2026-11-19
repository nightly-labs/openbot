import {
  WORKFLOW_MEDIA_CATALOG_MAX,
  WORKFLOW_MEDIA_MODELS,
  type WorkflowCatalogProvider,
  type WorkflowMediaCatalog,
  type WorkflowMediaCatalogModel,
  type WorkflowMediaKind,
  type WorkflowMediaPrice,
  type WorkflowMediaPriceRequest,
  type WorkflowMediaSpecs,
  workflowCatalogMediaModel,
  workflowCatalogProvider,
  workflowFixedCatalogModel,
  workflowMediaSpecs,
} from "@openbot/contracts/ipc";
import { Deferred, Effect, Exit, Semaphore } from "effect";
import { type HiggsfieldPlan, higgsfieldFixedPlan } from "./higgsfield-catalog";
import { readHiggsfieldCatalog, readHiggsfieldPrice } from "./higgsfield-media";
import type { McpMediaFailed, McpMediaSignIn } from "./mcp-media";
import { type SunraPlan, sunraFixedPlan } from "./sunra-catalog";
import { readSunraCatalog, readSunraPrice } from "./sunra-media";

const CATALOG_TTL_MS = 10 * 60_000;
const FAILED_TTL_MS = 60_000;
const PRICE_TTL_MS = 10 * 60_000;
const PRICE_ENTRIES = 300;

interface Entry<P> {
  model: WorkflowMediaCatalogModel;
  plan: P;
}

interface Listed<P> {
  at: number;
  url: string;
  entries: ReadonlyMap<string, Entry<P>> | null;
}

function distinctNames<P>(entries: readonly Entry<P>[]): Entry<P>[] {
  const seen = new Map<string, number>();
  for (const entry of entries) seen.set(entry.model.name, (seen.get(entry.model.name) ?? 0) + 1);
  return entries.map((entry) =>
    (seen.get(entry.model.name) ?? 0) > 1
      ? {
          ...entry,
          model: { ...entry.model, name: `${entry.model.name} · ${entry.model.providerModel}`.slice(0, 160) },
        }
      : entry,
  );
}

function serviceList<P>(
  provider: WorkflowCatalogProvider,
  read: (signIn: McpMediaSignIn) => Effect.Effect<readonly Entry<P>[], McpMediaFailed>,
  options: WorkflowMediaCatalogCacheOptions,
) {
  let listed: Listed<P> | null = null;
  const lock = Semaphore.makeUnsafe(1);
  const now = () => options.now?.() ?? Date.now();
  const fresh = (url: string) => {
    if (!listed || listed.url !== url) return null;
    return now() - listed.at < (listed.entries ? CATALOG_TTL_MS : FAILED_TTL_MS) ? listed : null;
  };
  const remember = (url: string, entries: readonly Entry<P>[] | null): Listed<P> => {
    listed = {
      at: now(),
      url,
      entries:
        entries && entries.length > 0 ? new Map(distinctNames(entries).map((entry) => [entry.model.id, entry])) : null,
    };
    return listed;
  };
  const list = (): Effect.Effect<Listed<P> | null> =>
    Effect.suspend(() => {
      const signIn = options.signIn(provider);
      if (!signIn) {
        listed = null;
        return Effect.succeed(null);
      }
      const kept = fresh(signIn.url);
      if (kept) return Effect.succeed(kept);
      return lock.withPermit(
        Effect.suspend(() => {
          const again = fresh(signIn.url);
          if (again) return Effect.succeed(again);
          return read(signIn).pipe(
            Effect.map((entries) => remember(signIn.url, entries)),
            Effect.catch((failure) =>
              Effect.sync(() => {
                options.warn("Could not read the media models.", { service: provider, error: failure.message });
                return remember(signIn.url, null);
              }),
            ),
          );
        }),
      );
    });
  return { list };
}

export interface WorkflowMediaCatalogCacheOptions {
  signIn: (provider: WorkflowCatalogProvider) => McpMediaSignIn | null;
  warn: (message: string, details: { service: WorkflowCatalogProvider; error: string }) => void;
  now?: () => number;
}

const fixedModels = (provider: WorkflowCatalogProvider) =>
  WORKFLOW_MEDIA_MODELS.filter((model) => model.provider === provider).map((model) =>
    workflowFixedCatalogModel(model, provider),
  );

const serviceModels = (provider: WorkflowCatalogProvider, listed: Listed<unknown> | null) => {
  if (!listed) return [];
  return listed.entries ? [...listed.entries.values()].map((entry) => entry.model) : fixedModels(provider);
};

export class WorkflowMediaCatalogCache {
  readonly #options: WorkflowMediaCatalogCacheOptions;
  readonly #sunra: ReturnType<typeof serviceList<SunraPlan>>;
  readonly #higgsfield: ReturnType<typeof serviceList<HiggsfieldPlan>>;
  readonly #prices = new Map<string, { at: number; ttl: number; credits: number | null }>();
  readonly #quotes = new Map<string, Deferred.Deferred<number | null>>();

  constructor(options: WorkflowMediaCatalogCacheOptions) {
    this.#options = options;
    this.#sunra = serviceList("sunra", readSunraCatalog, options);
    this.#higgsfield = serviceList("higgsfield", readHiggsfieldCatalog, options);
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  #keepPrice(key: string, credits: number | null, ttl: number): void {
    if (this.#prices.size >= PRICE_ENTRIES) {
      const oldest = this.#prices.keys().next();
      if (!oldest.done) this.#prices.delete(oldest.value);
    }
    this.#prices.set(key, { at: this.#now(), ttl, credits });
  }

  #list(provider: WorkflowCatalogProvider): Effect.Effect<Listed<unknown> | null> {
    return provider === "sunra" ? this.#sunra.list() : this.#higgsfield.list();
  }

  readonly catalog = Effect.fn("WorkflowMediaCatalogCache.catalog")(function* (
    this: WorkflowMediaCatalogCache,
    only?: WorkflowCatalogProvider,
  ) {
    const read = (provider: WorkflowCatalogProvider) =>
      only === undefined || only === provider ? this.#list(provider) : Effect.succeed(null);
    const [sunra, higgsfield] = yield* Effect.all([read("sunra"), read("higgsfield")], { concurrency: "unbounded" });
    if (only === undefined && !sunra && !higgsfield) this.#prices.clear();
    const models = [...serviceModels("sunra", sunra), ...serviceModels("higgsfield", higgsfield)];
    return { models: models.slice(0, WORKFLOW_MEDIA_CATALOG_MAX) } satisfies WorkflowMediaCatalog;
  }).bind(this);

  readonly sunraPlan = Effect.fn("WorkflowMediaCatalogCache.sunraPlan")(function* (
    this: WorkflowMediaCatalogCache,
    id: string,
    kind: WorkflowMediaKind,
  ) {
    const listed = yield* this.#sunra.list();
    return listed?.entries?.get(id)?.plan ?? sunraFixedPlan(kind);
  }).bind(this);

  readonly higgsfieldPlan = Effect.fn("WorkflowMediaCatalogCache.higgsfieldPlan")(function* (
    this: WorkflowMediaCatalogCache,
    id: string,
    providerModel: string,
    kind: WorkflowMediaKind,
  ) {
    const listed = yield* this.#higgsfield.list();
    return listed?.entries?.get(id)?.plan ?? higgsfieldFixedPlan(providerModel, kind);
  }).bind(this);

  readonly price = Effect.fn("WorkflowMediaCatalogCache.price")(function* (
    this: WorkflowMediaCatalogCache,
    request: WorkflowMediaPriceRequest,
  ) {
    const none = { credits: null } satisfies WorkflowMediaPrice;
    const provider = workflowCatalogProvider(request.model);
    if (!provider) return none;
    const listed = yield* this.#list(provider);
    const model = serviceModels(provider, listed)
      .flatMap((entry) => workflowCatalogMediaModel(entry) ?? [])
      .find((entry) => entry.id === request.model && entry.kinds.includes(request.kind));
    if (!model) return none;
    const signIn = this.#options.signIn(provider);
    if (!signIn) return none;
    const specs: WorkflowMediaSpecs = workflowMediaSpecs(
      {
        media: request.kind,
        aspect: request.aspect,
        duration: request.duration,
        ...(request.resolution === null ? {} : { resolution: request.resolution }),
        background: request.transparent ? "transparent" : "solid",
        ...(request.options?.length
          ? { options: JSON.stringify(Object.fromEntries(request.options.map(({ name, value }) => [name, value]))) }
          : {}),
      },
      request.kind,
      model,
    );
    const providerModel = model.providerModel ?? model.id;
    const key = JSON.stringify([
      signIn.url,
      model.id,
      request.kind,
      specs.aspect,
      specs.duration,
      specs.resolution,
      specs.transparent,
      specs.options,
    ]);
    const kept = this.#prices.get(key);
    if (kept && this.#now() - kept.at < kept.ttl) return { credits: kept.credits } satisfies WorkflowMediaPrice;
    const ask = { kind: request.kind, model: providerModel, specs };
    const quote =
      provider === "sunra"
        ? readSunraPrice(signIn, { ...ask, plan: yield* this.sunraPlan(model.id, request.kind) })
        : readHiggsfieldPrice(signIn, {
            ...ask,
            plan: yield* this.higgsfieldPlan(model.id, providerModel, request.kind),
          });
    const pending = this.#quotes.get(key);
    if (pending) return { credits: yield* Deferred.await(pending) } satisfies WorkflowMediaPrice;
    const shared = Deferred.makeUnsafe<number | null>();
    this.#quotes.set(key, shared);
    const credits = yield* quote.pipe(
      Effect.tap((value) => Effect.sync(() => this.#keepPrice(key, value, PRICE_TTL_MS))),
      Effect.catch((failure) =>
        Effect.sync(() => {
          this.#options.warn("Could not read the media price.", { service: provider, error: failure.message });
          this.#keepPrice(key, null, FAILED_TTL_MS);
          return null;
        }),
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          this.#quotes.delete(key);
          Deferred.doneUnsafe(shared, Effect.succeed(Exit.isSuccess(exit) ? exit.value : null));
        }),
      ),
    );
    return { credits } satisfies WorkflowMediaPrice;
  }).bind(this);
}
