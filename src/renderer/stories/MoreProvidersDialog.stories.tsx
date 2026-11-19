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
  kimi: "onboarding.provider.kimiAccount",
  devin: "onboarding.provider.devinAccount",
  copilot: "onboarding.provider.copilotAccount",
  mistral: "onboarding.provider.mistralAccount",
  kiro: "onboarding.provider.kiroAccount",
};

interface MoreProvidersStoryProps {
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

export const Short: Story = {};

export const WithCustom: Story = {
  args: { custom: true },
};

export const OnlyCustom: Story = {
  args: { providerIds: [], custom: true },
};

export const Searchable: Story = {
  args: { providerIds: PICKER_PROVIDERS, custom: true },
};
