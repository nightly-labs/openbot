import { TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { resolveCreationModel } from "@openbot/ui/features/agents/agent-creation-model";
import { FIRST_AGENT_SUGGESTIONS, FirstAgentSetup } from "@openbot/ui/features/agents/FirstAgentSetup";
import { createEffect, createMemo, createSignal } from "solid-js";
import { useProviders } from "../../providers";
import { useAuth } from "../account/account-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useSetup } from "../onboarding/onboarding-context";
import { serverCanAdminister } from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useAgentActions } from "./agent-actions";
import { useAgents } from "./agents-context";
import { withHostAccountUsage } from "./host-provider-accounts";

export function WorkspaceAgentSetup() {
  const {
    agentList,
    agentSetupDraft,
    setAgentSetupDraft,
    agentSetupError,
    creatingAgent,
    cancelAgentSetup,
    modelOptions,
    agentStatus,
    serverSetupChoice,
    hostAccountLimits,
    developmentCreation,
  } = useAgents();
  const { createAgent } = useAgentActions();
  const { setupState } = useSetup();
  const { customAgents } = useCustomAgents();
  const { activeServer, activeServerSupportsCapability } = useServers();
  const {
    providerRuntimeStatuses,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
    connectProvider,
    providerAdminServerId,
    activeCustomProviders,
  } = useProviders();
  const { openServerSettings } = useServerSettings();
  const auth = useAuth();
  const accountChoice = createMemo(() => serverCanAdminister(activeServer(), PROVIDER_ACCOUNTS_CAPABILITY));
  const localProviderDownloads = createMemo(
    () => activeServer()?.kind === "local" && providerRuntimeDownloadsAvailable(),
  );
  const manageProviders = createMemo(() => activeServer()?.kind === "local" || providerAdminServerId() !== undefined);
  const openProviderSettings = (trigger: HTMLElement) => {
    const server = activeServer();
    if (server) openServerSettings(server.id, trigger, "providers");
  };
  const createModelSupported = createMemo(
    () => activeServer()?.kind !== "remote" || activeServerSupportsCapability(TEAM_AGENT_CREATE_MODEL_CAPABILITY),
  );
  const [modelTouched, setModelTouched] = createSignal(false);
  createEffect(
    () => ({
      touched: modelTouched(),
      setup: serverSetupChoice() ?? setupState(),
      options: modelOptions(),
      status: agentStatus(),
      development: developmentCreation(),
      draft: agentSetupDraft(),
    }),
    ({ touched, setup, options, status, development, draft }) => {
      if (touched) return;
      const resolved = resolveCreationModel(setup, options, status, development);
      if (!resolved) return;
      if (
        draft.provider === resolved.provider &&
        draft.model === resolved.model &&
        draft.reasoningEffort === resolved.reasoningEffort
      )
        return;
      setAgentSetupDraft({
        ...draft,
        provider: resolved.provider,
        model: resolved.model,
        reasoningEffort: resolved.reasoningEffort,
      });
    },
  );

  return (
    <FirstAgentSetup
      value={agentSetupDraft()}
      suggestions={FIRST_AGENT_SUGGESTIONS}
      mode={agentList().length === 0 ? "first" : "additional"}
      submitting={creatingAgent()}
      error={agentSetupError()}
      modelOptions={createModelSupported() ? modelOptions() : undefined}
      agentStatus={agentStatus()}
      accountChoice={accountChoice()}
      accountUsage={accountChoice() ? withHostAccountUsage(auth.accountUsage(), hostAccountLimits()) : undefined}
      runtimeStatuses={localProviderDownloads() ? providerRuntimeStatuses() : undefined}
      customProviders={activeCustomProviders()}
      customAgents={activeServer()?.kind === "local" ? customAgents() : undefined}
      onDownloadProvider={localProviderDownloads() ? downloadProviderRuntime : undefined}
      onCancelProviderDownload={localProviderDownloads() ? cancelProviderRuntimeDownload : undefined}
      onConnectProvider={localProviderDownloads() ? connectProvider : undefined}
      onAddCustomProvider={manageProviders() ? openProviderSettings : undefined}
      onManageProviders={manageProviders() ? openProviderSettings : undefined}
      onChange={(next) => {
        const current = agentSetupDraft();
        if (
          next.provider !== current.provider ||
          next.model !== current.model ||
          next.reasoningEffort !== current.reasoningEffort ||
          next.providerAccountId !== current.providerAccountId
        )
          setModelTouched(true);
        setAgentSetupDraft(next);
      }}
      onSubmit={createAgent}
      onCancel={agentList().length > 0 ? cancelAgentSetup : undefined}
    />
  );
}
