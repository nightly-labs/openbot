import type { AgentSummary, AgentTemplateDetail } from "@openbot/contracts/ipc";
import { errorMessage } from "@openbot/ui/error-message";
import { AgentTemplateInstallDialog } from "@openbot/ui/features/agents/AgentTemplateInstallDialog";
import { createEffect, createStore } from "solid-js";
import { agentTemplatesPort } from "./agent-templates-port";

interface InstallState {
  detail: AgentTemplateDetail | null;
  loading: boolean;
  error: string | null;
}

/**
 * The dialog an `openbot://agents/<id>` link opens. It reads the template by the id the link named
 * and installs it on this computer only when the user presses Add agent.
 */
export function AgentTemplateInstall(props: {
  templateId: string | null;
  onClose: () => void;
  onInstalled: (agent: AgentSummary) => Promise<void>;
}) {
  const [state, setState] = createStore<InstallState>({ detail: null, loading: false, error: null });

  createEffect(
    () => props.templateId,
    (templateId) => {
      setState((draft) => {
        draft.detail = null;
        draft.error = null;
        draft.loading = templateId !== null;
      });
      if (!templateId) return;
      let current = true;
      agentTemplatesPort()
        .agentTemplates.get(templateId)
        .then((detail) => {
          if (!current) return;
          setState((draft) => {
            draft.detail = detail;
            draft.loading = false;
          });
        })
        .catch((error: unknown) => {
          if (!current) return;
          setState((draft) => {
            draft.error = errorMessage(error, "Could not read the shared agent.");
            draft.loading = false;
          });
        });
      return () => {
        current = false;
      };
    },
  );

  async function install(): Promise<void> {
    const templateId = props.templateId;
    if (!templateId) return;
    const { agent } = await agentTemplatesPort().agentTemplates.install({
      templateId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    props.onClose();
    await props.onInstalled(agent);
  }

  return (
    <AgentTemplateInstallDialog
      open={props.templateId !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      detail={state.detail}
      loading={state.loading}
      error={state.error}
      onInstall={install}
    />
  );
}
