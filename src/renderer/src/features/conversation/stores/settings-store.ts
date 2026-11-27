import { isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentModelId, AgentProviderId, AgentReasoningEffort, UpdateAgentInput } from "@openbot/contracts/ipc";
import { findModelOption } from "@openbot/ui/components/provider-accounts";
import type {
  AgentRuntimeSettings,
  AgentRuntimeSettingsPatch,
} from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { currentText } from "@openbot/ui/text";
import { agentConversationKey } from "../conversation-keys";
import type { ConversationProps, ConversationTarget } from "../conversation-types";

export function runtimeSettingsEqual(left: AgentRuntimeSettings, right: AgentRuntimeSettings): boolean {
  return (
    left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort
  );
}

function isCompleteRuntimeSettingsPatch(updates: AgentRuntimeSettingsPatch): updates is AgentRuntimeSettings {
  return "provider" in updates && "model" in updates;
}

export interface SettingsStoreDeps {
  props: ConversationProps;
  runtimeSettingsAttempts: Map<
    string,
    {
      generation: number;
      pending: boolean;
      settings: {
        provider: AgentProviderId;
        model: AgentModelId;
        reasoningEffort: AgentReasoningEffort;
      };
    }
  >;
  runtimeSettingsSaveTails: Map<string, Promise<boolean>>;
  settingsProvider: () => AgentProviderId;
  setSettingsProvider: (provider: AgentProviderId) => void;
  settingsModel: () => AgentModelId;
  setSettingsModel: (model: AgentModelId) => void;
  settingsReasoning: () => AgentReasoningEffort;
  setSettingsReasoning: (effort: AgentReasoningEffort) => void;
  setComposerError: (error: string | null, targetOverride?: ConversationTarget) => void;
  viewIsMounted: () => boolean;
  saveAgentPatch: (updates: Omit<UpdateAgentInput, "agentId">, targetAgentId?: string) => Promise<boolean>;
}

interface RuntimeSettingsSave {
  saved: boolean;
  refusal?: { error: unknown } | undefined;
}

export function createSettingsStore(deps: SettingsStoreDeps) {
  async function saveRuntimeSettings(
    settings: AgentRuntimeSettings,
    updates: AgentRuntimeSettingsPatch,
    errorMessage: string | null,
    targetAgentId = deps.props.agent?.id,
  ): Promise<RuntimeSettingsSave> {
    const agentId = targetAgentId;
    if (!agentId) return { saved: false };
    const serverId = deps.props.server?.id ?? "local";
    const target = { agentId, serverId };
    const settingsKey = agentConversationKey(serverId, agentId);
    const previousAttempt = deps.runtimeSettingsAttempts.get(settingsKey);
    const generation = (previousAttempt?.generation ?? 0) + 1;
    deps.runtimeSettingsAttempts.set(settingsKey, { generation, pending: true, settings });
    if (errorMessage) deps.setComposerError(null, target);

    const previousSave = deps.runtimeSettingsSaveTails.get(settingsKey);
    let releaseSave!: (baseValid: boolean) => void;
    const saveTail = new Promise<boolean>((resolve) => {
      releaseSave = resolve;
    });
    deps.runtimeSettingsSaveTails.set(settingsKey, saveTail);
    let saved = false;
    let refusal: RuntimeSettingsSave["refusal"];
    let baseValid = true;
    let abandoned = false;
    try {
      if (previousSave) baseValid = await previousSave;
      abandoned = !deps.viewIsMounted();
      const completePatch = isCompleteRuntimeSettingsPatch(updates);
      if (!abandoned && (baseValid || completePatch)) {
        try {
          saved = await deps.saveAgentPatch(updates, agentId);
        } catch (error) {
          refusal = { error };
        }
      }
      if (completePatch) baseValid = saved;
    } finally {
      releaseSave(baseValid);
      if (deps.runtimeSettingsSaveTails.get(settingsKey) === saveTail) {
        deps.runtimeSettingsSaveTails.delete(settingsKey);
      }
    }
    const latestAttempt = deps.runtimeSettingsAttempts.get(settingsKey);
    if (latestAttempt?.generation !== generation) return { saved: true };
    latestAttempt.pending = false;
    if (abandoned) return { saved: false };
    if (saved) {
      const activeAgent = deps.props.agent;
      if (activeAgent?.id === agentId) {
        const runtime = activeAgent.pendingRuntime ?? activeAgent;
        if (isKnownAgentProvider(runtime.provider)) deps.setSettingsProvider(runtime.provider);
        deps.setSettingsModel(runtime.model);
        deps.setSettingsReasoning(runtime.reasoningEffort);
      }
      return { saved: true };
    }

    const activeAgent = deps.props.agent;
    const currentSettings = {
      provider: deps.settingsProvider(),
      model: deps.settingsModel(),
      reasoningEffort: deps.settingsReasoning(),
    };
    if (activeAgent?.id !== agentId || !runtimeSettingsEqual(currentSettings, settings))
      return { saved: false, refusal };
    const runtime = activeAgent.pendingRuntime ?? activeAgent;
    if (isKnownAgentProvider(runtime.provider)) deps.setSettingsProvider(runtime.provider);
    deps.setSettingsModel(runtime.model);
    deps.setSettingsReasoning(runtime.reasoningEffort);
    if (errorMessage) {
      deps.setComposerError(refusal ? currentText().errorMessage(refusal.error, errorMessage) : errorMessage, target);
    }
    return { saved: false, refusal };
  }

  async function updateRuntimeSettings(
    agentId: string,
    settings: AgentRuntimeSettings,
    updates: AgentRuntimeSettingsPatch,
  ): Promise<boolean> {
    if (deps.props.agent?.id === agentId) {
      deps.setSettingsProvider(settings.provider);
      deps.setSettingsModel(settings.model);
      deps.setSettingsReasoning(settings.reasoningEffort);
    }
    const result = await saveRuntimeSettings(settings, updates, null, agentId);
    if (result.refusal) throw result.refusal.error;
    return result.saved;
  }

  async function selectModel(
    model: AgentModelId,
    provider: AgentProviderId,
    persist = true,
    reportComposerError = false,
    accountId?: string | null,
    preferredEffort?: AgentReasoningEffort,
  ): Promise<boolean> {
    const option = findModelOption(deps.props.modelOptions, deps.props.agentStatus.providers, provider, model);
    if (!option) return false;
    const preferred = preferredEffort ?? deps.settingsReasoning();
    const reasoningEffort = option.supportedReasoningEfforts.includes(preferred)
      ? preferred
      : option.defaultReasoningEffort;
    deps.setSettingsProvider(provider);
    deps.setSettingsModel(model);
    deps.setSettingsReasoning(reasoningEffort);
    if (!persist) return true;
    const result = await saveRuntimeSettings(
      { provider, model, reasoningEffort },
      accountId === undefined
        ? { provider, model, reasoningEffort }
        : { provider, model, reasoningEffort, providerAccountId: accountId },
      reportComposerError ? currentText().t("composer.error.changeModel") : null,
    );
    return result.saved;
  }

  async function selectAndConfirmModel(
    model: AgentModelId,
    provider: AgentProviderId,
    accountId?: string | null,
    reasoningEffort?: AgentReasoningEffort,
  ): Promise<void> {
    await selectModel(model, provider, true, true, accountId, reasoningEffort);
  }

  async function selectAndConfirmReasoning(effort: AgentReasoningEffort): Promise<void> {
    const option = findModelOption(
      deps.props.modelOptions,
      deps.props.agentStatus.providers,
      deps.settingsProvider(),
      deps.settingsModel(),
    );
    if (!option?.supportedReasoningEfforts.includes(effort)) return;
    const settings = {
      provider: deps.settingsProvider(),
      model: deps.settingsModel(),
      reasoningEffort: effort,
    };
    deps.setSettingsReasoning(effort);
    await saveRuntimeSettings(settings, { reasoningEffort: effort }, currentText().t("composer.error.changeEffort"));
  }

  return {
    saveRuntimeSettings,
    updateRuntimeSettings,
    selectModel,
    selectAndConfirmModel,
    selectAndConfirmReasoning,
  };
}
