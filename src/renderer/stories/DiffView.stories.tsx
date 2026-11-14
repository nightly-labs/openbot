import { AgentStepList } from "@openbot/ui/features/conversation/AgentSteps";
import { ChatActionMarker } from "@openbot/ui/features/conversation/ChatActionMarker";
import { DiffView } from "@openbot/ui/features/conversation/DiffView";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

const BEFORE = `export function greet(name: string) {
  const message = "Hello, " + name;
  console.log(message);
  return message;
}

export const VERSION = 1;
`;

const AFTER = `export function greet(name: string, excited = false) {
  const message = \`Hello, \${name}\${excited ? "!" : "."}\`;
  return message;
}

export const VERSION = 2;
`;

const meta = {
  title: "Conversation/DiffView",
  component: DiffView,
  args: { name: "src/greet.ts", oldText: BEFORE, newText: AFTER },
  render: (args) => (
    <div style="padding: 24px; max-width: 760px">
      <DiffView {...args} />
    </div>
  ),
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof DiffView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An edit: changed, removed and added lines, with the old and new line numbers. */
export const Edit: Story = {};

/** A new file: every line is added. */
export const NewFile: Story = {
  args: { name: "notes.md", oldText: "", newText: "# Notes\n\n- first\n- second" },
};

/** Two equal texts. */
export const NoChanges: Story = {
  args: { oldText: BEFORE, newText: BEFORE },
};

const INSTRUCTIONS_BEFORE = `# Research

- Answer in English.
- Cite each source with a link.
- Keep answers under 200 words.
`;

const INSTRUCTIONS_AFTER = `# Research

- Answer in the language of the question.
- Cite each source with a link.
- Keep answers under 300 words.
- Put a one-line summary first.
`;

/** The chat line after a turn in which the agent changed its instruction file. Changes opens the diff. */
export const InstructionsChange: Story = {
  render: () => (
    <div style="padding: 24px">
      <ChatActionMarker
        marker={{
          kind: "instructions-change",
          agentId: "research",
          change: { before: INSTRUCTIONS_BEFORE, after: INSTRUCTIONS_AFTER },
          text: "Updated its instructions",
          timestamp: "2026-09-01T08:00:00.000Z",
        }}
        agents={STORY_AGENTS}
        onSelectAgent={fn()}
        instructions={{
          read: async () => ({ fileName: "AGENTS.md", exists: true, text: INSTRUCTIONS_AFTER }),
          save: async (_agentId, text) => ({ fileName: "AGENTS.md", exists: true, text }),
          watch: () => () => undefined,
        }}
        onOpenInstructions={fn()}
      />
    </div>
  ),
};

/** An updated memory in the agent steps: the changed words in the one text. */
export const MemoryUpdate: Story = {
  render: () => (
    <div style="padding: 24px">
      <AgentStepList
        live={false}
        steps={[
          {
            id: "m1",
            kind: "memory",
            change: {
              memoryId: "m1",
              action: "updated",
              text: "Uses the Todoist project “Work 2026” for all work tasks.",
              previousText: "Uses the Todoist project “Work” for all work tasks.",
            },
          },
        ]}
      />
    </div>
  ),
};
