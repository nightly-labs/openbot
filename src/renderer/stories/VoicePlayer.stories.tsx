import { VoicePlayer } from "@openbot/ui/features/conversation/VoicePlayer";
import { createSignal, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const PEAKS = [
  0.05, 0.1, 0.35, 0.6, 0.8, 0.55, 0.3, 0.7, 1, 0.85, 0.4, 0.2, 0.1, 0.45, 0.75, 0.9, 0.6, 0.35, 0.5, 0.8, 0.65, 0.3,
  0.15, 0.05, 0.2, 0.55, 0.7, 0.95, 0.6, 0.4, 0.25, 0.5, 0.7, 0.45, 0.3, 0.15, 0.1, 0.05, 0.03, 0.02,
];

const meta = {
  title: "Conversation/VoicePlayer",
  component: VoicePlayer,
  args: { kind: "message", state: "idle", peaks: PEAKS, duration: 6, onToggle: fn(), onSeek: fn() },
  // Play state and position are local here; in the app the speech playback holds them.
  render: (args) => {
    const [state, setState] = createSignal(untrack(() => args.state));
    const [elapsed, setElapsed] = createSignal(untrack(() => args.elapsed ?? 0));
    return (
      <VoicePlayer
        {...args}
        state={state()}
        elapsed={elapsed()}
        onToggle={() => {
          setState(state() === "playing" ? "paused" : "playing");
          args.onToggle();
        }}
        onSeek={(seconds) => {
          setElapsed(seconds);
          if (state() === "idle") setState("playing");
          args.onSeek?.(seconds);
        }}
      />
    );
  },
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof VoicePlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const VoiceMessage: Story = {};

export const VoiceMessagePlaying: Story = { args: { state: "playing", elapsed: 2.4 } };

export const VoiceMessageLoading: Story = { args: { peaks: undefined, duration: undefined } };

export const SpokenReply: Story = { args: { kind: "reply", peaks: undefined, duration: undefined } };

export const SpokenReplyPlaying: Story = {
  args: {
    kind: "reply",
    state: "playing",
    peaks: undefined,
    duration: undefined,
    elapsed: 7,
    levels: PEAKS,
  },
};

/** A reply that was read to its end once keeps its audio: it shows its waveform and length. */
export const SpokenReplyRead: Story = { args: { kind: "reply", duration: 23 } };

export const SpokenReplyReplaying: Story = { args: { kind: "reply", state: "playing", duration: 23, elapsed: 9 } };
