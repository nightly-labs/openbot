import { AgentUpdateDialog } from "@openbot/ui/features/marketplace/AgentUpdateDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/** Dr. Eggbot's six skills, by the names of the production catalog. */
const SKILLS = [
  { skillId: "agent-designer", name: "Agent Designer" },
  { skillId: "eggbot-getting-started", name: "Eggbot Getting Started" },
  { skillId: "routine-healthcheck", name: "Routine Healthcheck" },
  { skillId: "agent-chat-healthcheck", name: "Agent Chat Healthcheck" },
  { skillId: "working-with-teammate-agents", name: "Working With Teammate Agents" },
  { skillId: "pstack", name: "pstack" },
];

const args: Parameters<typeof AgentUpdateDialog>[0] = {
  agentName: "Dr. Eggbot",
  changed: SKILLS.filter((skill) => skill.skillId === "agent-designer" || skill.skillId === "pstack"),
  othersCount: SKILLS.length - 2,
  onCancel: fn(),
  onConfirm: fn(),
};

const meta = {
  title: "Marketplace/AgentUpdateDialog",
  component: AgentUpdateDialog,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof AgentUpdateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two skills with local changes; the other four fold into one line. */
export const Default: Story = {};

/** Every skill has local changes: the list scrolls, with a fade at the hidden edge. */
export const AllChanged: Story = { args: { changed: SKILLS, othersCount: 0 } };
