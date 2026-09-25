import type { AgentSummary, AgentTemplateDetail } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { errorMessage } from "@openbot/ui/error-message";
import { AgentTemplateInstallDialog } from "@openbot/ui/features/agents/AgentTemplateInstallDialog";
import { createEffect, createStore } from "solid-js";
import { agentTemplatesPort } from "./agent-templates-port";

interface InstallState {
  detail: AgentTemplateDetail | null;
  loading: boolean;
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
  const [state, setState] = createStore<InstallState>({ detail: null, loading: false });

  createEffect(
    () => props.templateId,
    (templateId) => {
      setState((draft) => {
        draft.detail = null;
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
          // Nothing can be shown without the template, so the dialog closes and the toast says why.
          setState((draft) => {
            draft.loading = false;
          });
          props.onClose();
          toast.error(errorMessage(error, "Could not read the shared agent."));
        });
      return () => {
        current = false;
      };
    },
  );

  async function install(): Promise<void> {
    const templateId = props.templateId;
    const reviewed = state.detail;
    if (!templateId || !reviewed) return;
    const { agent } = await agentTemplatesPort().agentTemplates.install({
      templateId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      expectedUpdatedAt: reviewed.updatedAt,
    });
    props.onClose();
    toast.success(`${agent.name} added`, { description: "Its instructions, skills and routines are ready." });
    // The agent exists now. A failure to open it must not read as a failed install, or the user would
    // add it a second time.
    try {
      await props.onInstalled(agent);
    } catch (error) {
      toast.error(errorMessage(error, `Could not open ${agent.name}. Find it in the sidebar.`));
    }
  }

  return (
    <AgentTemplateInstallDialog
      open={props.templateId !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      detail={state.detail}
      loading={state.loading}
      onInstall={install}
    />
  );
}
