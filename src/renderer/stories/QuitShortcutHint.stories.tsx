import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { QuitShortcutHintView } from "../src/features/window/QuitShortcutHint";
import { STORY_AGENT_SUMMARIES } from "../src/preview/fixtures";

const meta = {
  title: "Window/Quit shortcut hint",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneAgent: Story = { render: () => <QuitShortcutHintView agents={STORY_AGENT_SUMMARIES.slice(0, 1)} /> };

export const TwoAgents: Story = { render: () => <QuitShortcutHintView agents={STORY_AGENT_SUMMARIES.slice(0, 2)} /> };

export const ManyAgents: Story = { render: () => <QuitShortcutHintView agents={STORY_AGENT_SUMMARIES} /> };

export const NoAgents: Story = { render: () => <QuitShortcutHintView agents={[]} /> };
