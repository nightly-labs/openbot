/**
 * The list of saved custom endpoints, where the user removes them. The note is the outcome of the
 * last removal; the stories make it from the same keys as the app.
 */

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

/** Delete opens the removal question. */
export const WithEndpoints: Story = {};

/** One endpoint is being removed, so every Delete button is disabled. */
export const Removing: Story = {
  args: { removing: LM_STUDIO.id },
};

/** A remote server lists its endpoints but does not remove them. */
export const ReadOnly: Story = {
  args: { onDelete: undefined },
};

export const Empty: Story = {
  args: { providers: [] },
};

/** The last endpoint was removed: the dialog stays open on its empty state with the outcome. */
export const RemovedLast: Story = {
  args: { providers: [] },
  render: (storyArgs) => {
    const { t } = useText();
    return <CustomProviderListDialog {...storyArgs} note={t("customProvider.removed.restarted")} />;
  },
};

/** OpenCode was busy, so the model list changes after its next restart. */
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
