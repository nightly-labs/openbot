import type { WorkflowNode } from "@openbot/contracts/ipc";
import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import { toast } from "@openbot/ui";
import { type OverviewWorkflow, WorkflowOverview } from "@openbot/ui/features/workflows/WorkflowOverview";
import { WorkflowOverviewSettings } from "@openbot/ui/features/workflows/WorkflowOverviewSettings";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, onSettled, Show, untrack } from "solid-js";
import { useAgents } from "../agents/agents-context";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { useExternalPlanUsageRows } from "../usage/external-plan-usage";
import { useWindowPage } from "../window/window-page-context";
import { createIssueStats } from "./issue-stats-source";
import { createOverviewSettingsStore, toneFromRules } from "./overview-settings";
import { WorkflowIssueStats } from "./WorkflowIssueStats";
import { desktopWorkflowHost, type WorkflowHost } from "./workflows-port";

/** How often the page reads again while it shows, for runs that change without an event. */
const POLL_MS = 5000;
/** A run sends several change events in a row; the page reads once after the last of them. */
const EVENT_DELAY_MS = 300;

/** A card as the host has it. The page names the step: an agent step by its agent. */
type CardSource = Omit<OverviewWorkflow, "step"> & {
  step: { node: WorkflowNode | undefined; agentId: string | null } | null;
};

/**
 * Every workflow of one server on a page of its own: what runs now and at what step, when each
 * scheduled one runs next, and Run and Stop on each card. It reads the host on its own, so the
 * Workflows page keeps its canvas. A card's name opens that workflow on the Workflows page.
 */
export function AllWorkflowsPage(props: { serverId: string }) {
  const { t } = useText();
  const { servers } = useServers();
  const server = () => servers().find((entry) => entry.id === props.serverId);
  const supported = () => {
    const entry = server();
    return !entry || entry.kind === "local" || serverSupportsCapability(entry, WORKFLOWS_CAPABILITY);
  };
  return (
    <Show
      when={supported() ? props.serverId : null}
      keyed
      fallback={
        <main class="window-page diagram-view diagram-flows-notice">
          <p>{t("error.workflow.serverTooOld")}</p>
        </main>
      }
    >
      {(serverId) => <AllWorkflows host={desktopWorkflowHost(serverId, server)} />}
    </Show>
  );
}

function AllWorkflows(props: { host: WorkflowHost }) {
  const { t, errorMessage } = useText();
  const { agentList } = useAgents();
  const windowPage = useWindowPage();
  const settings = createOverviewSettingsStore();
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const usageRows = useExternalPlanUsageRows();
  const issues = createIssueStats(() => settings.settings().project);
  // The keyed parent mounts a new page for each server, so the host does not change.
  const host = untrack(() => props.host);
  const report = (error: unknown) => {
    toast.error(errorMessage(error, t("workflow.page.failed")));
  };

  /** Undefined until the first read returns. */
  const [cards, setCards] = createSignal<readonly CardSource[] | undefined>();
  /** Workflows whose Run was pressed and whose call has not returned yet. */
  const [starting, setStarting] = createSignal<ReadonlySet<string>>(new Set<string>());
  let disposed = false;
  /** Counts the reads, so that an older read does not replace a newer one. */
  let request = 0;
  /** When the last read started, so the poll skips a read that an event just made. */
  let lastRead = 0;

  /** Reads every workflow with its trigger state and newest run. */
  const read = async () => {
    const mine = ++request;
    lastRead = Date.now();
    const list = await host.workflows.list();
    const rows = await Promise.all(
      list.map(async (summary): Promise<CardSource> => {
        const [detail, page] = await Promise.all([
          host.workflows.get(summary.id),
          host.workflows.runs({ workflowId: summary.id, limit: 1 }),
        ]);
        const triggerNode = detail.graph.nodes.find((node) => node.kind === "trigger");
        const trigger = detail.triggers.find((state) => state.nodeId === triggerNode?.id) ?? detail.triggers[0];
        const latest = page.runs[0];
        const active = latest?.steps.find((step) => step.status === "running" || step.status === "approval");
        return {
          id: summary.id,
          title: summary.title,
          steps: summary.steps,
          trigger: trigger?.type ?? "manual",
          nextDueAt: trigger?.nextDueAt ?? null,
          run: latest
            ? {
                id: latest.run.id,
                number: latest.run.number,
                status: latest.run.status,
                startedAt: latest.run.startedAt,
                endedAt: latest.run.endedAt,
              }
            : null,
          step: active
            ? { node: detail.graph.nodes.find((node) => node.id === active.nodeId), agentId: active.agentId }
            : null,
        };
      }),
    );
    if (!disposed && mine === request) setCards(rows);
  };

  onSettled(() => {
    read().catch(report);
    let pending: ReturnType<typeof setTimeout> | undefined;
    const stop = host.onChanged(() => {
      clearTimeout(pending);
      pending = setTimeout(() => read().catch(report), EVENT_DELAY_MS);
    });
    // A failed poll stays quiet: the next one reads again, and an event read shows its error.
    const timer = setInterval(() => {
      if (!document.hidden && Date.now() - lastRead >= POLL_MS / 2) read().catch(() => undefined);
    }, POLL_MS);
    return () => {
      disposed = true;
      stop();
      clearTimeout(pending);
      clearInterval(timer);
    };
  });

  /** An agent step by its agent's name, another step by its kind. */
  const stepName = (step: CardSource["step"]): string | null => {
    if (!step) return null;
    const agentId = step.agentId ?? (step.node?.kind === "agent" ? step.node.fields.agentId : undefined);
    const agent = typeof agentId === "string" ? agentList().find((entry) => entry.id === agentId) : undefined;
    if (agent) return agent.name;
    switch (step.node?.kind) {
      case "agent":
        return t("workflow.agent.title");
      case "approval":
        return t("workflow.approval.title");
      case "condition":
        return t("workflow.condition.title");
      case "llm":
        return t("workflow.llm.title");
      case "output":
        return t("workflow.output.title");
      default:
        return step.node?.kind ?? null;
    }
  };
  const shown = createMemo<readonly OverviewWorkflow[]>(() =>
    (cards() ?? []).map((card) => {
      const step = stepName(card.step);
      return { ...card, step, tone: toneFromRules(settings.settings().colorRules, card.title, step ?? "") };
    }),
  );

  const run = (workflowId: string) => {
    setStarting((ids) => new Set(ids).add(workflowId));
    host.workflows
      .startRun({ workflowId, requestId: crypto.randomUUID() })
      .catch(report)
      .finally(() => {
        setStarting((ids) => {
          const next = new Set(ids);
          next.delete(workflowId);
          return next;
        });
        read().catch(report);
      });
  };
  const stop = (runId: string) => {
    host.workflows
      .stopRun(runId)
      .catch(report)
      .finally(() => read().catch(report));
  };

  const usageRowsForSettings = () =>
    usageRows().map((row) => ({
      id: row.accountId ?? row.name,
      name: row.name,
      summary: row.windows.map((window) => `${window.label} ${Math.round(window.remainingPercent)}%`).join(", "),
    }));

  return (
    <>
      <WorkflowOverview
        workflows={shown()}
        starting={starting()}
        loading={cards() === undefined}
        readOnly={false}
        onOpen={(workflowId) => windowPage.openWorkflows(null, workflowId)}
        onRun={run}
        onStop={stop}
        onSettings={() => setSettingsOpen(true)}
        top={<WorkflowIssueStats stats={issues.stats()} error={issues.error()} loading={issues.loading()} />}
      />
      <WorkflowOverviewSettings
        open={settingsOpen()}
        onOpenChange={setSettingsOpen}
        project={settings.settings().project}
        onProjectChange={settings.setProject}
        reportedProject={issues.stats()?.repo ?? null}
        colorRules={settings.settings().colorRules}
        onColorRulesChange={settings.setColorRules}
        usageRows={usageRowsForSettings()}
        hiddenUsageRows={settings.settings().hiddenUsageRows}
        onHiddenUsageRowsChange={settings.setHiddenUsageRows}
      />
    </>
  );
}
