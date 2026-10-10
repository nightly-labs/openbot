import { Button, Heading } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createSignal, For, onCleanup, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createConversationController } from "../src/features/conversation/Conversation";
import { ConversationComposer } from "../src/features/conversation/ConversationComposer";
import {
  ConversationControllerProvider,
  useConversationController,
} from "../src/features/conversation/conversation-controller-context";
import { composerDraftKey } from "../src/features/conversation/conversation-keys";
import {
  ConversationViewScopeContext,
  createConversationViewScope,
} from "../src/features/conversation/conversation-scope";
import type { ConversationProps } from "../src/features/conversation/conversation-types";
import { VOICE_LEVEL_COUNT } from "../src/features/conversation/stores/voice-store";
import type { VoicePhase } from "../src/features/conversation/voice-status";
import { CONVERSATION_STORY_ARGS, StoryAppProviders } from "./conversation-story-support";
import { STORY_AGENT_STATUS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

/** A fixed stretch of speech, so the waveform looks the same in each screenshot. */
const SPEECH_LEVELS = Array.from({ length: VOICE_LEVEL_COUNT }, (_, index) =>
  Math.max(0, Math.sin(index * 0.9) * 0.5 + Math.sin(index * 2.3) * 0.3),
);

const DICTATION =
  "Can you check the release notes for 2.18 and tell me which fixes still need a changelog entry before Friday?";

interface VoiceInputState {
  title: string;
  phase?: VoicePhase;
  elapsedSeconds?: number;
  levels?: number[];
  modelProgress?: number;
  draft?: string;
  liveText?: string;
  error?: () => string;
  props?: Partial<ConversationProps>;
}

const STATES: VoiceInputState[] = [
  { title: "Ready" },
  { title: "Agent not ready", props: { agentStatus: { ...STORY_AGENT_STATUS, phase: "starting" } } },
  { title: "Downloading the voice model", phase: "preparing", modelProgress: 47 },
  { title: "Requesting microphone access", phase: "requesting" },
  {
    title: "Recording, silence",
    phase: "recording",
    elapsedSeconds: 1,
    levels: new Array(VOICE_LEVEL_COUNT).fill(0),
  },
  {
    title: "Recording with live text",
    phase: "recording",
    elapsedSeconds: 3,
    levels: SPEECH_LEVELS,
    liveText: DICTATION.slice(0, 44),
  },
  {
    title: "Recording after a draft",
    phase: "recording",
    elapsedSeconds: 7,
    levels: SPEECH_LEVELS,
    draft: "Quick question about the release.",
    liveText: DICTATION,
  },
  { title: "Transcribing", phase: "transcribing", elapsedSeconds: 7, liveText: DICTATION },
  { title: "Transcript in the draft", draft: DICTATION },
  { title: "Microphone blocked", error: () => currentText().t("composer.voice.blocked") },
  { title: "No speech detected", error: () => currentText().t("composer.voice.noSpeechDetected") },
  { title: "No microphone (Linux and remote web)", props: { platform: "linux" } },
];

/** Only the message box, set to one voice state through the same controller signals the app uses. */
function VoiceInputComposer(props: { state: VoiceInputState }) {
  // No messages: the story messages ask another agent, and its "Waiting for replies" panel would
  // sit above every input.
  const conversationProps: ConversationProps = { ...CONVERSATION_STORY_ARGS, messages: [], ...props.state.props };
  const scope = createConversationViewScope(conversationProps);
  const controller = useConversationController();
  onSettled(() => {
    const target = { agentId: conversationProps.agent?.id ?? "", serverId: conversationProps.server?.id ?? "local" };
    const { draft, phase, elapsedSeconds, levels, modelProgress, liveText, error } = props.state;
    if (draft) controller.setDrafts({ [target.agentId]: { text: draft, attachments: [], replyToMessageId: null } });
    if (phase) controller.setVoicePhase(phase);
    if (elapsedSeconds !== undefined) controller.setVoiceElapsedSeconds(elapsedSeconds);
    if (levels) controller.setVoiceLevels(levels);
    if (modelProgress !== undefined) controller.setVoiceModelProgress(modelProgress);
    if (liveText) controller.setVoiceLiveTranscript({ ...target, text: liveText });
    if (error) controller.setConversationErrors({ [composerDraftKey(target)]: error() });
  });
  return (
    <ConversationViewScopeContext value={scope}>
      <ConversationComposer />
    </ConversationViewScopeContext>
  );
}

function useMockOpenBot() {
  const previousApi = window.openbot;
  const mock = createMockOpenBot();
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
}

function VoiceInputStates() {
  useMockOpenBot();
  return (
    <main class="foundation-story">
      <StoryAppProviders>
        <For each={STATES}>
          {(state) => (
            <section class="foundation-story-section voice-input-story-state">
              <Heading as="h2" size="sm">
                {state.title}
              </Heading>
              <ConversationControllerProvider
                controller={createConversationController({ onTypingChange: CONVERSATION_STORY_ARGS.onTypingChange })}
              >
                <VoiceInputComposer state={state} />
              </ConversationControllerProvider>
            </section>
          )}
        </For>
      </StoryAppProviders>
    </main>
  );
}

/**
 * Plays the morph in a loop: the microphone melts into the recording bar, a made-up voice moves
 * the waveform, and the bar melts back. Toggle stops the loop and switches by hand.
 */
function VoiceMorphLoop() {
  const controller = useConversationController();
  const [looping, setLooping] = createSignal(true);
  let levels: number[] = new Array(VOICE_LEVEL_COUNT).fill(0);
  let tick = 0;
  const toggle = () => controller.setVoicePhase(controller.voicePhase() === "recording" ? "idle" : "recording");
  const meter = setInterval(() => {
    tick += 1;
    const speaking = Math.sin(tick / 9) > -0.3;
    const level = speaking ? Math.min(1, Math.abs(Math.sin(tick * 1.7) * 0.7 + Math.sin(tick * 0.6) * 0.4)) : 0;
    levels = [...levels.slice(1), controller.voicePhase() === "recording" ? level : 0];
    controller.setVoiceLevels(levels);
  }, 80);
  const loop = setInterval(() => {
    if (looping()) toggle();
  }, 2_400);
  onCleanup(() => {
    clearInterval(meter);
    clearInterval(loop);
  });
  return (
    <>
      <VoiceInputComposer state={{ title: "Morph" }} />
      <Button
        variant="secondary"
        type="button"
        onClick={() => {
          setLooping(false);
          toggle();
        }}
      >
        Toggle recording
      </Button>
    </>
  );
}

function VoiceMorph() {
  useMockOpenBot();
  return (
    <main class="foundation-story">
      <StoryAppProviders>
        <section class="foundation-story-section voice-input-story-state">
          <ConversationControllerProvider
            controller={createConversationController({ onTypingChange: CONVERSATION_STORY_ARGS.onTypingChange })}
          >
            <VoiceMorphLoop />
          </ConversationControllerProvider>
        </section>
      </StoryAppProviders>
    </main>
  );
}

const meta = {
  title: "Conversation/Voice input",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllStates: Story = {
  name: "All states",
  render: () => <VoiceInputStates />,
};

export const Morph: Story = {
  name: "Morph",
  render: () => <VoiceMorph />,
};
