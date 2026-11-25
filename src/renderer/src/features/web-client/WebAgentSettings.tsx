import { isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import type { AccountUsage, AgentStatus, ClientAgentModelOption, CustomProviderSummary } from "@openbot/contracts/ipc";
import { AGENT_WELCOME_CAPABILITY, TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { type CreationPreference, resolveCreationModel } from "@openbot/ui/features/agents/agent-creation-model";
import { createAgentInitialMessage } from "@openbot/ui/features/agents/agent-initial-message";
import {
  createFirstAgentDraft,
  FIRST_AGENT_SUGGESTIONS,
  type FirstAgentDraft,
  FirstAgentSetup,
} from "@openbot/ui/features/agents/FirstAgentSetup";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, onSettled } from "solid-js";
import type { WebWorkspaceRuntime } from "./web-runtime";

export function WebAgentSettings(props: {
  runtime: WebWorkspaceRuntime;
  capabilities: string[];
  first: boolean;
  preference?: CreationPreference | null | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  onManageProviders?: ((trigger: HTMLElement) => void) | undefined;
  onOpenModelPicker?: (() => void) | undefined;
  liveModels?: ClientAgentModelOption[] | undefined;
  liveStatus?: AgentStatus | undefined;
  accountChoice?: boolean | undefined;
  accountUsage?: AccountUsage | null | undefined;
  initialDraft?: FirstAgentDraft;
  onDraftChange?: (draft: FirstAgentDraft) => void;
  onClose: () => void;
  onSaved: (agentId: string) => Promise<void>;
}) {
  const { t } = useText();
  const [state, setState] = createStore<{
    draft: FirstAgentDraft;
    models: ClientAgentModelOption[];
    status: AgentStatus | null;
    busy: boolean;
    error: string | null;
    uncertain: boolean;
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

  function showCatalog(models: ClientAgentModelOption[], status: AgentStatus): void {
    setState((draft) => {
      draft.models = models;
      draft.status = status;
      const selected = models.find(
        (model) => model.provider === draft.draft.provider && model.id === draft.draft.model,
      );
      if (draft.modelTouched && selected) return;
      const resolved = resolveCreationModel(props.preference ?? null, models, status);
      if (resolved) {
        draft.draft.provider = resolved.provider;
        draft.draft.model = resolved.model;
        draft.draft.reasoningEffort = resolved.reasoningEffort;
      }
    });
  }

  createEffect(
    () => ({ models: props.liveModels, status: props.liveStatus }),
    ({ models, status }) => {
      if (!supportsModelSelection() || !models?.length || status?.phase !== "ready") return;
      modelRequestGeneration += 1;
      showCatalog(models, status);
    },
  );

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
        showCatalog(models, status);
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
      const agent = await props.runtime.createAgent({
        name: value.name,
        description: value.purpose,
        initialMessage: createAgentInitialMessage(value, props.capabilities.includes(AGENT_WELCOME_CAPABILITY)),
        avatarSeed: value.avatarSeed,
        avatarHue: value.avatarHue,
        ...(supportsModelSelection() && selectedModel && isKnownAgentProvider(selectedModel.provider)
          ? {
              provider: selectedModel.provider,
              model: selectedModel.id,
              ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}),
              ...(props.accountChoice && value.providerAccountId !== undefined
                ? { providerAccountId: value.providerAccountId }
                : {}),
            }
          : {}),
      });
      created = true;
      if (!disposed) {
        await props.onSaved(agent.id);
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
      accountChoice={props.accountChoice}
      accountUsage={props.accountUsage}
      customProviders={props.customProviders}
      onManageProviders={props.onManageProviders}
      onOpenModelPicker={props.onOpenModelPicker}
      onChange={(value) => {
        setState((draft) => {
          if (
            value.provider !== draft.draft.provider ||
            value.model !== draft.draft.model ||
            value.reasoningEffort !== draft.draft.reasoningEffort ||
            value.providerAccountId !== draft.draft.providerAccountId
          )
            draft.modelTouched = true;
          draft.draft = value;
        });
        props.onDraftChange?.(value);
      }}
      onSubmit={save}
      onCancel={props.first ? undefined : props.onClose}
    />
  );
}
