import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentModelListing,
  AgentModelListingEntry,
  AgentModelOption,
  AgentProviderRef,
  AgentSummary,
  ProviderModelVisibility,
  ProviderModelVisibilityChange,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Clock, Effect, Result, Semaphore } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { OPENCODE_CONFINED_ENV } from "../backend/process-confinement";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/** A provider that lists this many models or fewer shows all of them until an admin changes the list. */
const SHORT_LIST = 12;
/**
 * How many of the newest model families a long list shows until an admin changes the list. Each
 * service, such as `anthropic` or `openrouter`, gets an equal part and at least
 * `NEWEST_FAMILIES_PER_SERVICE`, so a service with hundreds of models does not push out the others.
 */
const NEWEST_FAMILIES = 12;
const NEWEST_FAMILIES_PER_SERVICE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A family older than this, against the newest family of its service, is a past generation. */
const FAMILY_AGE_LIMIT_MS = 120 * DAY_MS;
/** The picker labels a model New for this long after its release date. */
const NEW_MODEL_MS = 7 * DAY_MS;

interface ModelRelease {
  /** `YYYY-MM-DD`, so the text sorts as the date does. */
  date: string;
  /** The models.dev family, such as `claude-sonnet`. Empty when the catalog names none. */
  family: string;
  /**
   * False for a model that an agent cannot work with: a deprecated model, a model that does not
   * write text (image, audio and video models), or a model with no tool calls.
   */
  agentReady: boolean;
}

interface ReleaseLookup {
  /** The release of a catalog key, `<service>/<model>`. */
  release(key: string): ModelRelease | undefined;
  /** The release of a model name that services share, such as `gpt-6.1-sol` (see `modelName`). */
  releaseByName(name: string): ModelRelease | undefined;
  /** True when the catalog lists the service, such as `openai`. */
  knowsService(service: string): boolean;
}

interface Releases {
  models: Map<string, ModelRelease>;
  /** By `modelName`, over all services: the first release date, and agent-ready when one service has it so. */
  names: Map<string, ModelRelease>;
  services: Set<string>;
}

/**
 * The release dates of models.dev, read from the copy that OpenCode keeps in its cache. OpenCode
 * model ids are `<service>/<model>`, the keys of that file. A provider whose ids are not in it gets
 * no dates, and a long list with no dates shows all its models.
 *
 * Read again only when the file changes. A missing or bad file reads as no dates.
 */
export class ModelReleaseCatalog {
  readonly #paths: readonly string[];
  #loaded: { path: string; modified: number; releases: Releases } | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env, home = homedir()) {
    const cache = env.XDG_CACHE_HOME?.trim() || join(home, ".cache");
    // A confined OpenCode process keeps a cache of its own, which can be the newer copy.
    const confined = OPENCODE_CONFINED_ENV.XDG_CACHE_HOME;
    this.#paths = [
      join(cache, "opencode", "models.json"),
      ...(confined ? [join(confined, "opencode", "models.json")] : []),
    ];
  }

  readonly lookup = Effect.fn("ModelReleaseCatalog.lookup")(function* (this: ModelReleaseCatalog) {
    const files = yield* Effect.forEach(this.#paths, (path) =>
      Effect.tryPromise(() => stat(path)).pipe(
        Effect.map((info) => ({ path, modified: info.mtimeMs })),
        Effect.orElseSucceed(() => null),
      ),
    );
    const newest = files
      .filter((file): file is { path: string; modified: number } => file !== null)
      .sort((left, right) => right.modified - left.modified)[0];
    if (!newest) return releaseLookup(noReleases());
    const loaded = this.#loaded;
    if (loaded && loaded.path === newest.path && loaded.modified === newest.modified)
      return releaseLookup(loaded.releases);
    const releases = yield* Effect.tryPromise(() => readFile(newest.path, "utf8")).pipe(
      Effect.map((text) => parseReleases(JSON.parse(text))),
      Effect.orElseSucceed(noReleases),
    );
    this.#loaded = { ...newest, releases };
    return releaseLookup(releases);
  });
}

function noReleases(): Releases {
  return { models: new Map(), names: new Map(), services: new Set() };
}

/**
 * The last part of a model id, with a dot read as a dash: `nous:anthropic/claude-opus-5.5` and the
 * catalog key `anthropic/claude-opus-5-5` both give `claude-opus-5-5`.
 */
function modelName(id: string): string {
  return id
    .slice(id.lastIndexOf("/") + 1)
    .toLowerCase()
    .replaceAll(".", "-");
}

function parseReleases(value: unknown): Releases {
  const releases = noReleases();
  if (!isDynamicRecord(value)) return releases;
  for (const [service, entry] of Object.entries(value)) {
    if (!isDynamicRecord(entry) || !isDynamicRecord(entry.models)) continue;
    releases.services.add(service);
    for (const [model, details] of Object.entries(entry.models)) {
      if (!isDynamicRecord(details) || !isString(details.release_date)) continue;
      const release: ModelRelease = {
        date: details.release_date,
        family: isString(details.family) ? details.family : "",
        agentReady: details.status !== "deprecated" && details.tool_call !== false && writesText(details.modalities),
      };
      releases.models.set(`${service}/${model}`, release);
      const name = modelName(model);
      const known = releases.names.get(name);
      releases.names.set(
        name,
        known
          ? {
              date: known.date < release.date ? known.date : release.date,
              family: known.family || release.family,
              agentReady: known.agentReady || release.agentReady,
            }
          : release,
      );
    }
  }
  return releases;
}

/** A model with no modalities in the catalog counts as a text model. */
function writesText(modalities: unknown): boolean {
  if (!isDynamicRecord(modalities) || !Array.isArray(modalities.output)) return true;
  return modalities.output.includes("text");
}

function releaseLookup(releases: Releases): ReleaseLookup {
  return {
    release: (key) => releases.models.get(key),
    releaseByName: (name) => releases.names.get(name),
    knowsService: (service) => releases.services.has(service),
  };
}

interface CatalogMatch {
  /** The service part of the id, such as `openai`, `nous` or `openai-codex`. */
  service: string;
  /** The id without a reasoning variant. Each model with the same base shows or hides together. */
  base: string;
  release: ModelRelease | undefined;
}

/**
 * Finds a model in the catalog. OpenCode ids are catalog keys, `<service>/<model>`, and can add a
 * reasoning variant, `<service>/<model>/<effort>`. Kimi adds one as `<model>,thinking`. Hermes ids are `<service>:<model>`, where the model
 * can name its maker, as `nous:openai/gpt-6.1-sol` does. For a service that the catalog does not list,
 * the model name alone finds the release.
 */
function matchCatalog(modelId: string, lookup: ReleaseLookup): CatalogMatch {
  const comma = modelId.indexOf(",");
  const key = (comma > 0 ? modelId.slice(0, comma) : modelId).replace(":", "/");
  const slash = key.indexOf("/");
  const service = slash > 0 ? key.slice(0, slash) : "";
  if (!lookup.knowsService(service)) return { service, base: key, release: lookup.releaseByName(modelName(key)) };
  const exact = lookup.release(key);
  if (exact) return { service, base: key, release: exact };
  const variant = key.lastIndexOf("/");
  const base = variant > slash ? key.slice(0, variant) : key;
  return { service, base, release: lookup.release(base) };
}

/** Each model, less those that the list has a newer model of the same family and service for. */
function newestOfEachFamily(matches: readonly { id: string; match: CatalogMatch }[]): string[] {
  const newest = new Map<string, string>();
  for (const { match } of matches) {
    if (!match.release?.family) continue;
    const family = `${match.service}/${match.release.family}`;
    const date = newest.get(family);
    if (date === undefined || match.release.date > date) newest.set(family, match.release.date);
  }
  return matches
    .filter(
      ({ match }) =>
        !match.release?.family || newest.get(`${match.service}/${match.release.family}`) === match.release.date,
    )
    .map(({ id }) => id);
}

/**
 * The models that the picker shows before an admin changes the list. A short list hides only a model
 * that the list has a newer model of the same family for, such as Claude Opus 5 next to Opus 5.5;
 * a model that the catalog does not have shows. A longer list shows, for each service, the newest model of each of its newest families, when that family is from
 * the current generation of the service (see `FAMILY_AGE_LIMIT_MS`). Only models that an agent
 * can work with count. A model that the catalog does not have shows only when no model of its
 * service is in the catalog, as with a custom endpoint: the user added it. So a `-fast` or `-flex`
 * service tier that OpenCode adds to a known service does not show.
 */
function defaultShownModelIds(models: readonly { id: string }[], lookup: ReleaseLookup): string[] {
  const matches = models.map((model) => ({ id: model.id, match: matchCatalog(model.id, lookup) }));
  if (models.length <= SHORT_LIST) return newestOfEachFamily(matches);
  const catalogued = new Set(matches.filter(({ match }) => match.release).map(({ match }) => match.service));
  // The newest model of each family, for each service.
  const services = new Map<string, Map<string, { base: string; date: string }>>();
  for (const { match } of matches) {
    const release = match.release;
    if (!release?.agentReady) continue;
    const families = services.get(match.service) ?? new Map<string, { base: string; date: string }>();
    services.set(match.service, families);
    const family = release.family || match.base;
    const current = families.get(family);
    if (!current || release.date > current.date) families.set(family, { base: match.base, date: release.date });
  }
  const perService = Math.max(NEWEST_FAMILIES_PER_SERVICE, Math.floor(NEWEST_FAMILIES / Math.max(1, services.size)));
  const chosen = new Set(
    [...services.values()].flatMap((families) => {
      const newest = [...families.values()].sort((left, right) => right.date.localeCompare(left.date));
      const cutoff = Date.parse(newest[0]?.date ?? "") - FAMILY_AGE_LIMIT_MS;
      return newest
        .slice(0, perService)
        .filter((entry) => !(Date.parse(entry.date) < cutoff))
        .map((entry) => entry.base);
    }),
  );
  return matches
    .filter(({ match }) => (match.release ? chosen.has(match.base) : !catalogued.has(match.service)))
    .map(({ id }) => id);
}

type ModelKey = `${string}\u0000${string}`;

function modelKey(provider: string, model: string): ModelKey {
  return `${provider}\u0000${model}`;
}

/** Every model an agent is on, goes back to, moves to next, or keeps as a backup. */
function modelsInUse(agents: readonly AgentSummary[]): Set<ModelKey> {
  const keys = new Set<ModelKey>();
  for (const agent of agents) {
    keys.add(modelKey(agent.provider, agent.model));
    for (const choice of [agent.usageLimitReturn, agent.pendingRuntime, ...(agent.backupModels?.order ?? [])])
      if (choice) keys.add(modelKey(choice.provider, choice.model));
  }
  return keys;
}

/** How the picker shows each model of one provider. */
interface ProviderPicker {
  /** The models that the main list shows. The picker folds the others under Older models. */
  byDefault: ReadonlySet<string>;
  /** The models that an admin turned off. The picker leaves them out. */
  hidden: ReadonlySet<string>;
  /** The release date of each model that the catalog has, `YYYY-MM-DD`. */
  released: ReadonlyMap<string, string>;
}

export interface ModelVisibilityOptions {
  /** `openbot-model-visibility-v1.json` in the user data folder. */
  path: string;
  catalog: ModelReleaseCatalog;
  /** Every model the connected providers list. */
  listModels(): AgentModelOption[];
  listAgents(): AgentSummary[];
  /** Tells each client to read the model list again. */
  modelsChanged(): void;
}

/**
 * Which models the model picker of this server shows, for each provider. Only the list that clients
 * read changes: agents, tools, automations and the backup model switch still reach every model.
 *
 * The file keeps only the models that an admin turned off, and the picker leaves them out. Every
 * other model shows: in the main list when `defaultShownModelIds` gives it, otherwise under Older
 * models. So a new release shows after an admin edits the list too. A model that an agent uses stays
 * in the picker, out of the fold, so its picker can show it.
 *
 * A file that is missing or unreadable as JSON reads as no changes. Writes are chained for the reason
 * `update-preference-store.ts` chains its own.
 */
export class ModelVisibility {
  readonly #options: ModelVisibilityOptions;
  /** The models that an admin turned off, for each provider. */
  #hidden = new Map<string, ReadonlySet<string>>();
  #writes = Semaphore.makeUnsafe(1);

  constructor(options: ModelVisibilityOptions) {
    this.#options = options;
  }

  load(): Effect.Effect<void, PreferenceFileFailure> {
    return Effect.gen({ self: this }, function* () {
      const loaded = yield* Effect.result(readPreferenceFile(this.#options.path, decodeHidden));
      if (Result.isSuccess(loaded)) {
        if (loaded.success) this.#hidden = loaded.success;
      } else if (!isMissingFileError(loaded.failure.cause) && !(loaded.failure.cause instanceof SyntaxError))
        return yield* loaded.failure;
    });
  }

  settings(provider: AgentProviderRef): Effect.Effect<ProviderModelVisibility> {
    return this.#settings(provider);
  }

  set(change: ProviderModelVisibilityChange): Effect.Effect<ProviderModelVisibility, PreferenceFileFailure> {
    return this.#set(change);
  }

  /**
   * The models of `models` that the picker lists, in the same order: less those that an admin turned
   * off, and with `listing` set to `older` for those that the default hides and to `new` for a recent
   * release in the main list.
   */
  picker<Model extends { provider: string; id: string; listing?: AgentModelListing }>(
    models: readonly Model[],
  ): Effect.Effect<Model[]> {
    return this.#picker(models);
  }

  /** The `listing` of each model that the provider list has one for, for a client that reads the released model list. */
  listings(): Effect.Effect<AgentModelListingEntry[]> {
    return this.#picker(this.#options.listModels()).pipe(
      Effect.map((models) =>
        models.flatMap((model) =>
          model.listing ? [{ provider: model.provider, id: model.id, listing: model.listing }] : [],
        ),
      ),
    );
  }

  readonly #settings = Effect.fn("ModelVisibility.settings")(function* (
    this: ModelVisibility,
    provider: AgentProviderRef,
  ) {
    const models = this.#options.listModels().filter((model) => model.provider === provider);
    const hidden = this.#hidden.get(provider);
    const visibility: ProviderModelVisibility = {
      provider,
      models: models.map((model) => ({ id: model.id, name: model.name })),
      shown: models.filter((model) => !hidden?.has(model.id)).map((model) => model.id),
      changed: hidden !== undefined && hidden.size > 0,
    };
    return visibility;
  });

  readonly #set = Effect.fn("ModelVisibility.set")(function* (
    this: ModelVisibility,
    change: ProviderModelVisibilityChange,
  ) {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          const next = new Map(this.#hidden);
          const requested = change.shown;
          if (requested === null) next.delete(change.provider);
          else {
            const listed = new Set(
              this.#options
                .listModels()
                .filter((model) => model.provider === change.provider)
                .map((model) => model.id),
            );
            const on = new Set(requested);
            // A model that the provider does not list now, such as one of a signed-out service, keeps its choice.
            const hidden = new Set([...(this.#hidden.get(change.provider) ?? [])].filter((id) => !listed.has(id)));
            for (const id of listed) if (!on.has(id)) hidden.add(id);
            if (hidden.size > 0) next.set(change.provider, hidden);
            else next.delete(change.provider);
          }
          yield* writePreferenceFile(this.#options.path, encodeHidden(next));
          this.#hidden = next;
        }),
      ),
    );
    this.#options.modelsChanged();
    return yield* this.#settings(change.provider);
  });

  readonly #picker = Effect.fn("ModelVisibility.picker")(function* <
    Model extends { provider: string; id: string; listing?: AgentModelListing },
  >(this: ModelVisibility, models: readonly Model[]) {
    const providers = new Map<string, Model[]>();
    for (const model of models) {
      const listed = providers.get(model.provider);
      if (listed) listed.push(model);
      else providers.set(model.provider, [model]);
    }
    const lookup = yield* this.#options.catalog.lookup();
    const pickers = new Map<string, ProviderPicker>();
    for (const [provider, listed] of providers) pickers.set(provider, this.#providerPicker(provider, listed, lookup));
    const inUse = modelsInUse(this.#options.listAgents());
    const now = yield* Clock.currentTimeMillis;
    // The provider lists give no `listing` of their own.
    return models.flatMap((model): Model[] => {
      const picker = pickers.get(model.provider);
      if (!picker) return [model];
      const used = inUse.has(modelKey(model.provider, model.id));
      if (picker.hidden.has(model.id) && !used) return [];
      if (picker.byDefault.has(model.id)) {
        const released = Date.parse(picker.released.get(model.id) ?? "");
        return now - released < NEW_MODEL_MS ? [{ ...model, listing: "new" }] : [model];
      }
      return used ? [model] : [{ ...model, listing: "older" }];
    });
  });

  #providerPicker(provider: string, models: readonly { id: string }[], lookup: ReleaseLookup): ProviderPicker {
    const byDefault = new Set(defaultShownModelIds(models, lookup));
    const released = new Map<string, string>();
    for (const model of models) {
      const date = matchCatalog(model.id, lookup).release?.date;
      if (date) released.set(model.id, date);
    }
    return { byDefault, hidden: this.#hidden.get(provider) ?? new Set(), released };
  }
}

/**
 * `{ version: 1, providers: { <provider>: { hidden: [...] } } }`. A provider entry of another shape,
 * such as the full list that a development build of this file kept, reads as no change.
 */
function decodeHidden(parsed: unknown): Map<string, ReadonlySet<string>> | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.providers)) return null;
  const hidden = new Map<string, ReadonlySet<string>>();
  for (const [provider, entry] of Object.entries(parsed.providers)) {
    if (!isDynamicRecord(entry) || !Array.isArray(entry.hidden)) continue;
    const ids = entry.hidden.filter(isString);
    if (ids.length > 0) hidden.set(provider, new Set(ids));
  }
  return hidden;
}

function encodeHidden(hidden: ReadonlyMap<string, ReadonlySet<string>>) {
  return {
    version: 1,
    providers: Object.fromEntries([...hidden].map(([provider, ids]) => [provider, { hidden: [...ids] }])),
  };
}
