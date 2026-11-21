import type { ServerSummary } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, onSettled } from "solid-js";
import { agentAskedHere } from "../../agent-requests";
import { desktopWorkflowList, onDesktopWorkflowsChanged } from "./workflows-port";

export interface AgentWorkflowToastHost {
  activeServer: () => ServerSummary | undefined;
  workflowsOnScreen: () => boolean;
  agentName: (agentId: string) => string | undefined;
  open: (workflow: { serverId: string; workflowId: string }) => void;
}

export function watchAgentWorkflows(host: AgentWorkflowToastHost): void {
  const known = new Map<string, Set<string>>();
  const seeding = new Set<string>();

  createEffect(host.activeServer, (server) => {
    if (!server || server.kind === "remote" || known.has(server.id) || seeding.has(server.id)) return;
    const serverId = server.id;
    seeding.add(serverId);
    desktopWorkflowList(serverId).then(
      (summaries) => known.set(serverId, new Set(summaries.map((summary) => summary.id))),
      () => seeding.delete(serverId),
    );
  });

  const showMade = async (serverId: string, workflowId: string, agentName: string) => {
    const summary = (await desktopWorkflowList(serverId)).find((workflow) => workflow.id === workflowId);
    if (!summary || host.workflowsOnScreen()) return;
    const { t } = currentText();
    toast(t("workflow.agentMade.title", { agent: agentName }), {
      id: `agent-workflow:${serverId}:${workflowId}`,
      description: summary.title,
      action: { label: t("workflow.agentMade.open"), onClick: () => host.open({ serverId, workflowId }) },
    });
  };

  onSettled(() =>
    onDesktopWorkflowsChanged((serverId, workflowId, agentId) => {
      const ids = known.get(serverId);
      if (!ids || ids.has(workflowId)) return;
      ids.add(workflowId);
      if (agentId === undefined || serverId !== host.activeServer()?.id || host.workflowsOnScreen()) return;
      if (!agentAskedHere(serverId, agentId)) return;
      const agentName = host.agentName(agentId);
      if (agentName !== undefined) void showMade(serverId, workflowId, agentName).catch(() => undefined);
    }),
  );
}
