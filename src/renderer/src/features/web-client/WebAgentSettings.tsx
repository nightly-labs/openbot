import type { AgentModelOption, AgentStatus, CustomProviderSummary } from "@openbot/contracts/ipc";
import { TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import {
  createFirstAgentDraft,
  FIRST_AGENT_SUGGESTIONS,
  type FirstAgentDraft,
  FirstAgentSetup,
} from "@openbot/ui/features/agents/FirstAgentSetup";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, onSettled } from "solid-js";
import { resolveCreationModel } from "../agents/agent-creation-model";
import { createAgentInitialMessage } from "../agents/agent-initial-message";
import type { WebWorkspaceRuntime } from "./web-runtime";

export function WebAgentSettings(props: {
  runtime: WebWorkspaceRuntime;
  capabilities: string[];
  /** The host has no agents yet: the form shows the first-agent copy and cannot be cancelled. */
  first: boolean;
  /** The host's endpoints, so the picker lists their models on its Custom tab. */
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /** The draft the form starts from. */
  initialDraft?: FirstAgentDraft;
  onDraftChange?: (draft: FirstAgentDraft) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useText();
  const [state, setState] = createStore<{
    draft: FirstAgentDraft;
    models: AgentModelOption[];
    status: AgentStatus | null;
    busy: boolean;
    error: string | null;
    uncertain: boolean;
    /** The user picked a model, so a new catalog no longer replaces it. */
    modelTouched: boolean;
  }>({
    draft: props.initialDraft ?? createFirstAgentDraft(),
    models: [],
    status: null,
    busy: false,
    error: null,
    uncertain: false,
    modelTouched: false,
  });
  let disposed = false;
  let modelRequestGeneration = 0;

  const supportsModelSelection = () => props.capabilities.includes(TEAM_AGENT_CREATE_MODEL_CAPABILITY);

  onSettled(() => {
    return () => {
      disposed = true;
      modelRequestGeneration += 1;
    };
  });

  createEffect(supportsModelSelection, (supported) => {
    const requestGeneration = ++modelRequestGeneration;
    if (!supported) {
      setState((draft) => {
        draft.models = [];
        draft.status = null;
        draft.error = null;
      });
      return () => {
        if (requestGeneration === modelRequestGeneration) modelRequestGeneration += 1;
      };
    }

    setState((draft) => {
      draft.models = [];
      draft.status = null;
      draft.error = null;
    });
    void (async () => {
      try {
        const [models, status] = await Promise.all([props.runtime.models(), props.runtime.status()]);
        if (disposed || requestGeneration !== modelRequestGeneration) return;
        setState((draft) => {
          draft.models = models;
          draft.status = status;
          const selected = models.find(
            (model) => model.provider === draft.draft.provider && model.id === draft.draft.model,
          );
          if (draft.modelTouched && selected) return;
          // As in the desktop app. The web client does not know the host's saved setup choice.
          const resolved = resolveCreationModel(null, models);
          if (resolved) {
            draft.draft.provider = resolved.provider;
            draft.draft.model = resolved.model;
          }
        });
      } catch {
        if (disposed || requestGeneration !== modelRequestGeneration) return;
        setState((draft) => {
          draft.error = t("webClient.agent.modelsFailed");
        });
      }
    })();
    return () => {
      if (requestGeneration === modelRequestGeneration) modelRequestGeneration += 1;
    };
  });

  async function save(value: FirstAgentDraft) {
    if (state.busy || state.uncertain) return;
    setState((draft) => {
      draft.busy = true;
      draft.error = null;
    });
    let created = false;
    try {
      const selectedModel = state.models.find((model) => model.provider === value.provider && model.id === value.model);
      await props.runtime.createAgent({
        name: value.name,
        description: value.purpose,
        initialMessage: createAgentInitialMessage(value),
        avatarSeed: value.avatarSeed,
        avatarHue: value.avatarHue,
        ...(supportsModelSelection() && selectedModel
          ? { provider: selectedModel.provider, model: selectedModel.id }
          : {}),
      });
      created = true;
      if (!disposed) {
        await props.onSaved();
        props.onClose();
      }
    } catch {
      if (!disposed)
        setState((draft) => {
          draft.error = created ? t("webClient.agent.refreshFailed") : t("webClient.agent.unconfirmed");
          draft.uncertain = true;
        });
    } finally {
      if (!disposed)
        setState((draft) => {
          draft.busy = false;
        });
    }
  }
  return (
    <FirstAgentSetup
      value={state.draft}
      suggestions={FIRST_AGENT_SUGGESTIONS}
      mode={props.first ? "first" : "additional"}
      submitting={state.busy}
      error={state.error}
      modelOptions={supportsModelSelection() && state.models.length > 0 ? state.models : undefined}
      agentStatus={state.status ?? undefined}
      customProviders={props.customProviders}
      onChange={(value) => {
        setState((draft) => {
          if (value.provider !== draft.draft.provider || value.model !== draft.draft.model) draft.modelTouched = true;
          draft.draft = value;
        });
        props.onDraftChange?.(value);
      }}
      onSubmit={save}
      onCancel={props.first ? undefined : props.onClose}
    />
  );
}
