import { AgentActivityIndicator } from "@openbot/ui/features/conversation/AgentActivity";
import { type AgentStep, AgentStepsDisclosure } from "@openbot/ui/features/conversation/AgentSteps";
import { createSignal, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

const STEPS: AgentStep[] = [
  {
    id: "t1",
    kind: "thinking",
    text: "The user wants this week planned. I check what I already know about their routine first.",
  },
  { id: "p1", kind: "progress", text: "Searching its memories…" },
  { id: "p2", kind: "progress", text: "Searched its memories: 3 found" },
  { id: "p3", kind: "progress", text: "Using the skill todoist-cli…" },
  { id: "p4", kind: "progress", text: "Gathering the relevant information…" },
  { id: "p5", kind: "progress", text: "Reviewing the information I gathered…" },
  {
    id: "t2",
    kind: "thinking",
    text: "Two tasks are overdue. Friday has no meetings, so the deep-work block fits there.",
  },
  { id: "p6", kind: "progress", text: "Updating its memories…" },
];

const MEMORY: AgentStep[] = [
  {
    id: "m1",
    kind: "memory",
    change: { memoryId: "m1", action: "saved", text: "Keeps mornings (8–11) for writing. No meetings before 11." },
  },
  {
    id: "m2",
    kind: "memory",
    change: {
      memoryId: "m2",
      action: "updated",
      text: "Uses the Todoist project “Work 2026” for all work tasks.",
      previousText: "Uses the Todoist project “Work” for all work tasks.",
    },
  },
  {
    id: "m3",
    kind: "memory",
    change: { memoryId: "m3", action: "forgotten", text: "Prefers plans as one long bulleted list." },
  },
  {
    id: "m4",
    kind: "memory",
    change: { memoryId: "m4", action: "notChanged", text: "Sends the weekly report on Friday at 16:00." },
  },
];

const meta = {
  title: "Conversation/AgentSteps",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  render: () => {
    const [shown, setShown] = createSignal(1);
    onSettled(() => {
      const timer = window.setInterval(() => setShown((count) => (count >= STEPS.length ? 1 : count + 1)), 1_000);
      return () => window.clearInterval(timer);
    });
    return (
      <div style={{ width: "640px" }}>
        <AgentActivityIndicator
          agent={STORY_AGENTS[0]}
          label="Working on it…"
          detail="Gathering the relevant information…"
          steps={STEPS.slice(0, shown())}
          stepsOpenByDefault
        />
      </div>
    );
  },
};

export const RunningClosed: Story = {
  render: () => (
    <div style={{ width: "640px" }}>
      <AgentActivityIndicator
        agent={STORY_AGENTS[0]}
        label="Working on it…"
        detail="Gathering the relevant information…"
        steps={STEPS}
      />
    </div>
  ),
};

export const Finished: Story = {
  render: () => (
    <div style={{ width: "640px" }}>
      <AgentStepsDisclosure
        steps={[...STEPS, ...MEMORY]}
        defaultOpen={false}
        facts={{ durationMs: 74_000, failed: 1 }}
      />
    </div>
  ),
};

export const FinishedOpen: Story = {
  render: () => (
    <div style={{ width: "640px" }}>
      <AgentStepsDisclosure steps={[...STEPS, ...MEMORY]} defaultOpen />
    </div>
  ),
};

export const MemoryCountOnly: Story = {
  render: () => (
    <div style={{ width: "640px" }}>
      <AgentStepsDisclosure
        steps={[{ id: "s", kind: "memory-summary", text: "Memory: 2 saved, 0 updated, 1 forgotten." }]}
        defaultOpen
      />
    </div>
  ),
};

export const FailedSteps: Story = {
  render: () => (
    <div style={{ width: "640px" }}>
      <AgentStepsDisclosure
        steps={[
          { id: "p1", kind: "progress", text: "Working through the next tool-assisted step…" },
          {
            id: "p2",
            kind: "progress",
            text: "A tool step failed; reviewing the result and deciding what to try next…",
            error:
              "Error: ENOENT: no such file or directory, open '/Users/me/project/config/settings.json'\n    at Object.openSync (node:fs:573:3)",
          },
          { id: "p3", kind: "progress", text: "Working through the next tool-assisted step…" },
          {
            id: "p4",
            kind: "progress",
            text: "A tool step failed; reviewing the result and deciding what to try next…",
            error: "npm ERR! code E404\nnpm ERR! 404 Not Found - GET https://registry.npmjs.org/@acme%2fwidgets",
          },
        ]}
        defaultOpen
        facts={{ durationMs: 42_000, failed: 2 }}
      />
    </div>
  ),
};
