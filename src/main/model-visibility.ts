import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentModelListing,
  AgentModelListingEntry,
  AgentModelOption,
  AgentProviderRef,
  AgentSummary,
  CustomProviderSummary,
  ProviderModelVisibility,
  ProviderModelVisibilityChange,
} from "@openbot/contracts/ipc";
import {
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  isCustomProviderContextWindow,
  isCustomProviderMaxOutput,
  OPENCODE_RECOMMENDED_FREE_MODELS,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Clock, Effect, Result, Semaphore } from "effect";
import { savedCustomModelId } from "../backend/encoded-model-id";
import { isMissingFileError } from "../backend/file-errors";
import { OPENCODE_CONFINED_ENV } from "../backend/process-confinement";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

const SHORT_LIST = 12;
const NEWEST_FAMILIES = 12;
const NEWEST_FAMILIES_PER_SERVICE = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const FAMILY_AGE_LIMIT_MS = 120 * DAY_MS;
const NEW_MODEL_MS = 7 * DAY_MS;

interface ModelRelease {
  date: string;
  family: string;
  agentReady: boolean;
}

interface ModelLimits {
  contextWindow: number;
  maxOutput?: number;
}

interface ReleaseLookup {
  release(key: string): ModelRelease | undefined;
  releaseByName(name: string): ModelRelease | undefined;
  knowsService(service: string): boolean;
  limits(modelId: string): ModelLimits | undefined;
}

interface Releases {
  models: Map<string, ModelRelease>;
  names: Map<string, ModelRelease>;
  services: Set<string>;
  limits: Map<string, ModelLimits>;
  nameLimits: Map<string, ModelLimits[]>;
}

export class ModelReleaseCatalog {
  readonly #paths: readonly string[];
  #loaded: { path: string; modified: number; releases: Releases } | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env, home = homedir()) {
    const cache = env.XDG_CACHE_HOME?.trim() || join(home, ".cache");
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
    const releases = yield* Effect.tryPromise(async () =>
      parseReleases(JSON.parse(await readFile(newest.path, "utf8"))),
    ).pipe(Effect.orElseSucceed(noReleases));
    this.#loaded = { ...newest, releases };
    return releaseLookup(releases);
  });
}

function noReleases(): Releases {
  return { models: new Map(), names: new Map(), services: new Set(), limits: new Map(), nameLimits: new Map() };
}

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
      if (!isDynamicRecord(details)) continue;
      const limits = listedLimits(details.limit);
      if (limits) {
        releases.limits.set(`${service}/${model}`.toLowerCase(), limits);
        const name = modelName(model);
        releases.nameLimits.set(name, [...(releases.nameLimits.get(name) ?? []), limits]);
      }
      if (!isString(details.release_date)) continue;
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

function writesText(modalities: unknown): boolean {
  if (!isDynamicRecord(modalities) || !Array.isArray(modalities.output)) return true;
  return modalities.output.includes("text");
}

function listedLimits(limit: unknown): ModelLimits | undefined {
  if (!isDynamicRecord(limit) || !isCustomProviderContextWindow(limit.context)) return undefined;
  const contextWindow = limit.context;
  return isCustomProviderMaxOutput(limit.output) && limit.output < contextWindow
    ? { contextWindow, maxOutput: limit.output }
    : { contextWindow };
}

function mostCommon(values: readonly number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || left - right)[0]?.[0];
}

function catalogLimits(modelId: string, releases: Releases): ModelLimits | undefined {
  const parts = modelId.toLowerCase().split("/");
  const exact = parts.length > 1 ? releases.limits.get(parts.slice(-2).join("/")) : undefined;
  if (exact) return exact;
  const listed = releases.nameLimits.get(modelName(modelId));
  if (!listed) return undefined;
  const contextWindow = mostCommon(listed.map((limits) => limits.contextWindow));
  if (contextWindow === undefined) return undefined;
  const maxOutput = mostCommon(
    listed.flatMap((limits) =>
      limits.contextWindow === contextWindow && limits.maxOutput !== undefined ? [limits.maxOutput] : [],
    ),
  );
  return maxOutput === undefined ? { contextWindow } : { contextWindow, maxOutput };
}

function releaseLookup(releases: Releases): ReleaseLookup {
  return {
    limits: (modelId) => catalogLimits(modelId, releases),
    release: (key) => releases.models.get(key),
    releaseByName: (name) => releases.names.get(name),
    knowsService: (service) => releases.services.has(service),
  };
}

interface CatalogMatch {
  service: string;
  base: string;
  release: ModelRelease | undefined;
}

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

type ModelMatch = { id: string; match: CatalogMatch };

function versionedName(match: CatalogMatch): { shape: string; version: number[] } | null {
  const name = modelName(match.base).replace(/-\d{8}(?=-|$)/gu, "");
  const version = /(?<=^|-)\d{1,3}(?:-\d{1,3})*(?=-|$)/u.exec(name);
  if (!version) return null;
  return {
    shape: `${match.service}/${name.slice(0, version.index)}#${name.slice(version.index + version[0].length)}`,
    version: version[0].split("-").map(Number),
  };
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function withNewerVersions(matches: readonly ModelMatch[]): ModelMatch[] {
  const named = matches.map((entry) => ({ entry, name: versionedName(entry.match) }));
  const shapes = new Map<string, { version: number[]; release: ModelRelease | undefined }[]>();
  const families = new Map<string, ModelRelease[]>();
  for (const { entry, name } of named) {
    const { release, service } = entry.match;
    if (release?.family) {
      const key = `${service}/${release.family}`;
      families.set(key, [...(families.get(key) ?? []), release]);
    }
    if (name) shapes.set(name.shape, [...(shapes.get(name.shape) ?? []), { version: name.version, release }]);
  }
  return named.map(({ entry, name }) => {
    if (entry.match.release || !name) return entry;
    const siblings = shapes.get(name.shape) ?? [];
    let previous: { version: number[]; release: ModelRelease } | undefined;
    for (const { version, release } of siblings) {
      if (!release) continue;
      if (compareVersions(name.version, version) <= 0) return entry;
      if (!previous || compareVersions(version, previous.version) > 0) previous = { version, release };
    }
    if (!previous) return entry;
    const family = previous.release.family
      ? (families.get(`${entry.match.service}/${previous.release.family}`) ?? [previous.release])
      : [previous.release];
    const newest = siblings.every(({ version, release }) => release || compareVersions(name.version, version) >= 0);
    const latest = Date.parse(family.reduce((left, right) => (right.date > left.date ? right : left)).date);
    if (Number.isNaN(latest)) return entry;
    const date = newest ? new Date(latest + DAY_MS).toISOString().slice(0, 10) : previous.release.date;
    const release = {
      family: previous.release.family,
      agentReady: family.some((member) => member.agentReady),
      date,
    };
    return { ...entry, match: { ...entry.match, release } };
  });
}

function newestOfEachFamily(matches: readonly ModelMatch[]): string[] {
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

function defaultShownModelIds(models: readonly { id: string }[], lookup: ReleaseLookup): string[] {
  const matches = withNewerVersions(models.map((model) => ({ id: model.id, match: matchCatalog(model.id, lookup) })));
  if (models.length <= SHORT_LIST) return newestOfEachFamily(matches);
  const catalogued = new Set(matches.filter(({ match }) => match.release).map(({ match }) => match.service));
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

const RECOMMENDED_MODELS: ReadonlyMap<string, readonly string[]> = new Map([
  ["opencode", OPENCODE_RECOMMENDED_FREE_MODELS],
]);

type ModelKey = `${string}\u0000${string}`;

function modelKey(provider: string, model: string): ModelKey {
  return `${provider}\u0000${model}`;
}

function savedEndpointModels(endpoints: readonly CustomProviderSummary[]): Set<ModelKey> {
  return new Set(
    endpoints.flatMap((endpoint) =>
      endpoint.models.map((model) => {
        const harness = endpoint.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS;
        return modelKey(harness, savedCustomModelId(endpoint.id, harness, model.id));
      }),
    ),
  );
}

function modelsInUse(agents: readonly AgentSummary[]): Set<ModelKey> {
  const keys = new Set<ModelKey>();
  for (const agent of agents) {
    keys.add(modelKey(agent.provider, agent.model));
    for (const choice of [agent.usageLimitReturn, agent.pendingRuntime, ...(agent.backupModels?.order ?? [])])
      if (choice) keys.add(modelKey(choice.provider, choice.model));
  }
  return keys;
}

interface ProviderPicker {
  byDefault: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  released: ReadonlyMap<string, string>;
}

export interface ModelVisibilityOptions {
  path: string;
  catalog: ModelReleaseCatalog;
  listModels(): AgentModelOption[];
  listAgents(): AgentSummary[];
  customEndpoints(): readonly CustomProviderSummary[];
  modelsChanged(): void;
}

export class ModelVisibility {
  readonly #options: ModelVisibilityOptions;
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

  hiddenModels(): { provider: string; hidden: string[] }[] {
    return [...this.#hidden].map(([provider, ids]) => ({ provider, hidden: [...ids] }));
  }

  replaceHidden(
    models: readonly { provider: string; hidden: readonly string[] }[],
  ): Effect.Effect<void, PreferenceFileFailure> {
    return this.#replaceHidden(models);
  }

  readonly #replaceHidden = Effect.fn("ModelVisibility.replaceHidden")(function* (
    this: ModelVisibility,
    models: readonly { provider: string; hidden: readonly string[] }[],
  ) {
    const next = new Map<string, ReadonlySet<string>>();
    for (const entry of models) if (entry.hidden.length > 0) next.set(entry.provider, new Set(entry.hidden));
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        writePreferenceFile(this.#options.path, encodeHidden(next)).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              this.#hidden = next;
            }),
          ),
        ),
      ),
    );
    this.#options.modelsChanged();
  });

  picker<Model extends { provider: string; id: string; listing?: AgentModelListing }>(
    models: readonly Model[],
  ): Effect.Effect<Model[]> {
    return this.#picker(models);
  }

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
    const saved = savedEndpointModels(this.#options.customEndpoints());
    for (const [provider, listed] of providers)
      pickers.set(provider, this.#providerPicker(provider, listed, lookup, saved));
    const inUse = modelsInUse(this.#options.listAgents());
    const now = yield* Clock.currentTimeMillis;
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

  #providerPicker(
    provider: string,
    models: readonly { id: string }[],
    lookup: ReleaseLookup,
    saved: ReadonlySet<ModelKey>,
  ): ProviderPicker {
    const byDefault = new Set(defaultShownModelIds(models, lookup));
    const recommended = RECOMMENDED_MODELS.get(provider) ?? [];
    for (const model of models) {
      if (recommended.includes(model.id.toLowerCase()) || saved.has(modelKey(provider, model.id)))
        byDefault.add(model.id);
    }
    const released = new Map<string, string>();
    for (const model of models) {
      const date = matchCatalog(model.id, lookup).release?.date;
      if (date) released.set(model.id, date);
    }
    return { byDefault, hidden: this.#hidden.get(provider) ?? new Set(), released };
  }
}

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
