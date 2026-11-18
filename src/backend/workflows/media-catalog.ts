/**
 * The live model lists of Sunra and Higgsfield, kept for a short time, and the price quotes of a step.
 *
 * `WorkflowMediaCatalogCache` owns the lists that it read and the plan of each model: how the host
 * sends the pictures and the choices of a step to that model. A plan stays on the host. It never holds
 * a token: it asks `signIn` for the sign-in of a service at each read.
 */

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

/** How long a model list that a service gave is used, and how long after a failed read it is read again. */
const CATALOG_TTL_MS = 10 * 60_000;
const FAILED_TTL_MS = 60_000;
/** How long a price is used, and the most prices that are kept. */
const PRICE_TTL_MS = 10 * 60_000;
const PRICE_ENTRIES = 300;

interface Entry<P> {
  model: WorkflowMediaCatalogModel;
  plan: P;
}

interface Listed<P> {
  at: number;
  /** The url of the sign-in that read the list. Another sign-in reads the list again. */
  url: string;
  /** The entries by catalog id, or null when the read failed or gave no model. */
  entries: ReadonlyMap<string, Entry<P>> | null;
}

/**
 * Two models of one service with one name show their ids too, so the list has no two rows that look
 * the same. Higgsfield and Sunra both list some names more than once.
 */
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

/** The kept list of one service, read again when it is old, and read once for calls that wait together. */
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
  /** The list for the current sign-in, or null when the service has no sign-in. */
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
          // Another call read the list while this one waited.
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
  /** The sign-in of a service, or null when its row in Apps is not enabled and signed in. */
  signIn: (provider: WorkflowCatalogProvider) => McpMediaSignIn | null;
  /** Writes a warning without the sign-in. */
  warn: (message: string, details: { service: WorkflowCatalogProvider; error: string }) => void;
  now?: () => number;
}

const fixedModels = (provider: WorkflowCatalogProvider) =>
  WORKFLOW_MEDIA_MODELS.filter((model) => model.provider === provider).map((model) =>
    workflowFixedCatalogModel(model, provider),
  );

/** The models of one service: its live list, else its fixed models, or none with no sign-in. */
const serviceModels = (provider: WorkflowCatalogProvider, listed: Listed<unknown> | null) => {
  if (!listed) return [];
  return listed.entries ? [...listed.entries.values()].map((entry) => entry.model) : fixedModels(provider);
};

export class WorkflowMediaCatalogCache {
  readonly #options: WorkflowMediaCatalogCacheOptions;
  readonly #sunra: ReturnType<typeof serviceList<SunraPlan>>;
  readonly #higgsfield: ReturnType<typeof serviceList<HiggsfieldPlan>>;
  readonly #prices = new Map<string, { at: number; credits: number | null }>();
  /** The quotes that run now, by price key. */
  readonly #quotes = new Map<string, Deferred.Deferred<number | null>>();

  constructor(options: WorkflowMediaCatalogCacheOptions) {
    this.#options = options;
    this.#sunra = serviceList("sunra", readSunraCatalog, options);
    this.#higgsfield = serviceList("higgsfield", readHiggsfieldCatalog, options);
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  #keepPrice(key: string, credits: number | null): void {
    if (this.#prices.size >= PRICE_ENTRIES) {
      const oldest = this.#prices.keys().next();
      if (!oldest.done) this.#prices.delete(oldest.value);
    }
    this.#prices.set(key, { at: this.#now(), credits });
  }

  #list(provider: WorkflowCatalogProvider): Effect.Effect<Listed<unknown> | null> {
    return provider === "sunra" ? this.#sunra.list() : this.#higgsfield.list();
  }

  /**
   * The models of each signed-in service, or with `only`, of that service. A service that did not
   * answer gives its fixed models. It never fails.
   */
  readonly catalog = Effect.fn("WorkflowMediaCatalogCache.catalog")(function* (
    this: WorkflowMediaCatalogCache,
    only?: WorkflowCatalogProvider,
  ) {
    const read = (provider: WorkflowCatalogProvider) =>
      only === undefined || only === provider ? this.#list(provider) : Effect.succeed(null);
    const [sunra, higgsfield] = yield* Effect.all([read("sunra"), read("higgsfield")], { concurrency: "unbounded" });
    if (only === undefined && !sunra && !higgsfield) this.#prices.clear();
    // The wire and IPC answers take at most WORKFLOW_MEDIA_CATALOG_MAX models.
    const models = [...serviceModels("sunra", sunra), ...serviceModels("higgsfield", higgsfield)];
    return { models: models.slice(0, WORKFLOW_MEDIA_CATALOG_MAX) } satisfies WorkflowMediaCatalog;
  }).bind(this);

  /** The plan of a Sunra model: from the live list, else the plan of a fixed model. */
  readonly sunraPlan = Effect.fn("WorkflowMediaCatalogCache.sunraPlan")(function* (
    this: WorkflowMediaCatalogCache,
    id: string,
    kind: WorkflowMediaKind,
  ) {
    const listed = yield* this.#sunra.list();
    return listed?.entries?.get(id)?.plan ?? sunraFixedPlan(kind);
  }).bind(this);

  /** The plan of a Higgsfield model: from the live list, else the plan of a fixed model. */
  readonly higgsfieldPlan = Effect.fn("WorkflowMediaCatalogCache.higgsfieldPlan")(function* (
    this: WorkflowMediaCatalogCache,
    id: string,
    providerModel: string,
    kind: WorkflowMediaKind,
  ) {
    const listed = yield* this.#higgsfield.list();
    return listed?.entries?.get(id)?.plan ?? higgsfieldFixedPlan(providerModel, kind);
  }).bind(this);

  /**
   * What one file of a model costs with the choices of the request, as the service quotes it. A
   * failed quote, a model that is not known, and a service with no sign-in give null.
   */
  readonly price = Effect.fn("WorkflowMediaCatalogCache.price")(function* (
    this: WorkflowMediaCatalogCache,
    request: WorkflowMediaPriceRequest,
  ) {
    const none = { credits: null } satisfies WorkflowMediaPrice;
    // Only the list of the model's service: a slow service does not hold the price of the other one.
    const provider = workflowCatalogProvider(request.model);
    if (!provider) return none;
    const listed = yield* this.#list(provider);
    const model = serviceModels(provider, listed)
      .flatMap((entry) => workflowCatalogMediaModel(entry) ?? [])
      .find((entry) => entry.id === request.model && entry.kinds.includes(request.kind));
    if (!model) return none;
    const signIn = this.#options.signIn(provider);
    if (!signIn) return none;
    // The host reads the choices for the model again, as it does for a step.
    const specs: WorkflowMediaSpecs = workflowMediaSpecs(
      {
        media: request.kind,
        aspect: request.aspect,
        duration: request.duration,
        ...(request.resolution === null ? {} : { resolution: request.resolution }),
        background: request.transparent ? "transparent" : "solid",
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
    ]);
    const kept = this.#prices.get(key);
    if (kept && this.#now() - kept.at < PRICE_TTL_MS) return { credits: kept.credits } satisfies WorkflowMediaPrice;
    const ask = { kind: request.kind, model: providerModel, specs };
    const quote =
      provider === "sunra"
        ? readSunraPrice(signIn, { ...ask, plan: yield* this.sunraPlan(model.id, request.kind) })
        : readHiggsfieldPrice(signIn, {
            ...ask,
            plan: yield* this.higgsfieldPlan(model.id, providerModel, request.kind),
          });
    // Nodes with the same choices wait for one quote.
    const pending = this.#quotes.get(key);
    if (pending) return { credits: yield* Deferred.await(pending) } satisfies WorkflowMediaPrice;
    const shared = Deferred.makeUnsafe<number | null>();
    this.#quotes.set(key, shared);
    const credits = yield* quote.pipe(
      // A service that gives no price, such as Sunra for a Team, is kept as no price.
      Effect.tap((value) => Effect.sync(() => this.#keepPrice(key, value))),
      // A failed quote is not kept, so the next change of a choice asks again.
      Effect.catch((failure) =>
        Effect.sync(() => {
          this.#options.warn("Could not read the media price.", { service: provider, error: failure.message });
          return null;
        }),
      ),
      // The nodes that wait get the quote, or no price when this call stopped first.
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
