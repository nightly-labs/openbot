import { nextSpeechSpeed } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { VoicePill } from "@openbot/ui/features/conversation/VoicePill";
import { useText } from "@openbot/ui/text";
import { createSignal, Show, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT } from "./fixtures";

const QUIET = new Array(24).fill(0);
/** A few words and a short pause, as the waveform shows them. */
const SPEECH = [
  0, 0, 0.05, 0.3, 0.55, 0.4, 0.7, 0.5, 0.2, 0.05, 0, 0, 0.1, 0.45, 0.8, 0.6, 0.35, 0.6, 0.9, 0.5, 0.25, 0.4, 0.65, 0.5,
];

const meta = {
  title: "Conversation/VoicePill",
  component: VoicePill,
  args: {
    agent: STORY_AGENT,
    phase: "listening",
    muted: false,
    levels: QUIET,
    error: null,
    onToggleMute: fn(),
    onInterrupt: fn(),
    onEnd: fn(),
    speed: 1,
    onCycleSpeed: fn(),
  },
  // Mute, speed and the open pill are local here; in the app the voice conversation and the saved
  // speed hold them. End sends the pill back into the top edge, and Start brings it out again.
  render: (args) => {
    const { t } = useText();
    const [muted, setMuted] = createSignal(untrack(() => args.muted));
    const [speed, setSpeed] = createSignal(untrack(() => args.speed ?? 1));
    const [open, setOpen] = createSignal(true);
    const [shown, setShown] = createSignal(true);
    return (
      <div class="conversation-panel" style="height: 100vh">
        <Show when={!shown()}>
          <Button
            type="button"
            variant="outline"
            style="position: absolute; top: 50%; left: 50%; translate: -50% -50%"
            onClick={() => {
              setOpen(true);
              setShown(true);
            }}
          >
            {t("conversation.voice.start")}
          </Button>
        </Show>
        <Show when={shown()}>
          <VoicePill
            {...args}
            open={open()}
            onClosed={() => setShown(false)}
            onEnd={() => {
              setOpen(false);
              args.onEnd();
            }}
            muted={muted()}
            onToggleMute={() => {
              setMuted(!muted());
              args.onToggleMute();
            }}
            speed={speed()}
            onCycleSpeed={
              args.onCycleSpeed
                ? () => {
                    setSpeed(nextSpeechSpeed(speed()));
                    args.onCycleSpeed?.();
                  }
                : undefined
            }
          />
        </Show>
      </div>
    );
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof VoicePill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Starting: Story = { args: { phase: "starting" } };

export const Listening: Story = {};

export const Hearing: Story = { args: { levels: SPEECH } };

export const Muted: Story = { args: { muted: true } };

export const Thinking: Story = { args: { phase: "thinking" } };

export const Speaking: Story = { args: { phase: "speaking", levels: SPEECH } };

/** Codex live voice speaks at the speed of the realtime model, so it has no speed button. */
export const LiveVoice: Story = { args: { onCycleSpeed: undefined } };

export const MicrophoneBlocked: Story = {
  args: { muted: true, error: "OpenBot cannot use the microphone. Allow it in System Settings." },
};

export const ServerOffline: Story = {
  args: {
    phase: "offline",
    error: "The server is not connected. The conversation continues when it connects again.",
  },
};
