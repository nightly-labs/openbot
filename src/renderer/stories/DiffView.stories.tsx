import { DiffView } from "@openbot/ui/features/conversation/DiffView";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

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
