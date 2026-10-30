/**
 * The "More providers" dialog of the provider picker. The rows use the names of the provider
 * registry and the same description keys as the setup picker. A provider that is included with
 * OpenBot has no description.
 */

import { agentProviderName, PICKER_PROVIDERS } from "@openbot/contracts/agent-providers";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { MoreProvidersDialog } from "@openbot/ui/components/MoreProvidersDialog";
import { useText } from "@openbot/ui/text";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const DESCRIPTION_KEYS: Partial<Record<AgentProviderId, AppTextKey>> = {
  opencode: "onboarding.provider.freeModels",
  antigravity: "onboarding.provider.googlePlan",
  cursor: "onboarding.provider.cursorPlan",
  cline: "onboarding.provider.clineAccount",
};

interface MoreProvidersStoryProps {
  /** The providers that the dialog lists, in this order. */
  providerIds: readonly AgentProviderId[];
  custom: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (provider: AgentProviderId) => void;
  onChooseCustom: () => void;
}

function MoreProvidersStory(props: MoreProvidersStoryProps) {
  const { t } = useText();
  const providers = () =>
    props.providerIds.map((id) => {
      const key = DESCRIPTION_KEYS[id];
      return { id, name: agentProviderName(id), description: key ? t(key) : null };
    });
  return (
    <MoreProvidersDialog
      open={true}
      onOpenChange={props.onOpenChange}
      providers={providers()}
      custom={props.custom}
      onChoose={props.onChoose}
      onChooseCustom={props.onChooseCustom}
    />
  );
}

/** The providers after the first rows of the picker. */
const HIDDEN_PROVIDERS = PICKER_PROVIDERS.slice(5);

const args: MoreProvidersStoryProps = {
  providerIds: HIDDEN_PROVIDERS,
  custom: false,
  onOpenChange: fn(),
  onChoose: fn(),
  onChooseCustom: fn(),
};

const meta = {
  title: "Onboarding/MoreProvidersDialog",
  component: MoreProvidersStory,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof MoreProvidersStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A short list has no search field. */
export const Short: Story = {};

/** The custom provider entry is last, below a divider. */
export const WithCustom: Story = {
  args: { custom: true },
};

/** Only the custom provider entry is left to offer. */
export const OnlyCustom: Story = {
  args: { providerIds: [], custom: true },
};

/** Eight or more providers show the search field. Type a text that has no match to see the empty result. */
export const Searchable: Story = {
  args: { providerIds: PICKER_PROVIDERS, custom: true },
};
