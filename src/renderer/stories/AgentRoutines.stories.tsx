import type { Routine, RoutineRun } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AgentRoutinesSettings } from "../src/features/conversation/AgentRoutinesSettings";
import AgentSettingsPanel from "../src/features/conversation/AgentSettingsPanel";
import { agentRoutinesPort } from "../src/features/conversation/routines-port";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_MODELS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

const morningBrief: Routine = {
  id: "routine-morning-brief",
  agentId: "chief",
  name: "Morning brief",
  instruction: "Summarize the important market and product changes since yesterday.",
  active: true,
  timezone: "Europe/Warsaw",
  trigger: {
    id: "trigger-weekdays",
    routineId: "routine-morning-brief",
    schedule: { kind: "weekdays", time: "07:00" },
    nextRunAt: "2026-08-26T05:00:00.000Z",
    createdAt: "2026-08-25T09:00:00.000Z",
    updatedAt: "2026-08-25T09:00:00.000Z",
  },
  createdAt: "2026-08-25T09:00:00.000Z",
  updatedAt: "2026-08-25T09:00:00.000Z",
};

const weeklyPlanning: Routine = {
  id: "routine-weekly-planning",
  agentId: "chief",
  name: "Weekly planning",
  instruction: "Review open work and prepare the priorities for next week.",
  active: false,
  timezone: "Europe/Warsaw",
  trigger: {
    id: "trigger-weekly-planning",
    routineId: "routine-weekly-planning",
    schedule: { kind: "weekly", weekday: 5, time: "16:00" },
    nextRunAt: "2026-08-28T14:00:00.000Z",
    createdAt: "2026-08-25T09:00:00.000Z",
    updatedAt: "2026-08-25T09:00:00.000Z",
  },
  createdAt: "2026-08-25T09:00:00.000Z",
  updatedAt: "2026-08-25T09:00:00.000Z",
};

const storyRoutines = [morningBrief, weeklyPlanning];

const fullPanelRuns: RoutineRun[] = [
  storyRun("run-today", "succeeded", "scheduled", 0),
  storyRun("run-manual", "needs-attention", "manual", 4),
  storyRun("run-yesterday", "failed", "scheduled", 28),
];

function RoutinesStory(props: { routines?: Routine[]; runs?: RoutineRun[] }) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({ routines: { chief: props.routines ?? storyRoutines } });
  window.openbot = mock.api;
  if (props.runs) mock.api.agent.listRoutineRuns = async () => structuredClone(props.runs ?? []);
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
  return (
    <main style={{ width: "380px", height: "720px", overflow: "auto", background: "var(--openbot-bg-canvas)" }}>
      <AgentRoutinesSettings port={agentRoutinesPort("chief")} onCountChange={fn()} onBack={fn()} onClose={fn()} />
    </main>
  );
}

function FullSettingsPanelStory() {
  const previousApi = window.openbot;
  const previousWidth = window.localStorage.getItem("openbot:settings-panel-width");
  const mock = createMockOpenBot({ routines: { chief: storyRoutines } });
  window.openbot = mock.api;
  mock.api.agent.listRoutineRuns = async (input) =>
    input.routineId === morningBrief.id ? structuredClone(fullPanelRuns) : [];
  window.localStorage.setItem("openbot:settings-panel-width", "380");

  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
    if (previousWidth === null) {
      window.localStorage.removeItem("openbot:settings-panel-width");
      return;
    }
    window.localStorage.setItem("openbot:settings-panel-width", previousWidth);
  });

  return (
    <main class="agent-memories-story-stage">
      <AgentSettingsPanel
        onOpenUsage={fn()}
        agent={STORY_AGENT}
        runtimeSettings={{
          provider: STORY_AGENT.provider,
          model: STORY_AGENT.model,
          reasoningEffort: STORY_AGENT.reasoningEffort,
        }}
        agentStatus={STORY_AGENT_STATUS}
        modelOptions={STORY_MODELS}
        working={false}
        maxWidth={() => 640}
        onClose={fn()}
        onWidthChange={fn()}
        onUpdateAgent={async (agentId, updates) => {
          await mock.api.agent.updateAgent({ agentId, ...updates });
        }}
        onUpdateRuntimeSettings={async (agentId, _settings, updates) => {
          await mock.api.agent.updateAgent({ agentId, ...updates });
          return true;
        }}
        onSetAgentAvatar={async (agentId, image) => {
          await mock.api.agent.setAvatar({ agentId, image });
        }}
      />
    </main>
  );
}

const meta = {
  title: "Settings/Agent Routines",
  component: AgentRoutinesSettings,
  args: { port: agentRoutinesPort("chief"), onCountChange: fn() },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof AgentRoutinesSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RoutineList: Story = {
  render: () => <RoutinesStory />,
};

export const EmptyDraft: Story = {
  render: () => <RoutinesStory routines={[]} />,
};

const runStatuses: RoutineRun["status"][] = [
  "queued",
  "running",
  "needs-attention",
  "succeeded",
  "failed",
  "interrupted",
  "cancelled",
];

export const RunHistoryStatuses: Story = {
  render: () => (
    <RoutinesStory
      runs={runStatuses.map((status, index) => ({
        id: `run-${status}`,
        routineId: morningBrief.id,
        agentId: morningBrief.agentId,
        triggerId: morningBrief.trigger.id,
        kind: index === 0 ? "manual" : "scheduled",
        scheduledFor: new Date(Date.now() - index * 3_600_000).toISOString(),
        routineName: morningBrief.name,
        instruction: morningBrief.instruction,
        deliveryId: `delivery-${status}`,
        status,
        error: status === "failed" ? "Example failure" : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }))}
    />
  ),
};

export const FullSidePanel: Story = {
  render: () => <FullSettingsPanelStory />,
  parameters: { layout: "fullscreen" },
};

function storyRun(id: string, status: RoutineRun["status"], kind: RoutineRun["kind"], hoursAgo: number): RoutineRun {
  const scheduledFor = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return {
    id,
    routineId: morningBrief.id,
    agentId: morningBrief.agentId,
    triggerId: kind === "manual" ? null : morningBrief.trigger.id,
    kind,
    scheduledFor,
    routineName: morningBrief.name,
    instruction: morningBrief.instruction,
    deliveryId: `delivery-${id}`,
    status,
    error: status === "failed" ? "The agent could not complete this run." : null,
    createdAt: scheduledFor,
    updatedAt: scheduledFor,
  };
}
