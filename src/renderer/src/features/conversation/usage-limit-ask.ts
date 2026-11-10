import { isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import { type AgentModelChoice, sameAgentModelChoice } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import {
  type BackupModelSource,
  rememberedBackupModels,
  type UsageLimitAskCardProps,
  usageLimitAskOptions,
} from "@openbot/ui/features/conversation/BackupModels";
import { createEffect } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { useTurns } from "../../turns";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";

/**
 * The card that asks where the work of an agent goes while a usage limit holds it, for the agent's
 * chat and for a channel that it works in. Only this computer holds work at a usage limit, and its
 * agents use the providers it knows. Undefined when the user chose to wait for this reset, when no
 * other model is ready, or when the agent switches by itself to a saved backup model that is ready.
 * The caller checks that work waits.
 */
export function useUsageLimitAsk() {
  const { agentStatus, modelOptions, updateAgent } = useAgents();
  const { usageLimits, usageLimitedModels, waitedUsageLimits, setWaitedUsageLimits } = useTurns();
  const { activeServer } = useServers();
  const limited = (choice: AgentModelChoice) => usageLimitedModels().some((held) => sameAgentModelChoice(held, choice));
  /** `inChannel`: the card shows in a channel, so it names the agent whose work waits. */
  return (agent: AgentProfile | undefined, inChannel = false): UsageLimitAskCardProps | undefined => {
    if (!agent || activeServer()?.kind !== "local" || !isKnownAgentProvider(agent.provider)) return undefined;
    const provider = agent.provider;
    const limits = usageLimits();
    if (!(agent.id in limits)) return undefined;
    const resetsAt = limits[agent.id] ?? null;
    if (waitedUsageLimits()[agent.id] === resetsAt && agent.id in waitedUsageLimits()) return undefined;
    const source: BackupModelSource = {
      modelOptions: modelOptions(),
      providers: agentStatus().providers,
      limited,
    };
    const options = usageLimitAskOptions({ ...agent, provider }, agent.backupModels, source);
    if (options.length === 0) return undefined;
    const backupModels = agent.backupModels;
    if (
      backupModels?.automatic &&
      backupModels.order.some((choice) => options.some((option) => sameAgentModelChoice(option.choice, choice)))
    )
      return undefined;
    const agentId = agent.id;
    const reasoningEffort = agent.reasoningEffort;
    const fromProvider = agent.provider;
    return {
      provider,
      // A limit can cover one model only, so the card names the model that the limit holds.
      model: modelOptions().find((option) => option.provider === provider && option.id === agent.model)?.name,
      agentName: inChannel ? agent.name : undefined,
      resetsAt,
      options,
      onSend: async (option, remember) => {
        // The agent keeps its reasoning effort where the other model has it.
        const model = modelOptions().find(
          (candidate) => candidate.provider === option.choice.provider && candidate.id === option.choice.model,
        );
        await updateAgent(agentId, {
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
          from_provider: fromProvider,
          to_provider: option.choice.provider,
          to_model: option.choice.model,
        });
      },
      onWait: () => {
        desktopAnalytics.track("usage_limit_action", { action: "waited", from_provider: fromProvider });
        setWaitedUsageLimits((current) => ({ ...current, [agentId]: resetsAt }));
      },
    };
  };
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
