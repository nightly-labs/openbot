import type { AgentModelOption, AgentStatus } from "@openbot/contracts/ipc";
import { TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import {
  createFirstAgentDraft,
  FIRST_AGENT_SUGGESTIONS,
  type FirstAgentDraft,
  FirstAgentSetup,
} from "@openbot/ui/features/agents/FirstAgentSetup";
import { createEffect, createStore, onSettled } from "solid-js";
import { createAgentInitialMessage } from "../agents/agent-initial-message";
import type { WebWorkspaceRuntime } from "./web-runtime";

export function WebAgentSettings(props: {
  runtime: WebWorkspaceRuntime;
  capabilities: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [state, setState] = createStore<{
    draft: FirstAgentDraft;
    models: AgentModelOption[];
    status: AgentStatus | null;
    busy: boolean;
    error: string | null;
    uncertain: boolean;
  }>({ draft: createFirstAgentDraft(), models: [], status: null, busy: false, error: null, uncertain: false });
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
          const first = models[0];
          if (!selected && first) {
            draft.draft.provider = first.provider;
            draft.draft.model = first.id;
          }
        });
      } catch {
        if (disposed || requestGeneration !== modelRequestGeneration) return;
        setState((draft) => {
          draft.error = "Could not load the host models.";
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
          draft.error = created
            ? "The agent was created, but the workspace could not refresh. Reload before trying again."
            : "The result is not confirmed. Close this form and check the host before trying again.";
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
      mode="additional"
      submitting={state.busy}
      error={state.error}
      modelOptions={supportsModelSelection() && state.models.length > 0 ? state.models : undefined}
      agentStatus={state.status ?? undefined}
      onChange={(value) =>
        setState((draft) => {
          draft.draft = value;
        })
      }
      onSubmit={save}
      onCancel={props.onClose}
    />
  );
}
