import { TaskList, type TaskListItem } from "@openbot/ui/features/conversation/TaskList";
import { createSignal, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * The chat block of a plan an agent works through. The timeline shows one for each turn that
 * kept a plan with the provider's plan or todo tool.
 */

const LABELS = [
  "Read the project structure",
  "Find where the settings are saved",
  "Add the migration for the new column",
  "Update the settings panel",
  "Run the focused tests",
];

function tasks(doneCount: number, progress?: number): TaskListItem[] {
  return LABELS.map((label, index) => ({
    id: `task-${index}`,
    label,
    state: index < doneCount ? "done" : index === doneCount ? "active" : "pending",
    progress: index === doneCount ? progress : undefined,
  }));
}

const meta = {
  title: "Conversation/Task list",
  component: TaskList,
  render: (args) => (
    <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
      <TaskList {...args} />
    </main>
  ),
  args: { items: tasks(1, 0.65) },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof TaskList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {};

export const NotStarted: Story = { args: { items: tasks(-1) } };

export const Done: Story = { args: { items: tasks(LABELS.length) } };

/** The person closed the list. The header still shows the count. */
export const Collapsed: Story = { args: { defaultOpen: false } };

export const CustomTitle: Story = { args: { title: "Plan for the settings migration" } };

export const LongLabels: Story = {
  args: {
    items: [
      {
        id: "long-0",
        label: "Compare the saved workspace settings with the defaults and keep every value that the person changed",
        state: "done",
      },
      {
        id: "long-1",
        label: "Move the provider selection into the agent record so that it stays after a restart",
        state: "active",
        progress: 0.3,
      },
      { id: "long-2", label: "Remove the old settings key after the migration succeeds", state: "pending" },
    ],
  },
};

/** The agent works through the plan: each task fills, then the next one starts. The loop repeats. */
export const Live: Story = {
  render: (args) => {
    const [step, setStep] = createSignal(0);
    // Ten progress steps per task, then a pause on the finished list.
    const stepsPerTask = 10;
    const lastStep = LABELS.length * stepsPerTask + 12;
    onSettled(() => {
      const timer = window.setInterval(() => setStep((value) => (value >= lastStep ? 0 : value + 1)), 300);
      return () => window.clearInterval(timer);
    });
    const items = () => {
      const doneCount = Math.min(Math.floor(step() / stepsPerTask), LABELS.length);
      return tasks(doneCount, (step() % stepsPerTask) / stepsPerTask);
    };
    return (
      <main style={{ width: "min(560px, 100vw)", padding: "var(--openbot-space-4)" }}>
        <TaskList {...args} items={items()} />
      </main>
    );
  },
};
