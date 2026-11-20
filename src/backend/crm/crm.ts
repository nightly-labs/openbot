import { DEFAULT_CRM_SETTINGS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Exit, Layer, ManagedRuntime } from "effect";
import type { OpenBotDatabase } from "../openbot-database";
import { type CrmAgentOperations, CrmAgentView } from "./crm-agent-view";
import { CrmError, type CrmPeopleOperations, type CrmSettingsStore } from "./crm-handle";
import { type CrmSourceDependencies, makeCrmSources } from "./crm-source";
import { CrmStore } from "./crm-store";

export interface CrmDependencies {
  database: OpenBotDatabase;
  changed: () => void;
  now?: () => Date;
  sources?: CrmSourceDependencies;
  settings?: CrmSettingsStore;
}

type CrmShape = CrmPeopleOperations & CrmAgentOperations;

export type CrmHandle = CrmShape & { close(): Effect.Effect<void> };

function attempt<A>(work: () => A): Effect.Effect<A, CrmError> {
  return Effect.try({ try: work, catch: (cause) => cause }).pipe(
    Effect.catch((cause) => (cause instanceof CrmError ? Effect.fail(cause) : Effect.die(cause))),
  );
}

const NO_SETTINGS: CrmSettingsStore = {
  get: () => DEFAULT_CRM_SETTINGS,
  set: () => Effect.fail(new CrmError({ code: "refused", message: sourceText("error.crm.invalidChange") })),
};

const NO_KEYS: CrmSourceDependencies["keys"] = {
  get: () => null,
  set: () => Effect.fail(new CrmError({ code: "refused", message: sourceText("error.crm.invalidChange") })),
};

class Crm extends Context.Service<Crm, CrmShape>()("openbot/backend/Crm") {
  static layer(dependencies: CrmDependencies) {
    return Layer.effect(
      Crm,
      Effect.gen(function* () {
        const now = () => (dependencies.now ?? (() => new Date()))();
        const store = new CrmStore({ database: dependencies.database, now });
        const settings = dependencies.settings ?? NO_SETTINGS;
        const sources = yield* makeCrmSources({
          store,
          dependencies: dependencies.sources ?? { adapters: [], keys: NO_KEYS },
          changed: dependencies.changed,
          now,
          enabled: () => settings.get().enabled,
        });
        const agentAttempt = <A>(work: () => A) =>
          settings.get().enabled
            ? attempt(work)
            : Effect.fail(new CrmError({ code: "refused", message: sourceText("error.crm.off") }));
        const view = new CrmAgentView(store);
        return Crm.of({
          ...sources,
          overview: Effect.fn("Crm.overview")(function* () {
            return yield* attempt(() => store.overview());
          }),
          customers: Effect.fn("Crm.customers")(function* (input) {
            return yield* attempt(() => store.customers(input));
          }),
          payments: Effect.fn("Crm.payments")(function* (input) {
            return yield* attempt(() => store.payments(input));
          }),
          activity: Effect.fn("Crm.activity")(function* (input) {
            return yield* attempt(() => store.activity(input));
          }),
          settings: () => Effect.sync(() => settings.get()),
          setSettings: Effect.fn("Crm.setSettings")(function* (input) {
            const before = settings.get().enabled;
            const next = yield* settings.set(input);
            if (before !== next.enabled) yield* Effect.sync(dependencies.changed);
            return next;
          }),
          apply: Effect.fn("Crm.apply")(function* (change, actor) {
            const result = yield* attempt(() => store.apply(change, actor));
            if (result.ok) yield* Effect.sync(dependencies.changed);
            return result;
          }),
          agentFind: Effect.fn("Crm.agentFind")(function* (agentId, input) {
            return yield* agentAttempt(() => view.find(agentId, input));
          }),
          agentCustomer: Effect.fn("Crm.agentCustomer")(function* (agentId, customerId) {
            return yield* agentAttempt(() => view.customer(agentId, customerId));
          }),
          agentPayments: Effect.fn("Crm.agentPayments")(function* (agentId, input) {
            return yield* agentAttempt(() => view.payments(agentId, input));
          }),
          agentPropose: Effect.fn("Crm.agentPropose")(function* (agentId, input) {
            const proposalId = yield* agentAttempt(() => view.propose(agentId, input));
            yield* Effect.sync(dependencies.changed);
            return { proposalId };
          }),
        });
      }),
    );
  }
}

export const createCrm = Effect.fn("createCrm")(function* (dependencies: CrmDependencies) {
  const runtime = ManagedRuntime.make(Crm.layer(dependencies));
  const context = yield* runtime.contextEffect.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? runtime.disposeEffect : Effect.void)),
  );
  const service = Context.get(context, Crm);
  return { ...service, close: () => runtime.disposeEffect } satisfies CrmHandle;
});
