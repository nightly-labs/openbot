import { TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { FIRST_AGENT_SUGGESTIONS, FirstAgentSetup } from "@openbot/ui/features/agents/FirstAgentSetup";
import { createEffect, createMemo, createSignal } from "solid-js";
import { useProviders } from "../../providers";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useSetup } from "../onboarding/onboarding-context";
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
  } = useAgents();
  const { createAgent } = useAgentActions();
  const { setupState } = useSetup();
  // Not gated on the server: the picker needs these IDs to label a model it is already showing,
  // and a remote server's OpenCode has its own catalogue. Only the write paths are local-only.
  const { customProviders } = useCustomProviders();
  const { activeServer, activeServerSupportsCapability } = useServers();
  const {
    providerRuntimeStatuses,
    providerRuntimeDownloadsAvailable,
    downloadProviderRuntime,
    cancelProviderRuntimeDownload,
    connectProvider,
  } = useProviders();
  /** Provider downloads are the local machine's business, never a remote host's. */
  const localProviderDownloads = createMemo(
    () => activeServer()?.kind === "local" && providerRuntimeDownloadsAvailable(),
  );
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
   * saved choice and the live catalog until the user picks a model themselves.
   */
  const [modelTouched, setModelTouched] = createSignal(false);
  createEffect(
    () => ({ touched: modelTouched(), setup: setupState(), options: modelOptions(), draft: agentSetupDraft() }),
    ({ touched, setup, options, draft }) => {
      if (touched) return;
      const resolved = resolveCreationModel(setup, options);
      if (!resolved) return;
      if (draft.provider === resolved.provider && draft.model === resolved.model) return;
      setAgentSetupDraft({ ...draft, provider: resolved.provider, model: resolved.model });
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
      customProviders={customProviders()}
      onDownloadProvider={localProviderDownloads() ? downloadProviderRuntime : undefined}
      onCancelProviderDownload={localProviderDownloads() ? cancelProviderRuntimeDownload : undefined}
      onConnectProvider={localProviderDownloads() ? connectProvider : undefined}
      onChange={(next) => {
        const current = agentSetupDraft();
        if (next.provider !== current.provider || next.model !== current.model) setModelTouched(true);
        setAgentSetupDraft(next);
      }}
      onSubmit={createAgent}
      onCancel={agentList().length > 0 ? cancelAgentSetup : undefined}
    />
  );
}
