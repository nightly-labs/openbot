import type { CustomProviderSummary } from "@openbot/contracts/ipc";
import { CustomProviderListDialog } from "@openbot/ui/features/custom-providers/CustomProviderListDialog";
import { useText } from "@openbot/ui/text";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const OLLAMA: CustomProviderSummary = {
  id: "ollama",
  name: "Ollama",
  baseUrl: "http://localhost:11434/v1",
  hasApiKey: false,
  models: [],
};

const LM_STUDIO: CustomProviderSummary = {
  id: "lmstudio",
  name: "LM Studio",
  baseUrl: "http://localhost:1234/v1",
  hasApiKey: false,
  models: [],
};

const OPENROUTER: CustomProviderSummary = {
  id: "openrouter",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  hasApiKey: true,
  models: [],
};

const args: Parameters<typeof CustomProviderListDialog>[0] = {
  open: true,
  providers: [OLLAMA, LM_STUDIO, OPENROUTER],
  removing: null,
  note: null,
  onDelete: fn(),
  onClose: fn(),
};

const meta = {
  title: "Conversation/CustomProviderListDialog",
  component: CustomProviderListDialog,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof CustomProviderListDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithEndpoints: Story = {};

export const Removing: Story = {
  args: { removing: LM_STUDIO.id },
};

export const ReadOnly: Story = {
  args: { onDelete: undefined },
};

export const Empty: Story = {
  args: { providers: [] },
};

export const RemovedLast: Story = {
  args: { providers: [] },
  render: (storyArgs) => {
    const { t } = useText();
    return <CustomProviderListDialog {...storyArgs} note={t("customProvider.removed.restarted")} />;
  },
};

export const RemovedWhileBusy: Story = {
  args: { providers: [OLLAMA, OPENROUTER] },
  render: (storyArgs) => {
    const { t } = useText();
    return <CustomProviderListDialog {...storyArgs} note={t("customProvider.removed.skippedBusy")} />;
  },
};

export const RemoveFailed: Story = {
  render: (storyArgs) => {
    const { t } = useText();
    return (
      <CustomProviderListDialog {...storyArgs} note={t("customProvider.removeFailed", { name: LM_STUDIO.name })} />
    );
  },
};
