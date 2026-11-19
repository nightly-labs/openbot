import type {
  CheckCustomAgentInput,
  CustomAgentCheckResult,
  CustomAgentResult,
  CustomAgentSummary,
  CustomAgentUsage,
  SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import { isNewCustomAgentId } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Semaphore } from "effect";
import { checkAcpAgent } from "../backend/acp-agent-check";
import { assertAgentArgs, assertWindowsScriptArgs, resolveAgentCommand } from "../backend/acp-agent-command";
import { AgentLifecycleFailed, type AgentService } from "../backend/agent-service";
import { agentLaunchPath } from "../backend/cli";
import type { CustomAgentStore } from "./custom-agent-store";
import { ProviderRuntimeFailure, runtimeSync, toProviderRuntimeFailure } from "./provider-runtime-effects";

export interface CustomAgentChangeDependencies {
  service: Pick<AgentService, "saveCustomAgent" | "removeCustomAgent" | "reloadCustomAgents" | "customAgentUsage">;
  customAgents: Pick<CustomAgentStore, "list" | "save" | "remove" | "checkEnv" | "assertWritable">;
  resolve?: typeof resolveAgentCommand;
  check?: typeof checkAcpAgent;
}

export interface CustomAgentChanges {
  list(): Effect.Effect<CustomAgentSummary[]>;
  save(input: SaveCustomAgentInput): Effect.Effect<CustomAgentResult, ProviderRuntimeFailure>;
  saveIfUnchanged(
    input: SaveCustomAgentInput,
    expected: CustomAgentSummary | null,
  ): Effect.Effect<CustomAgentResult, ProviderRuntimeFailure>;
  remove(id: string): Effect.Effect<CustomAgentResult, ProviderRuntimeFailure>;
  check(input: CheckCustomAgentInput): Effect.Effect<CustomAgentCheckResult, ProviderRuntimeFailure>;
  usage(): Effect.Effect<CustomAgentUsage[]>;
}

export function createCustomAgentChanges({
  service,
  customAgents,
  resolve = resolveAgentCommand,
  check = checkAcpAgent,
}: CustomAgentChangeDependencies): CustomAgentChanges {
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
    usage: () => service.customAgentUsage(),
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
          const env = current
            ? [
                ...input.env.filter((entry) => !current.envNames.includes(entry.name)),
                ...current.envNames.map((name) => ({ name, value: null })),
              ]
            : input.env;
          return yield* save({
            ...input,
            name: current?.name ?? input.name,
            usagePrompt: current ? (current.usagePrompt ?? null) : input.usagePrompt,
            env,
          });
        }).pipe(Effect.uninterruptible),
      ),
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
        const path = yield* agentLaunchPath().pipe(toProviderRuntimeFailure);
        return yield* check({ executable, args: input.args, env, path, listModels: true }).pipe(
          toProviderRuntimeFailure,
        );
      })().pipe(Effect.uninterruptible),
  };
}
