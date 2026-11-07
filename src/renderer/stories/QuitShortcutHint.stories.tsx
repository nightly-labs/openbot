import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { QuitShortcutHintView } from "../src/features/window/QuitShortcutHint";
import { STORY_AGENT_SUMMARIES } from "../src/preview/fixtures";

const meta = {
  title: "Window/Quit shortcut hint",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** One agent works, so the first `Cmd + Q` shows its name. */
export const OneAgent: Story = { render: () => <QuitShortcutHintView agents={STORY_AGENT_SUMMARIES.slice(0, 1)} /> };

/** Two agents work. */
export const TwoAgents: Story = { render: () => <QuitShortcutHintView agents={STORY_AGENT_SUMMARIES.slice(0, 2)} /> };

/** Every agent works. The pill shows three faces and names them all. */
export const ManyAgents: Story = { render: () => <QuitShortcutHintView agents={STORY_AGENT_SUMMARIES} /> };
