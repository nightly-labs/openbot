// Settings › Agents of this computer: the agent defaults, the default for a message sent to a busy
// agent, and the own values of the agents. The local window and the `agent-defaults-v1` host route use
// this, so a remote owner or admin changes the same state as the local Settings.

import type {
  AgentDefaultsOverview,
  AgentSummary,
  SetAgentDefaultChoiceInput,
  UpdateAgentDefaultsInput,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
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
  /** Throws `AgentNotFoundError` before any change when an agent of `agentIds` does not exist. */
  setChoice(input: SetAgentDefaultChoiceInput): Effect.Effect<AgentDefaultsOverview, AgentDefaultsSettingsFailure>;
}

export class AgentDefaultsSettingsFailure extends Schema.TaggedError<AgentDefaultsSettingsFailure>()(
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

function choiceUpdate(
  agentId: string,
  setting: SetAgentDefaultChoiceInput["setting"],
  choice: SetAgentDefaultChoiceInput["choice"],
): UpdateAgentInput {
  if (setting === "busyMessageMode")
    return { agentId, busyMessageMode: choice === "default" ? null : choice === "on" ? "steer" : "queue" };
  return { agentId, [setting]: choice === "default" ? null : choice === "on" };
}

export function createAgentDefaultsSettings({
  agents,
  agentDefaults,
  busyMessageMode,
}: AgentDefaultsSettingsDependencies): AgentDefaultsSettingsService {
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
    if (modeChanged) yield* rewrap(busyMessageMode.set({ mode }));
    const next = { ...previous, ...changes };
    // The spread keeps the key order of `previous`, so the two texts differ only when a value changed.
    const defaultsChanged = JSON.stringify(next) !== JSON.stringify(previous);
    if (defaultsChanged) yield* rewrap(agentDefaults.set(next));
    // The agents that follow a changed default get it at once, as after a change in the local window.
    // The `agents-changed` event also tells the open Settings of each device to read the defaults again.
    if (modeChanged || defaultsChanged) agents.agentDefaultsChanged(previous);
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
    for (const agentId of agentIds) yield* rewrap(agents.updateAgent(choiceUpdate(agentId, setting, choice)));
    return read();
  });

  return {
    read,
    update: (input) => update(input).pipe(Effect.uninterruptible),
    setChoice: (input) => setChoice(input).pipe(Effect.uninterruptible),
  };
}
