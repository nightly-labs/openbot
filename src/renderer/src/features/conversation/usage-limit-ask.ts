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

type UsageLimitAgent = Pick<
  AgentProfile,
  "id" | "name" | "provider" | "model" | "providerAccountId" | "reasoningEffort" | "backupModels"
>;

export interface UsageLimitAskSource {
  available: (agentId: string) => boolean;
  rememberable: Accessor<boolean>;
  usageLimits: Accessor<Record<string, number | null>>;
  waited: Accessor<Record<string, number | null>>;
  wait: (agentId: string, resetsAt: number | null) => void;
  modelOptions: Accessor<readonly ClientAgentModelOption[]>;
  providers: Accessor<AgentStatus["providers"]>;
  limited: (choice: AgentModelChoice) => boolean;
  update: (agentId: string, updates: Omit<UpdateAgentInput, "agentId">) => Promise<void>;
}

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
    const modelOf = (choiceProvider: string, model: string, accountId: string | null | undefined) =>
      source.modelOptions().find((option) => option.provider === choiceProvider && option.id === model) ??
      source
        .providers()
        ?.find((row) => row.id === choiceProvider)
        ?.accounts?.find((account) => account.id === accountId)
        ?.models?.find((option) => option.id === model);
    return {
      provider,
      model: modelOf(provider, agent.model, agent.providerAccountId)?.name,
      agentName: inChannel ? agent.name : undefined,
      resetsAt,
      options,
      rememberable: source.rememberable(),
      onSend: async (option, remember) => {
        const model = modelOf(option.choice.provider, option.choice.model, option.choice.providerAccountId);
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
