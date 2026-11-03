import { TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { FIRST_AGENT_SUGGESTIONS, FirstAgentSetup } from "@openbot/ui/features/agents/FirstAgentSetup";
import { createEffect, createMemo, createSignal } from "solid-js";
import { useProviders } from "../../providers";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useSetup } from "../onboarding/onboarding-context";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";
import { useAgentActions } from "./agent-actions";
import { resolveCreationModel } from "./agent-creation-model";
import { useAgents } from "./agents-context";

/**
 * The create-an-agent form, which takes over the conversation pane instead of
 * opening over it. `mode` is derived from the agent list rather than passed in
 * because the first agent and the fifth are the same command with different copy.
 */
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
  /** Provider downloads are the local machine's business, never a remote host's. */
  const localProviderDownloads = createMemo(
    () => activeServer()?.kind === "local" && providerRuntimeDownloadsAvailable(),
  );
  /** Providers are managed on this computer, or on a joined host by its owner or an admin. */
  const manageProviders = createMemo(() => activeServer()?.kind === "local" || providerAdminServerId() !== undefined);
  const openProviderSettings = (trigger: HTMLElement) => {
    const server = activeServer();
    if (server) openServerSettings(server.id, trigger, "providers");
  };
  /**
   * A remote host without the capability drops the pair in its frozen projection and starts the
   * agent on its own default, so the form offers no choice there: the backend default stands.
   */
  const createModelSupported = createMemo(
    () => activeServer()?.kind !== "remote" || activeServerSupportsCapability(TEAM_AGENT_CREATE_MODEL_CAPABILITY),
  );
  /**
   * The draft opens on the hard-coded default, which would bypass the saved setup choice and fail
   * outright after onboarding with a provider the default does not cover. Resolve it from the
   * saved choice and the live catalog until the user picks a model themselves. A joined server's
   * provider step chose for that server, so its choice comes first. A chosen reasoning level
   * also stops it, so the development default's level does not replace the user's.
   */
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
      runtimeStatuses={localProviderDownloads() ? providerRuntimeStatuses() : undefined}
      customProviders={activeCustomProviders()}
      // The custom agents are this computer's. A joined host's picker counts its own from its models.
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
          next.reasoningEffort !== current.reasoningEffort
        )
          setModelTouched(true);
        setAgentSetupDraft(next);
      }}
      onSubmit={createAgent}
      onCancel={agentList().length > 0 ? cancelAgentSetup : undefined}
    />
  );
}
