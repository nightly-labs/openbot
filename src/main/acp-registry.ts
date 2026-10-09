import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AcpRegistryEntry,
  AcpRegistryInstallation,
  AcpRegistryInstallInput,
  AcpRegistryOperation,
  CustomAgentResult,
  CustomAgentSummary,
  SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import { isNewCustomAgentId } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Deferred, Effect, Schema, Semaphore } from "effect";
import { type RegistryAgent, readAcpRegistry } from "./acp-registry-catalog";
import { prepareRegistryAgent, type RegistryPrepared, registryDistributions } from "./acp-registry-install";
import type { CustomAgentChanges } from "./custom-agent-changes";
import { ProviderRuntimeFailure, runtimeIO } from "./provider-runtime-effects";

const Installed = Schema.Struct({
  registryId: Schema.String,
  customAgentId: Schema.String,
  version: Schema.String,
  distribution: Schema.Literals(["binary", "npx", "uvx"]),
  removed: Schema.optionalKey(Schema.Boolean),
  generation: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/u)),
  command: Schema.String,
});
type Installed = typeof Installed.Type;
const decodeInstalled = Schema.decodeUnknownEffect(Schema.Array(Installed));
interface Operation {
  controller: AbortController;
  done: Deferred.Deferred<void>;
  committing: boolean;
}
export interface AcpRegistryDependencies {
  directory: string;
  customAgentChanges: CustomAgentChanges;
  /** The host checks active work before removing executable files. */
  withRuntimeRemoval: (
    customAgentIds: readonly string[],
    operation: Effect.Effect<void, ProviderRuntimeFailure>,
  ) => Effect.Effect<void, ProviderRuntimeFailure>;
  catalog?: () => Effect.Effect<RegistryAgent[], ProviderRuntimeFailure>;
  prepare?: typeof prepareRegistryAgent;
}

/** Owns managed ACP installations only. Agent identity, credentials, and history belong elsewhere. */
export class AcpRegistry {
  readonly #root: string;
  readonly #removing = new Set<string>();
  readonly #gate = Semaphore.makeUnsafe(1);
  readonly #active = new Map<string, Operation>();
  readonly #status = new Map<string, AcpRegistryOperation>();
  readonly #catalog: () => Effect.Effect<RegistryAgent[], ProviderRuntimeFailure>;
  readonly #prepare: typeof prepareRegistryAgent;
  constructor(private readonly dependencies: AcpRegistryDependencies) {
    this.#root = join(dependencies.directory, "acp-registry");
    this.#catalog = dependencies.catalog ?? readAcpRegistry;
    this.#prepare = dependencies.prepare ?? prepareRegistryAgent;
  }

  readonly #records = Effect.fn("AcpRegistry.records")(function* (this: AcpRegistry) {
    const source = yield* runtimeIO(() => readFile(join(this.#root, "installed.json"), "utf8")).pipe(
      Effect.catch((error) => {
        const cause = error.cause;
        return cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? Effect.succeed(null)
          : Effect.fail(error);
      }),
    );
    if (source === null) return [];
    const raw = yield* runtimeIO(() => Promise.resolve(JSON.parse(source)));
    return yield* decodeInstalled(raw).pipe(
      Effect.mapError(
        () => new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryInvalid")) }),
      ),
    );
  });
  readonly #write = Effect.fn("AcpRegistry.writeRecords")(function* (this: AcpRegistry, records: readonly Installed[]) {
    yield* runtimeIO(() => mkdir(this.#root, { recursive: true, mode: 0o700 }));
    const temporary = join(this.#root, `installed-${randomUUID()}.tmp`);
    yield* runtimeIO(() => writeFile(temporary, JSON.stringify(records), { mode: 0o600 }));
    yield* runtimeIO(() => rename(temporary, join(this.#root, "installed.json"))).pipe(
      Effect.ensuring(runtimeIO(() => rm(temporary, { force: true })).pipe(Effect.orDie)),
    );
  });

  readonly listInstalled = Effect.fn("AcpRegistry.listInstalled")(function* (
    this: AcpRegistry,
  ): Effect.fn.Return<AcpRegistryInstallation[], ProviderRuntimeFailure> {
    const agents = yield* this.dependencies.customAgentChanges.list();
    const records = yield* this.#records();
    return records
      .filter(
        (record) =>
          !record.removed &&
          agents.some((agent) => agent.id === record.customAgentId && agent.command === record.command),
      )
      .map(({ registryId, customAgentId, version, distribution }) => ({
        registryId,
        customAgentId,
        version,
        distribution,
      }));
  });
  readonly search = Effect.fn("AcpRegistry.search")(function* (
    this: AcpRegistry,
    query = "",
  ): Effect.fn.Return<AcpRegistryEntry[], ProviderRuntimeFailure> {
    const installed = yield* this.listInstalled();
    const entries = yield* this.#catalog();
    const agents = yield* this.dependencies.customAgentChanges.list();
    const bindings = (yield* this.#records()).filter((record) =>
      agents.some((agent) => agent.id === record.customAgentId && agent.command === record.command),
    );
    const needle = query.trim().toLowerCase();
    return entries
      .filter((entry) => !needle || `${entry.name} ${entry.id} ${entry.description}`.toLowerCase().includes(needle))
      .map((entry) => {
        const local = installed.find((record) => record.registryId === entry.id);
        return {
          id: entry.id,
          name: entry.name,
          version: entry.version,
          description: entry.description,
          website: entry.website ?? null,
          license: entry.license ?? null,
          distributions: registryDistributions(entry),
          installedVersion: local?.version ?? null,
          customAgentId:
            local?.customAgentId ?? bindings.find((record) => record.registryId === entry.id)?.customAgentId ?? null,
        };
      });
  });
  status(): Effect.Effect<AcpRegistryOperation[]> {
    return Effect.sync(() => [...this.#status.values()]);
  }
  cancel(registryId: string): Effect.Effect<void> {
    return Effect.sync(() => {
      const operation = this.#active.get(registryId);
      if (operation && !operation.committing) operation.controller.abort();
    });
  }
  readonly close = Effect.fn("AcpRegistry.close")(function* (this: AcpRegistry) {
    const active = [...this.#active.values()];
    for (const operation of active) if (!operation.committing) operation.controller.abort();
    for (const operation of active) yield* Deferred.await(operation.done);
  });

  readonly install = Effect.fn("AcpRegistry.install")(function* (
    this: AcpRegistry,
    input: AcpRegistryInstallInput,
  ): Effect.fn.Return<CustomAgentResult, ProviderRuntimeFailure> {
    if (this.#active.has(input.registryId) || this.#removing.has(input.registryId))
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryBusy")) });
    const operation = { controller: new AbortController(), done: Deferred.makeUnsafe<void>(), committing: false };
    this.#active.set(input.registryId, operation);
    this.#status.set(input.registryId, { registryId: input.registryId, state: "installing", message: null });
    const cancelled = Effect.callback<never, ProviderRuntimeFailure>((resume) => {
      const abort = () =>
        resume(
          Effect.fail(new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryCancelled")) })),
        );
      operation.controller.signal.addEventListener("abort", abort, { once: true });
      if (operation.controller.signal.aborted) abort();
      return Effect.sync(() => operation.controller.signal.removeEventListener("abort", abort));
    });
    return yield* Effect.raceFirst(this.#install(input), cancelled).pipe(
      Effect.tap(() => Effect.sync(() => this.#status.delete(input.registryId))),
      Effect.tapError((error) =>
        Effect.sync(() => {
          if (operation.controller.signal.aborted) this.#status.delete(input.registryId);
          else
            this.#status.set(input.registryId, {
              registryId: input.registryId,
              state: "failed",
              message: redactText(
                error.cause instanceof Error ? error.cause.message : sourceText("error.provider.registryInstallFailed"),
              ),
            });
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.#active.delete(input.registryId);
          Deferred.doneUnsafe(operation.done, Effect.void);
        }),
      ),
    );
  });

  readonly #install = Effect.fn("AcpRegistry.installVersion")(function* (
    this: AcpRegistry,
    input: AcpRegistryInstallInput,
  ): Effect.fn.Return<CustomAgentResult, ProviderRuntimeFailure> {
    const catalog = yield* this.#catalog();
    const entry = catalog.find((agent) => agent.id === input.registryId);
    if (!entry)
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryMissing")) });
    const distribution = input.distribution ?? registryDistributions(entry)[0];
    if (!distribution || !registryDistributions(entry).includes(distribution))
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryMissing")) });
    const old =
      (yield* this.dependencies.customAgentChanges.list()).find((agent) => agent.id === input.customAgentId) ?? null;
    if (!old && !isNewCustomAgentId(input.customAgentId))
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.customAgentIdInvalid")) });
    const records = yield* this.#records();
    if (
      old &&
      !records.some(
        (record) => record.registryId === entry.id && record.customAgentId === old.id && record.command === old.command,
      )
    )
      return yield* new ProviderRuntimeFailure({
        cause: new Error(sourceText("error.provider.registryBindingChanged")),
      });
    const generation = randomUUID();
    const folder = join(this.#root, "versions", generation);
    yield* runtimeIO(() => mkdir(folder, { recursive: true, mode: 0o700 }));
    let activated = false;
    return yield* Effect.gen({ self: this }, function* () {
      const prepared = yield* this.#prepare(entry, distribution, folder).pipe(
        Effect.mapError((failure) => {
          let message =
            failure.cause instanceof Error ? failure.cause.message : sourceText("error.provider.registryInstallFailed");
          const env =
            distribution === "binary"
              ? entry.distribution.binary
              : distribution === "npx"
                ? { package: entry.distribution.npx }
                : { package: entry.distribution.uvx };
          for (const target of Object.values(env ?? {}))
            for (const secret of Object.values(target?.env ?? {}))
              if (typeof secret === "string" && secret.length >= 4) message = message.split(secret).join("•••");
          return new ProviderRuntimeFailure({ cause: new Error(redactText(message)) });
        }),
      );
      const inputToSave: SaveCustomAgentInput = {
        id: input.customAgentId,
        name: old?.name ?? input.name ?? entry.name,
        command: prepared.command,
        args: prepared.args,
        env: Object.entries(prepared.env).map(([name, value]) => ({ name, value })),
      };
      const record: Installed = {
        registryId: entry.id,
        customAgentId: input.customAgentId,
        version: entry.version,
        distribution,
        generation,
        command: prepared.command,
      };
      return yield* this.#gate.withPermit(
        Effect.gen({ self: this }, function* () {
          const operation = this.#active.get(input.registryId);
          if (operation?.controller.signal.aborted)
            return yield* new ProviderRuntimeFailure({
              cause: new Error(sourceText("error.provider.registryCancelled")),
            });
          if (operation) operation.committing = true;
          // Journal the candidate before switching the command. After a crash, only the record
          // whose command matches the saved custom agent is displayed as installed.
          yield* this.#write([...(yield* this.#records()), record]);
          const result = yield* this.dependencies.customAgentChanges
            .saveIfUnchanged(inputToSave, old)
            .pipe(Effect.tapError(() => this.#rollback(record, old, prepared)));
          activated = true;
          return result;
        }).pipe(Effect.uninterruptible),
      );
    }).pipe(
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          if (activated) return;
          // If rollback itself failed, keep a runtime that the saved command still names.
          const agents = yield* this.dependencies.customAgentChanges.list();
          if (agents.some((agent) => agent.command.startsWith(`${folder}/`) || agent.command.startsWith(`${folder}\\`)))
            return;
          yield* runtimeIO(() => rm(folder, { recursive: true, force: true })).pipe(Effect.orDie);
        }),
      ),
    );
  });

  readonly #rollback = Effect.fn("AcpRegistry.rollback")(function* (
    this: AcpRegistry,
    record: Installed,
    old: CustomAgentSummary | null,
    prepared: RegistryPrepared,
  ) {
    const current = (yield* this.dependencies.customAgentChanges.list()).find(
      (agent) => agent.id === record.customAgentId,
    );
    if (current?.command === prepared.command) {
      if (old)
        yield* this.dependencies.customAgentChanges.saveIfUnchanged(
          {
            id: old.id,
            name: old.name,
            command: old.command,
            args: old.args,
            env: old.envNames.map((name) => ({ name, value: null })),
          },
          current,
        );
      else yield* this.dependencies.customAgentChanges.remove(record.customAgentId);
    }
    yield* this.#write((yield* this.#records()).filter((candidate) => candidate.generation !== record.generation));
  });

  readonly uninstall = Effect.fn("AcpRegistry.uninstall")(function* (this: AcpRegistry, registryId: string) {
    if (this.#active.has(registryId))
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryRemoveBusy")) });
    return yield* this.#gate.withPermit(
      Effect.gen({ self: this }, function* () {
        if (this.#active.has(registryId))
          return yield* new ProviderRuntimeFailure({
            cause: new Error(sourceText("error.provider.registryRemoveBusy")),
          });
        this.#removing.add(registryId);
        const records = yield* this.#records();
        const removed = records.filter((record) => record.registryId === registryId);
        yield* this.dependencies.withRuntimeRemoval(
          removed.map((record) => record.customAgentId),
          Effect.gen({ self: this }, function* () {
            for (const record of removed)
              yield* runtimeIO(() =>
                rm(join(this.#root, "versions", record.generation), { recursive: true, force: true }),
              );
            yield* this.#write(
              records.map((record) => (record.registryId === registryId ? { ...record, removed: true } : record)),
            );
          }),
        );
      }).pipe(Effect.ensuring(Effect.sync(() => this.#removing.delete(registryId))), Effect.uninterruptible),
    );
  });
}

export function createAcpRegistry(dependencies: AcpRegistryDependencies): AcpRegistry {
  return new AcpRegistry(dependencies);
}
