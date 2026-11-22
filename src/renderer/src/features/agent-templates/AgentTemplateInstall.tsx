import type { AddedAgent, AgentTemplateDetail, ServerSummary } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { AgentTemplateInstallDialog } from "@openbot/ui/features/agents/AgentTemplateInstallDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import { type AgentTemplateInstallCalls, agentTemplatesPort } from "./agent-templates-port";

interface InstallState {
  detail: AgentTemplateDetail | null;
  loading: boolean;
}

export function AgentTemplateInstall(props: {
  templateId: string | null;
  server?: ServerSummary | undefined;
  calls?: AgentTemplateInstallCalls | undefined;
  onOpenLink: (url: string) => void;
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
          setState((draft) => {
            draft.loading = false;
          });
          props.onClose();
          actionToast.error(errorMessage(error, t("agentTemplate.install.readFailed")), {
            report: { operation: "agent", source: "action", cause_code: classifyFailure(error) },
          });
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
    const agent = await (server
      ? port.agent.addTemplateAgent(input, server.id)
      : port.agentTemplates.install(input).then((installed) => installed.agent)
    ).catch((error: unknown) => {
      desktopAnalytics.track("agent_template_action", {
        action: "installed",
        result: "failed",
        entry_point: "deep_link",
      });
      throw error;
    });
    desktopAnalytics.track("agent_template_action", {
      action: "installed",
      result: "succeeded",
      entry_point: "deep_link",
    });
    props.onClose();
    actionToast.success(
      server
        ? t("agentTemplate.install.addedTo", { name: agent.name, server: server.name })
        : t("agentTemplate.install.added", { name: agent.name }),
      { description: t("agentTemplate.install.ready") },
    );
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
      onOpenLink={props.onOpenLink}
    />
  );
}
