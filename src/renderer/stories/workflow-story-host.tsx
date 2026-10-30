/**
 * The story hosts of the workflow canvas. The canvas is a controlled component: these hosts keep its
 * workflow, its runs and its versions in the preview mock (`mockWorkflows`), as the desktop host keeps
 * them in the database, and use the controller of the Workflows page over it.
 *
 * The runs and versions of a story fixture are history that the mock does not know. The host shows
 * them below the runs and versions of the mock. Retry on a step of a fixture run starts a new run
 * from that node; a fixture run has no open step to stop or to decide.
 */

import {
  WORKFLOW_NODE_KINDS,
  WORKFLOW_OUTPUT_TARGETS,
  WORKFLOW_TRIGGER_TYPES,
  type WorkflowRunPage,
  type WorkflowVersion,
} from "@openbot/contracts/ipc";
import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import type { SidebarView } from "@openbot/ui/features/sidebar/sidebar-types";
import { HelpMenu } from "@openbot/ui/features/updates/HelpMenu";
import { PageRail, type PageRailPage } from "@openbot/ui/features/window/PageRail";
import { WorkflowCanvas } from "@openbot/ui/features/workflows/WorkflowCanvas";
import { WORKFLOW_FEATURES_V1, type WorkflowFeatures } from "@openbot/ui/features/workflows/workflow-model";
import type { WorkflowRunView } from "@openbot/ui/features/workflows/workflow-run-view";
import { createSignal, Show, untrack } from "solid-js";
import { fn } from "storybook/test";
import { defaultSidebarLayout } from "../src/features/sidebar/sidebar-sections";
import { createWorkflowsController } from "../src/features/workflows/workflows-controller";
import type { WorkflowHost } from "../src/features/workflows/workflows-port";
import { mockWorkflows } from "../src/preview/mock-workflows";
import { STORY_AGENTS } from "./fixtures";
import { STORY_CATALOGS, type StoryWorkflow } from "./workflow-story-data";

/** Every node kind, trigger and output, for the stories whose workflows use them all. */
export const STORY_ALL_FEATURES: WorkflowFeatures = {
  kinds: WORKFLOW_NODE_KINDS,
  triggers: WORKFLOW_TRIGGER_TYPES,
  outputs: WORKFLOW_OUTPUT_TARGETS,
  uploads: true,
  presence: false,
};

const newestFirst = (left: string | null, right: string | null) => (right ?? "").localeCompare(left ?? "");

/** The runs of the mock above the fixture runs. A mock run takes the numbers after the fixture runs. */
function mergeRuns(fixture: WorkflowRunView | undefined, live: WorkflowRunPage): WorkflowRunPage {
  if (!fixture) return live;
  const offset = Math.max(0, ...fixture.runs.map((entry) => entry.run.number));
  const renumbered = live.runs.map((entry) => ({ ...entry, run: { ...entry.run, number: entry.run.number + offset } }));
  return {
    runs: [...renumbered, ...fixture.runs].sort((left, right) => newestFirst(left.run.startedAt, right.run.startedAt)),
    soloSteps: [...live.soloSteps, ...fixture.soloSteps].sort((left, right) =>
      newestFirst(left.startedAt, right.startedAt),
    ),
    nextBefore: live.nextBefore,
  };
}

/**
 * A host over the preview mock that also shows the fixture history of `workflows`. The mock lists
 * the newest workflow first, so the seeds are older in story order and the first one opens.
 */
function storyWorkflowHost(workflows: readonly StoryWorkflow[]): WorkflowHost {
  const fixtures = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  const fixtureRuns = new Set(workflows.flatMap((workflow) => workflow.runs?.runs ?? []).map((entry) => entry.run.id));
  const fixtureSteps = new Map(
    workflows
      .flatMap((workflow) => [
        ...(workflow.runs?.runs.flatMap((entry) => entry.steps) ?? []),
        ...(workflow.runs?.soloSteps ?? []),
      ])
      .map((step) => [step.id, step]),
  );
  const fixtureVersion = (workflowId: string, versionId: string) =>
    fixtures.get(workflowId)?.versions?.find(({ version }) => version.id === versionId);
  const listeners = new Set<(workflowId: string | null) => void>();
  const now = Date.now();
  const api = mockWorkflows(
    workflows.map(({ id, title, graph }, index) => ({
      id,
      title,
      graph,
      updatedAt: new Date(now - index * 60_000).toISOString(),
    })),
    (workflowId) => {
      for (const listener of listeners) listener(workflowId);
    },
  );
  return {
    workflows: {
      ...api,
      list: async () =>
        (await api.list()).map((summary) => {
          const newest = fixtures.get(summary.id)?.runs?.runs[0]?.run;
          if (summary.lastRun || !newest) return summary;
          return { ...summary, lastRun: { status: newest.status, at: newest.startedAt } };
        }),
      runs: async (input) => mergeRuns(fixtures.get(input.workflowId)?.runs, await api.runs(input)),
      versions: async (workflowId) => {
        const fixture = fixtures.get(workflowId)?.versions ?? [];
        return [...(await api.versions(workflowId)), ...fixture.map(({ version }) => version)].sort(
          (left: WorkflowVersion, right: WorkflowVersion) => newestFirst(left.at, right.at),
        );
      },
      versionGraph: async (input) =>
        fixtureVersion(input.workflowId, input.versionId)?.graph ?? (await api.versionGraph(input)),
      restoreVersion: async (input) => {
        const fixture = fixtureVersion(input.workflowId, input.versionId);
        if (!fixture) return api.restoreVersion(input);
        // The mock does not know a fixture version, so its graph is saved as a new revision.
        const latest = await api.get(input.workflowId);
        const result = await api.saveGraph({
          workflowId: input.workflowId,
          baseRevision: latest.revision,
          graph: fixture.graph,
        });
        return result.ok ? api.get(input.workflowId) : result.conflict;
      },
      stopStep: async (stepId) => {
        if (!fixtureSteps.has(stepId)) await api.stopStep(stepId);
      },
      stopRun: async (runId) => {
        if (!fixtureRuns.has(runId)) await api.stopRun(runId);
      },
      retryStep: async (input) => {
        const fixture = fixtureSteps.get(input.stepId);
        if (!fixture) return api.retryStep(input);
        const started = await api.startRun({
          workflowId: fixture.workflowId,
          requestId: input.requestId,
          fromNodeId: fixture.nodeId,
        });
        return started.steps.find((step) => step.nodeId === fixture.nodeId) ?? fixture;
      },
      decide: async (input) => {
        if (!fixtureSteps.has(input.stepId)) await api.decide(input);
      },
    },
    onChanged(changed) {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
    places: async () => [...STORY_CATALOGS.places],
    agentLevels: async () => null,
  };
}

/** A canvas over the preview mock that opens the first of `workflows`. */
export function WorkflowStory(props: { workflows: readonly StoryWorkflow[]; features?: WorkflowFeatures }) {
  const story = createWorkflowsController(storyWorkflowHost(untrack(() => props.workflows)));
  const features = () => props.features ?? WORKFLOW_FEATURES_V1;
  return (
    <Show when={story.detail()}>
      {(workflow) => (
        <WorkflowCanvas workflow={workflow()} features={features()} catalogs={STORY_CATALOGS} {...story.props} />
      )}
    </Show>
  );
}

const usageRows = accountUsageProviderRows(null);

/**
 * The workflow canvas in the desktop window: the page rail and the server menu are the real app
 * components. The canvas is a page that covers the agent list, as the schedule, usage and Marketplace
 * pages do. Its bar goes in the window's top row after the server menu, and the canvas fills the card.
 */
export function WorkflowInAppStory(props: { workflows: readonly StoryWorkflow[]; features?: WorkflowFeatures }) {
  const story = createWorkflowsController(storyWorkflowHost(untrack(() => props.workflows)));
  const features = () => props.features ?? WORKFLOW_FEATURES_V1;
  const [page, setPage] = createSignal<PageRailPage | null>("routines");
  const [view, setView] = createSignal<SidebarView>("routines");
  return (
    <div class="app-window wfn-app">
      <PageRail
        hidden={false}
        current={page()}
        pinned={["routines", "workflows", "usage"]}
        onPinChange={fn()}
        usageRows={usageRows}
        onAgents={() => setPage("agents")}
        onRoutines={() => setPage("routines")}
        onSchedule={() => setPage("schedule")}
        onUsage={() => setPage("usage")}
        onMarketplace={fn()}
        onSettings={() => setPage("settings")}
        help={
          <HelpMenu
            news={[]}
            triggerClass="window-rail-button"
            onOpenWhatsNew={fn()}
            onOpenChangelog={fn()}
            onOpenGuides={fn()}
            onOpenDiscord={fn()}
            onSendFeedback={fn()}
          />
        }
      />
      <div
        class="app-frame app-frame-edge app-frame-platform-darwin"
        data-window-page-kind="titled"
        style="--left-panel-width: 280px"
      >
        <Sidebar
          serverName="Local"
          onOpenServerSettings={fn()}
          agents={STORY_AGENTS}
          activeAgentId=""
          people={[]}
          directThreads={[]}
          activeDirectMemberId={null}
          agentStates={{}}
          agentMoods={{}}
          layout={defaultSidebarLayout()}
          collapsedSectionIds={[]}
          onMutateLayout={fn(async () => undefined)}
          onToggleSection={fn()}
          pinnedItems={[]}
          peopleOrder={[]}
          onPin={fn()}
          onUnpin={fn()}
          onReorderPinned={fn()}
          onReorderPeople={fn()}
          onSelectAgent={fn()}
          onSelectPerson={fn()}
          onCreateAgent={fn()}
          onEditAgent={fn()}
          onDeleteAgent={async () => undefined}
          compact={false}
          onExpand={fn()}
          onOpenSearch={fn()}
          onOpenMarketplace={fn()}
          channels={[]}
          onSelectChannel={fn()}
          onCreateChannel={fn()}
          view={view()}
          onViewChange={setView}
        />
        <div class="window-page wfn-app-pane">
          <Show when={story.detail()}>
            {(workflow) => (
              <WorkflowCanvas
                workflow={workflow()}
                features={features()}
                catalogs={STORY_CATALOGS}
                frame="window"
                {...story.props}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
