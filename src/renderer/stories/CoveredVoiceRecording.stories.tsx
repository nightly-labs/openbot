import { CoveredVoiceRecording } from "@openbot/ui/features/conversation/VoiceRecordingMorph";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const LEVELS = [
  0, 0.1, 0.3, 0.5, 0.2, 0.6, 0.8, 0.4, 0.2, 0.5, 0.7, 0.3, 0.1, 0.4, 0.6, 0.9, 0.5, 0.3, 0.2, 0.4, 0.6, 0.3, 0.1, 0,
];

const meta = {
  title: "Conversation/CoveredVoiceRecording",
  component: CoveredVoiceRecording,
  args: { levels: LEVELS, elapsedSeconds: 7, onCancel: fn(), onFinish: fn() },
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof CoveredVoiceRecording>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Recording: Story = {};

export const Silent: Story = { args: { levels: new Array(24).fill(0), elapsedSeconds: 72 } };

export const NearTheLimit: Story = { args: { elapsedSeconds: 112 } };
