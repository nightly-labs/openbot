import { VoicePanel } from "@openbot/ui/features/conversation/VoicePanel";
import { createSignal, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT } from "./fixtures";

const QUIET = new Array(24).fill(0);
/** A few words and a short pause, as the waveform shows them. */
const SPEECH = [
  0, 0, 0.05, 0.3, 0.55, 0.4, 0.7, 0.5, 0.2, 0.05, 0, 0, 0.1, 0.45, 0.8, 0.6, 0.35, 0.6, 0.9, 0.5, 0.25, 0.4, 0.65, 0.5,
];

const QUESTION = "What should I put first in the launch post?";

const meta = {
  title: "Conversation/VoicePanel",
  component: VoicePanel,
  args: {
    agent: STORY_AGENT,
    phase: "listening",
    muted: false,
    heard: "",
    said: "",
    levels: QUIET,
    error: null,
    onToggleMute: fn(),
    onInterrupt: fn(),
    onEnd: fn(),
  },
  // Mute is local here; in the app the voice conversation holds it.
  render: (args) => {
    const [muted, setMuted] = createSignal(untrack(() => args.muted));
    return (
      <div class="conversation-panel" style="height: 100vh; --browser-panel-width: 380px">
        <VoicePanel
          {...args}
          muted={muted()}
          onToggleMute={() => {
            setMuted(!muted());
            args.onToggleMute();
          }}
        />
      </div>
    );
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof VoicePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Starting: Story = { args: { phase: "starting" } };

export const Listening: Story = {};

export const Hearing: Story = { args: { heard: QUESTION, levels: SPEECH } };

export const Muted: Story = { args: { muted: true } };

export const Thinking: Story = { args: { phase: "thinking", heard: QUESTION } };

export const Speaking: Story = {
  args: {
    phase: "speaking",
    said: "Start with the one change a reader can try today, then say why it matters.",
    levels: SPEECH,
  },
};

export const MicrophoneBlocked: Story = {
  args: { muted: true, error: "OpenBot cannot use the microphone. Allow it in System Settings." },
};

export const ServerOffline: Story = {
  args: {
    phase: "offline",
    error: "The server is not connected. The conversation continues when it connects again.",
  },
};
