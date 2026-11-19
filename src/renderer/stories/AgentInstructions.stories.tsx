import type { AgentInstructionFileName, AgentInstructionsFile } from "@openbot/contracts/ipc";
import {
  type AgentInstructionsCalls,
  AgentInstructionsView,
} from "@openbot/ui/features/conversation/AgentInstructionsView";
import { untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const RULES = `# Chief

## Work
- Give the result first, then the steps.
- Ask before you send an email or a message for the user.
- Keep handoffs and open questions in questions.md in the workspace.

## Releases
- Release notes go in changelog.d/<branch>.md, not in CHANGELOG.md.
- Deploy to staging first and wait for the smoke check before production.

## Finance
- Download the Stripe CSV on Mondays and put it in Finance/Exports.
- Tell the user when a refund appears in the export.
`;

const FOLDER = "/Users/alex/OpenBot/Agents/Chief";

function storyCalls(fileName: AgentInstructionFileName, text: string): AgentInstructionsCalls {
  let file: AgentInstructionsFile = { fileName, exists: text !== "", text };
  return {
    read: async () => file,
    save: async (_agentId, next) => {
      file = { fileName, exists: true, text: next };
      return file;
    },
    watch: () => () => undefined,
    openLink: fn(),
    reveal: fn(async () => undefined),
  };
}

function InstructionsStory(props: { fileName: AgentInstructionFileName; text: string; width: number }) {
  const calls = untrack(() => storyCalls(props.fileName, props.text));
  return (
    <main
      class="agent-memories-story-stage"
      style={{ display: "flex", width: `${props.width}px`, height: "100vh", "flex-direction": "column" }}
    >
      <AgentInstructionsView
        agentId="chief"
        folder={FOLDER}
        working={false}
        calls={calls}
        onBack={fn()}
        onClose={fn()}
      />
    </main>
  );
}

const meta = {
  title: "Settings/Agent Instructions",
  component: InstructionsStory,
  args: { fileName: "AGENTS.md", text: RULES, width: 360 },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof InstructionsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const ClaudeFile: Story = { args: { fileName: "CLAUDE.md" } };
export const Empty: Story = { args: { text: "" } };
export const Wide: Story = { args: { width: 640 } };
