import { isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import {
  type AgentModelChoice,
  type AgentStatus,
  type ClientAgentModelOption,
  sameAgentModelChoice,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import {
  type BackupModelSource,
  rememberedBackupModels,
  type UsageLimitAskCardProps,
  usageLimitAskOptions,
} from "@openbot/ui/features/conversation/BackupModels";
import { type Accessor, createEffect } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { useTurns } from "../../turns";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";

/** The fields of an agent that the question reads. */
type UsageLimitAgent = Pick<
  AgentProfile,
  "id" | "name" | "provider" | "model" | "providerAccountId" | "reasoningEffort" | "backupModels"
>;

/** The data of the usage-limit question, on this computer, on a joined server, and in the web client. */
export interface UsageLimitAskSource {
  /** Whether the reader can see the question and move this agent. */
  available: (agentId: string) => boolean;
  /** Whether the reader can save the choice in the backup models. */
  rememberable: Accessor<boolean>;
  /** The reset time of each agent that a usage limit holds, by agent id. */
  usageLimits: Accessor<Record<string, number | null>>;
  /** The reset time of the limit for which the user chose Wait, by agent id. */
  waited: Accessor<Record<string, number | null>>;
  wait: (agentId: string, resetsAt: number | null) => void;
  modelOptions: Accessor<readonly ClientAgentModelOption[]>;
  providers: Accessor<AgentStatus["providers"]>;
  limited: (choice: AgentModelChoice) => boolean;
  update: (agentId: string, updates: Omit<UpdateAgentInput, "agentId">) => Promise<void>;
}

/**
 * The card that asks where the work of an agent goes while a usage limit holds it, for the agent's
 * chat and for a channel that it works in. Undefined when the user chose to wait for this reset, when
 * no other model is ready, or when the agent switches by itself to a saved backup model that is ready.
 * The caller checks that work waits. `inChannel`: the card shows in a channel, so it names the agent
 * whose work waits.
 */
export function usageLimitAskFrom(source: UsageLimitAskSource) {
  return (agent: UsageLimitAgent | undefined, inChannel = false): UsageLimitAskCardProps | undefined => {
    if (!agent || !source.available(agent.id) || !isKnownAgentProvider(agent.provider)) return undefined;
    const provider = agent.provider;
    const limits = source.usageLimits();
    if (!(agent.id in limits)) return undefined;
    const resetsAt = limits[agent.id] ?? null;
    const waited = source.waited();
    if (waited[agent.id] === resetsAt && agent.id in waited) return undefined;
    const choices: BackupModelSource = {
      modelOptions: source.modelOptions(),
      providers: source.providers(),
      limited: source.limited,
    };
    const options = usageLimitAskOptions({ ...agent, provider }, agent.backupModels, choices);
    if (options.length === 0) return undefined;
    const backupModels = agent.backupModels;
    if (
      backupModels?.automatic &&
      backupModels.order.some((choice) => options.some((option) => sameAgentModelChoice(option.choice, choice)))
    )
      return undefined;
    const agentId = agent.id;
    const reasoningEffort = agent.reasoningEffort;
    return {
      provider,
      // A limit can cover one model only, so the card names the model that the limit holds.
      model: source.modelOptions().find((option) => option.provider === provider && option.id === agent.model)?.name,
      agentName: inChannel ? agent.name : undefined,
      resetsAt,
      options,
      rememberable: source.rememberable(),
      onSend: async (option, remember) => {
        // The agent keeps its reasoning effort where the other model has it.
        const model = source
          .modelOptions()
          .find((candidate) => candidate.provider === option.choice.provider && candidate.id === option.choice.model);
        await source.update(agentId, {
          provider: option.choice.provider,
          model: option.choice.model,
          providerAccountId: option.choice.providerAccountId ?? null,
          reasoningEffort:
            model && !model.supportedReasoningEfforts.includes(reasoningEffort)
              ? model.defaultReasoningEffort
              : reasoningEffort,
          leaveUsageLimit: true,
          ...(remember ? { backupModels: rememberedBackupModels(option.choice, backupModels) } : {}),
        });
        desktopAnalytics.track("usage_limit_action", {
          action: "model_switched",
          from_provider: provider,
          to_provider: option.choice.provider,
          to_model: option.choice.model,
        });
      },
      onWait: () => {
        desktopAnalytics.track("usage_limit_action", { action: "waited", from_provider: provider });
        source.wait(agentId, resetsAt);
      },
    };
  };
}

/**
 * The question for the agents of this computer. A channel uses it: only this computer holds the work
 * of a channel at a usage limit, and its agents use the providers it knows.
 */
export function useUsageLimitAsk() {
  const { agentStatus, modelOptions, updateAgent } = useAgents();
  const { usageLimits, usageLimitedModels, waitedUsageLimits, setWaitedUsageLimits } = useTurns();
  const { activeServer } = useServers();
  return usageLimitAskFrom({
    available: () => activeServer()?.kind === "local",
    rememberable: () => true,
    usageLimits,
    waited: waitedUsageLimits,
    wait: (agentId, resetsAt) => setWaitedUsageLimits((current) => ({ ...current, [agentId]: resetsAt })),
    modelOptions,
    providers: () => agentStatus().providers,
    limited: (choice) => usageLimitedModels().some((held) => sameAgentModelChoice(held, choice)),
    update: async (agentId, updates) => {
      await updateAgent(agentId, updates);
    },
  });
}

/**
 * One "shown" for each limit that asks, also when the user opens the chat again; a new reset time is
 * a new limit.
 */
export function trackUsageLimitShown(shown: () => { agentId: string; ask: UsageLimitAskCardProps } | undefined) {
  const tracked = new Set<string>();
  createEffect(
    () => {
      const value = shown();
      return value ? { key: `${value.agentId}:${value.ask.resetsAt ?? ""}`, provider: value.ask.provider } : null;
    },
    (value) => {
      if (!value || tracked.has(value.key)) return;
      tracked.add(value.key);
      desktopAnalytics.track("usage_limit_action", { action: "shown", from_provider: value.provider });
    },
  );
}
