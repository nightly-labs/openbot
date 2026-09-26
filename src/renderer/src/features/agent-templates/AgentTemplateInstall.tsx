import type { AddedAgent, AgentTemplateDetail, ServerSummary } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { AgentTemplateInstallDialog } from "@openbot/ui/features/agents/AgentTemplateInstallDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore } from "solid-js";
import { type AgentTemplateInstallCalls, agentTemplatesPort } from "./agent-templates-port";

interface InstallState {
  detail: AgentTemplateDetail | null;
  loading: boolean;
}

/**
 * The dialog an `openbot://agents/<id>` link opens. It reads the template by the id the link named
 * and installs it only when the user presses Add agent: on `server` when one is given, whose host
 * downloads the template itself, otherwise on this computer.
 */
export function AgentTemplateInstall(props: {
  templateId: string | null;
  server?: ServerSummary | undefined;
  /** Defaults to the desktop port. */
  calls?: AgentTemplateInstallCalls;
  onClose: () => void;
  onInstalled: (agent: AddedAgent, serverId?: string) => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<InstallState>({ detail: null, loading: false });
  const calls = (): AgentTemplateInstallCalls => props.calls ?? agentTemplatesPort();

  createEffect(
    () => props.templateId,
    (templateId) => {
      setState((draft) => {
        draft.detail = null;
        draft.loading = templateId !== null;
      });
      if (!templateId) return;
      let current = true;
      calls()
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
          toast.error(errorMessage(error, t("agentTemplate.install.readFailed")));
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
    const server = props.server;
    const input = {
      templateId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      expectedUpdatedAt: reviewed.updatedAt,
    };
    const port = calls();
    const agent = server
      ? await port.agent.addTemplateAgent(input, server.id)
      : (await port.agentTemplates.install(input)).agent;
    props.onClose();
    toast.success(
      server
        ? t("agentTemplate.install.addedTo", { name: agent.name, server: server.name })
        : t("agentTemplate.install.added", { name: agent.name }),
      { description: t("agentTemplate.install.ready") },
    );
    // Opening the new agent reports its own failure and never rejects, so it cannot read as a failed install.
    await props.onInstalled(agent, server?.id);
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
