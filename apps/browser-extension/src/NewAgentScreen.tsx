import type { AgentStatus, ClientAgentModelOption } from "@openbot/contracts/ipc";
import { resolveCreationModel } from "@openbot/ui/features/agents/agent-creation-model";
import {
  createFirstAgentDraft,
  FIRST_AGENT_SUGGESTIONS,
  type FirstAgentDraft,
  FirstAgentSetup,
} from "@openbot/ui/features/agents/FirstAgentSetup";
import { useText } from "@openbot/ui/text";
import { createMemo, createStore, onSettled } from "solid-js";
import type { Workspace } from "./workspace";

export function NewAgentScreen(props: {
  workspace: Workspace;
  onClose: () => void;
  onCreated: (agentId: string) => void;
}) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{
    draft: FirstAgentDraft;
    models: ClientAgentModelOption[];
    status: AgentStatus | null;
    busy: boolean;
    error: string | null;
    modelTouched: boolean;
  }>({
    draft: createFirstAgentDraft(),
    models: [],
    status: null,
    busy: false,
    error: null,
    modelTouched: false,
  });
  let disposed = false;
  const modelOptions = createMemo(() => (state.models.length > 0 ? state.models : undefined));
  const agentStatus = createMemo(() => state.status ?? undefined);

  onSettled(() => {
    void props.workspace
      .agentCatalog()
      .then((catalog) => {
        if (disposed || !catalog) return;
        setState((draft) => {
          draft.models = catalog.models;
          draft.status = catalog.status;
          if (draft.modelTouched) return;
          const start = resolveCreationModel(null, catalog.models, catalog.status);
          if (!start) return;
          draft.draft.provider = start.provider;
          draft.draft.model = start.model;
          draft.draft.reasoningEffort = start.reasoningEffort;
        });
      })
      .catch(() => {
        if (!disposed)
          setState((draft) => {
            draft.error = t("webClient.agent.modelsFailed");
          });
      });
    return () => {
      disposed = true;
    };
  });

  async function save(value: FirstAgentDraft) {
    if (state.busy) return;
    setState((draft) => {
      draft.busy = true;
      draft.error = null;
    });
    try {
      const agentId = await props.workspace.createAgent(value);
      if (!disposed) props.onCreated(agentId);
    } catch (error) {
      if (!disposed)
        setState((draft) => {
          draft.error = errorMessage(error, t("webClient.agent.unconfirmed"));
        });
    } finally {
      if (!disposed)
        setState((draft) => {
          draft.busy = false;
        });
    }
  }

  return (
    <div class="ext-form-screen ext-new-agent">
      <FirstAgentSetup
        value={state.draft}
        suggestions={FIRST_AGENT_SUGGESTIONS}
        mode="additional"
        submitting={state.busy}
        error={state.error}
        modelOptions={modelOptions()}
        agentStatus={agentStatus()}
        onChange={(value) =>
          setState((draft) => {
            if (value.provider !== draft.draft.provider || value.model !== draft.draft.model) draft.modelTouched = true;
            draft.draft = value;
          })
        }
        onSubmit={save}
        onCancel={props.onClose}
      />
    </div>
  );
}
