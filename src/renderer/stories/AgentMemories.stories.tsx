import type { AgentMemory } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AgentMemoriesSettings } from "../src/features/conversation/AgentMemoriesSettings";
import { agentMemoriesPort } from "../src/features/conversation/memories-port";
import { createMockOpenBot } from "./mock-openbot";

function memory(id: string, text: string, origin: AgentMemory["origin"], updatedAt: string): AgentMemory {
  return {
    id,
    agentId: "chief",
    text,
    origin,
    sourceTurnId: origin === "automatic" ? `turn-${id}` : null,
    createdAt: updatedAt,
    updatedAt,
  };
}

const chiefMemories: AgentMemory[] = [
  memory(
    "away",
    "Away mode: the user is often away during routine passes. Queue handoffs and questions in questions.md in the workspace instead of waiting for a reply. When the user comes back, list the open questions first, then the results.",
    "manual",
    "2026-10-29T08:10:00.000Z",
  ),
  memory(
    "x-workflow",
    'X workflow: read mentions only through the "Mentions Monitor" deck. Go by time: skip everything before last_pass in replied.log (Warsaw time). Reply only to items addressed to the user; skip quote posts, giveaways and replies to other accounts.',
    "automatic",
    "2026-10-28T19:42:00.000Z",
  ),
  memory(
    "updates",
    "The user prefers short progress updates with the result first.",
    "automatic",
    "2026-10-27T11:05:00.000Z",
  ),
  memory("bun", "Use Bun for package scripts.", "manual", "2026-10-24T14:30:00.000Z"),
  memory("brief", "Send the morning brief at 7:00 on weekdays.", "automatic", "2026-10-21T07:02:00.000Z"),
  memory(
    "invoices",
    "Weekly invoice export: download the CSV from Stripe on Mondays, rename it to invoices-YYYY-MM-DD.csv, and put it in Finance/Exports. Tell the user when a refund appears in the export.",
    "automatic",
    "2026-10-19T10:15:00.000Z",
  ),
  memory(
    "changelog",
    "Release notes go in changelog.d/<branch>.md, not in CHANGELOG.md.",
    "automatic",
    "2026-10-16T16:20:00.000Z",
  ),
  memory(
    "staging",
    "Deploy to staging first and wait for the smoke check before production.",
    "automatic",
    "2026-10-12T13:48:00.000Z",
  ),
];

const fullMemoryList: AgentMemory[] = Array.from({ length: 64 }, (_, index) =>
  memory(
    `memory-${index + 1}`,
    `Working preference ${index + 1}: keep the result clear and concise.`,
    index % 3 === 0 ? "manual" : "automatic",
    "2026-08-24T14:30:00.000Z",
  ),
);

function AgentMemoriesStory(props: { memories: AgentMemory[]; width: number; limit?: number }) {
  const mock = createMockOpenBot({ memories: { chief: props.memories } });
  const port = agentMemoriesPort("chief", "Chief", props.limit ?? 200, mock.api.agent);
  onCleanup(() => mock.dispose());

  return (
    <main
      class="agent-memories-story-stage"
      style={{ display: "flex", width: `${props.width}px`, height: "100vh", "flex-direction": "column" }}
    >
      <AgentMemoriesSettings port={port} open onBack={fn()} onClose={fn()} onCountChange={fn()} />
    </main>
  );
}

const meta = {
  title: "Settings/Agent Memories",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Memories page in the agent pane. A title opens the memory on its own page. */
export const List: Story = {
  render: () => <AgentMemoriesStory memories={chiefMemories} width={380} />,
};

/** A wide pane keeps the page in a centered column. */
export const WidePane: Story = {
  render: () => <AgentMemoriesStory memories={chiefMemories} width={1100} />,
};

export const FullList: Story = {
  render: () => <AgentMemoriesStory memories={fullMemoryList} width={380} />,
};

/** At the cap, the limit note takes the place of the New memory row. */
export const AtLimit: Story = {
  render: () => <AgentMemoriesStory memories={chiefMemories} width={380} limit={chiefMemories.length} />,
};

export const EmptyState: Story = {
  render: () => <AgentMemoriesStory memories={[]} width={380} />,
};
