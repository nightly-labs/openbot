import {
  createFirstAgentDraft,
  FIRST_AGENT_SUGGESTIONS,
  type FirstAgentDraft,
  FirstAgentSetup,
  type FirstAgentSetupProps,
  type FirstAgentSuggestion,
} from "@openbot/ui/features/agents/FirstAgentSetup";
import { currentText } from "@openbot/ui/text";
import { createEffect, createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_STATUS, STORY_MODELS } from "./fixtures";

// The first face, as the app picks one at random. Story args are made before a provider renders, so
// the default name is English.
const DEFAULT_FIRST_AGENT_DRAFT = createFirstAgentDraft(() => 0);

function draftFromSuggestion(suggestion: FirstAgentSuggestion): FirstAgentDraft {
  const { t } = currentText();
  return {
    name: t(suggestion.nameKey),
    purpose: t(suggestion.purposeKey),
    avatarSeed: suggestion.avatarSeed,
    avatarHue: suggestion.avatarHue,
    suggestionId: suggestion.id,
    provider: DEFAULT_FIRST_AGENT_DRAFT.provider,
    model: DEFAULT_FIRST_AGENT_DRAFT.model,
  };
}

function ControlledFirstAgentSetup(props: FirstAgentSetupProps) {
  const [draft, setDraft] = createSignal<FirstAgentDraft>({ ...props.value });

  createEffect(
    () => props.value,
    (value) => {
      setDraft({ ...value });
    },
  );

  return (
    <FirstAgentSetup
      {...props}
      value={draft()}
      onChange={(value) => {
        setDraft(value);
        props.onChange(value);
      }}
    />
  );
}

const args: FirstAgentSetupProps = {
  value: DEFAULT_FIRST_AGENT_DRAFT,
  suggestions: FIRST_AGENT_SUGGESTIONS,
  submitting: false,
  onChange: fn(),
  onSubmit: fn(),
};

const meta = {
  title: "Setup/FirstAgentSetup",
  component: FirstAgentSetup,
  args,
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        firstAgentSmall: {
          name: "First agent — 700 × 720",
          styles: { width: "700px", height: "720px" },
        },
      },
    },
  },
  render: (storyArgs) => <ControlledFirstAgentSetup {...storyArgs} />,
} satisfies Meta<typeof FirstAgentSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

const selectedSuggestion = FIRST_AGENT_SUGGESTIONS[1];

export const SuggestionSelected: Story = {
  args: {
    value: selectedSuggestion ? draftFromSuggestion(selectedSuggestion) : DEFAULT_FIRST_AGENT_DRAFT,
  },
};

export const Submitting: Story = {
  args: {
    value: selectedSuggestion ? draftFromSuggestion(selectedSuggestion) : DEFAULT_FIRST_AGENT_DRAFT,
    mode: "additional",
    submitting: true,
    onCancel: fn(),
  },
};

export const SmallWindow: Story = {
  parameters: { viewport: { defaultViewport: "firstAgentSmall" } },
};

/** The model picker lists only the providers that can run, and its plus opens the provider settings. */
export const ModelPicker: Story = {
  args: { modelOptions: STORY_MODELS, agentStatus: STORY_AGENT_STATUS, onManageProviders: fn() },
};

export const LongPrompt: Story = {
  args: {
    value: {
      ...DEFAULT_FIRST_AGENT_DRAFT,
      purpose: Array.from(
        { length: 10 },
        (_, index) => `Task ${index + 1}: Help me organize my notes, errands, and plans for the week.`,
      ).join("\n"),
    },
    modelOptions: STORY_MODELS,
    agentStatus: STORY_AGENT_STATUS,
  },
  parameters: { viewport: { defaultViewport: "firstAgentSmall" } },
};
