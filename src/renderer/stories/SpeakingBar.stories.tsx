import { SpeakingBar } from "@openbot/ui/features/conversation/SpeakingBar";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT } from "./fixtures";

const LEVELS = [
  0, 0.1, 0.3, 0.5, 0.2, 0.6, 0.8, 0.4, 0.2, 0.5, 0.7, 0.3, 0.1, 0.4, 0.6, 0.9, 0.5, 0.3, 0.2, 0.4, 0.6, 0.3, 0.1, 0,
];

const meta = {
  title: "Conversation/SpeakingBar",
  component: SpeakingBar,
  args: {
    agent: STORY_AGENT,
    caption: "Start with the one change a reader can try today, then say why it matters.",
    levels: LEVELS,
    onStop: fn(),
  },
  render: (args) => (
    <div class="composer-wrap" style="width: 720px; padding-top: 24px">
      <SpeakingBar {...args} />
    </div>
  ),
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof SpeakingBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Speaking: Story = {};

/** The first part is synthesized; the voice has not started yet. */
export const Starting: Story = { args: { levels: new Array(24).fill(0) } };
