import { Effect, Semaphore } from "effect";
import { ProviderRuntimeFailure, runtimeSync, toProviderRuntimeFailure } from "./provider-runtime-effects";
// The user's own ACP agents: list, save, remove and check. This computer only: no Team API route
// reaches these, because an agent is a command that runs here.
//
// This module owns the order of the writes, so the backend never has to know that a store exists:
// it is given a getter, and reads it again when an agent's process starts.

import type {
  CheckCustomAgentInput,
  CustomAgentCheckResult,
  CustomAgentResult,
  CustomAgentSummary,
  SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import { isNewCustomAgentId } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { checkAcpAgent } from "../backend/acp-agent-check";
import { assertAgentArgs, assertWindowsScriptArgs, resolveAgentCommand } from "../backend/acp-agent-command";
import { AgentLifecycleFailed, type AgentService } from "../backend/agent-service";
import type { CustomAgentStore } from "./custom-agent-store";

export interface CustomAgentChangeDependencies {
  service: Pick<AgentService, "saveCustomAgent" | "removeCustomAgent" | "reloadCustomAgents">;
  customAgents: Pick<CustomAgentStore, "list" | "save" | "remove" | "checkEnv" | "assertWritable">;
  resolve?: typeof resolveAgentCommand;
  check?: typeof checkAcpAgent;
}

export interface CustomAgentChanges {
  /** The agents without their environment values. */
  list(): Effect.Effect<CustomAgentSummary[]>;
  save(input: SaveCustomAgentInput): Effect.Effect<CustomAgentResult, ProviderRuntimeFailure>;
  /** Changes an installed command only if its previous binding is unchanged. Keeps current name and secrets. */
  saveIfUnchanged(
    input: SaveCustomAgentInput,
    expected: CustomAgentSummary | null,
  ): Effect.Effect<CustomAgentResult, ProviderRuntimeFailure>;
  remove(id: string): Effect.Effect<CustomAgentResult, ProviderRuntimeFailure>;
  /** One trial start. Writes nothing. */
  check(input: CheckCustomAgentInput): Effect.Effect<CustomAgentCheckResult, ProviderRuntimeFailure>;
}

export function createCustomAgentChanges({
  service,
  customAgents,
  resolve = resolveAgentCommand,
  check = checkAcpAgent,
}: CustomAgentChangeDependencies): CustomAgentChanges {
  // One change at a time, from the first read to the last write, as for the endpoints.
  const gate = Semaphore.makeUnsafe(1);
  function serialize<T>(run: () => Effect.Effect<T, ProviderRuntimeFailure>): Effect.Effect<T, ProviderRuntimeFailure> {
    return gate.withPermit(Effect.suspend(run));
  }

  const save = Effect.fn("CustomAgentChanges.save")(function* (input: SaveCustomAgentInput) {
    if (!isNewCustomAgentId(input.id) && !(yield* customAgents.list()).some((agent) => agent.id === input.id))
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.customAgentIdInvalid")) });
    yield* runtimeSync(() => assertAgentArgs(input.args));
    yield* service
      .saveCustomAgent(() =>
        customAgents
          .save(input)
          .pipe(
            Effect.mapError((error) => new AgentLifecycleFailed({ operation: "saveCustomAgent", cause: error.cause })),
          ),
      )
      .pipe(toProviderRuntimeFailure);
    return {
      agents: yield* customAgents.list(),
      restart: yield* service.reloadCustomAgents().pipe(toProviderRuntimeFailure),
    };
  });

  return {
    list: () => customAgents.list(),
    /**
     * Persist first, then restart the router. The command is not resolved here: an agent installed
     * later still saves, and its row shows that the command is not found.
     */
    save: (input) => serialize(() => save(input).pipe(Effect.uninterruptible)),
    saveIfUnchanged: (input, expected) =>
      serialize(() =>
        Effect.gen(function* () {
          const current = (yield* customAgents.list()).find((agent) => agent.id === input.id) ?? null;
          if (
            (current === null) !== (expected === null) ||
            (current &&
              expected &&
              (current.command !== expected.command || JSON.stringify(current.args) !== JSON.stringify(expected.args)))
          ) {
            return yield* new ProviderRuntimeFailure({
              cause: new Error(sourceText("error.provider.registryBindingChanged")),
            });
          }
          // A user can change credentials while the download runs. Keep their current values and
          // name; only new registry environment names receive the registry defaults.
          const env = current
            ? [
                ...input.env.filter((entry) => !current.envNames.includes(entry.name)),
                ...current.envNames.map((name) => ({ name, value: null })),
              ]
            : input.env;
          return yield* save({ ...input, name: current?.name ?? input.name, env });
        }).pipe(Effect.uninterruptible),
      ),
    /** The agents on it move to another provider before the write, in the backend's chain. */
    remove: (id) =>
      serialize(() =>
        Effect.fn("CustomAgentChanges.remove")(function* () {
          yield* runtimeSync(() => customAgents.assertWritable());
          if (!(yield* customAgents.list()).some((agent) => agent.id === id)) {
            return yield* new ProviderRuntimeFailure({
              cause: new Error(sourceText("error.provider.customAgentNotSaved")),
            });
          }
          yield* service
            .removeCustomAgent(id, () =>
              customAgents
                .remove(id)
                .pipe(
                  Effect.mapError(
                    (error) => new AgentLifecycleFailed({ operation: "removeCustomAgent", cause: error.cause }),
                  ),
                ),
            )
            .pipe(toProviderRuntimeFailure);
          return {
            agents: yield* customAgents.list(),
            restart: yield* service.reloadCustomAgents().pipe(toProviderRuntimeFailure),
          };
        })().pipe(Effect.uninterruptible),
      ),
    check: (input) =>
      Effect.fn("CustomAgentChanges.check")(function* () {
        yield* runtimeSync(() => assertAgentArgs(input.args));
        const env = yield* runtimeSync(() => customAgents.checkEnv(input.env, input.savedAgentId));
        const executable = yield* resolve(input.command).pipe(toProviderRuntimeFailure);
        if (!executable)
          return yield* new ProviderRuntimeFailure({
            cause: new Error(sourceText("error.provider.customAgentNotFound", { command: input.command })),
          });
        yield* runtimeSync(() => assertWindowsScriptArgs(executable, input.args));
        return yield* check({ executable, args: input.args, env }).pipe(toProviderRuntimeFailure);
      })().pipe(Effect.uninterruptible),
  };
}
