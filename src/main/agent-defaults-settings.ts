import {
  type AgentDefaultsOverview,
  type AgentSummary,
  agentDefaultChoiceValues,
  type SetAgentDefaultChoiceInput,
  type UpdateAgentDefaultsInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema, Semaphore } from "effect";
import type { AgentService } from "../backend/agent-service";
import { causeHelpers } from "../backend/effect-boundary";
import { AgentNotFoundError } from "./agent-admin-settings";
import type { AgentDefaultsPreferenceStore } from "./agent-defaults-preference-store";
import type { BusyMessageModePreferenceStore } from "./busy-message-mode-preference-store";

export interface AgentDefaultsSettingsDependencies {
  agents: Pick<AgentService, "listAgents" | "updateAgent" | "agentDefaultsChanged">;
  agentDefaults: AgentDefaultsPreferenceStore;
  busyMessageMode: BusyMessageModePreferenceStore;
}

export interface AgentDefaultsSettingsService {
  read(): AgentDefaultsOverview;
  update(input: UpdateAgentDefaultsInput): Effect.Effect<AgentDefaultsOverview, AgentDefaultsSettingsFailure>;
  setChoice(input: SetAgentDefaultChoiceInput): Effect.Effect<AgentDefaultsOverview, AgentDefaultsSettingsFailure>;
}

class AgentDefaultsSettingsFailure extends Schema.TaggedError<AgentDefaultsSettingsFailure>()(
  "AgentDefaultsSettingsFailure",
  { cause: Schema.Defect() },
) {}

const { rewrap, sync } = causeHelpers(AgentDefaultsSettingsFailure);

function ownValues(agent: AgentSummary): AgentDefaultsOverview["agents"][number] {
  return {
    agentId: agent.id,
    allowAutomation: agent.allowAutomation ?? null,
    allowNewChat: agent.allowNewChat ?? null,
    quickAcknowledgement: agent.quickAcknowledgement ?? null,
    busyMessageMode: agent.busyMessageMode ?? null,
  };
}

export function createAgentDefaultsSettings({
  agents,
  agentDefaults,
  busyMessageMode,
}: AgentDefaultsSettingsDependencies): AgentDefaultsSettingsService {
  const updates = Semaphore.makeUnsafe(1);

  function read(): AgentDefaultsOverview {
    return {
      defaults: agentDefaults.get(),
      busyMessageMode: busyMessageMode.get().mode,
      agents: agents.listAgents().map(ownValues),
    };
  }

  const update = Effect.fn("AgentDefaultsSettings.update")(function* ({
    busyMessageMode: mode,
    ...changes
  }: UpdateAgentDefaultsInput) {
    const previous = agentDefaults.get();
    const modeChanged = mode !== undefined && mode !== busyMessageMode.get().mode;
    const next = { ...previous, ...changes };
    const defaultsChanged = JSON.stringify(next) !== JSON.stringify(previous);
    if (!modeChanged && !defaultsChanged) return read();
    yield* Effect.gen(function* () {
      if (modeChanged && mode !== undefined) yield* rewrap(busyMessageMode.set({ mode }));
      if (defaultsChanged) yield* rewrap(agentDefaults.set(next));
    }).pipe(Effect.ensuring(Effect.sync(() => agents.agentDefaultsChanged(previous))));
    return read();
  });

  const setChoice = Effect.fn("AgentDefaultsSettings.setChoice")(function* ({
    agentIds,
    setting,
    choice,
  }: SetAgentDefaultChoiceInput) {
    yield* sync(() => {
      const known = new Set(agents.listAgents().map((agent) => agent.id));
      if (agentIds.some((agentId) => !known.has(agentId)))
        throw new AgentNotFoundError(sourceText("error.team.agentNotFound"));
    });
    for (const agentId of agentIds)
      yield* rewrap(agents.updateAgent({ agentId, ...agentDefaultChoiceValues(setting, choice) }));
    return read();
  });

  return {
    read,
    update: (input) => update(input).pipe(updates.withPermit, Effect.uninterruptible),
    setChoice: (input) => setChoice(input).pipe(Effect.uninterruptible),
  };
}
