import { CustomProviderPresetDialog } from "@openbot/ui/features/custom-providers/CustomProviderPresetDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const args: Parameters<typeof CustomProviderPresetDialog>[0] = {
  open: true,
  onChoose: fn(),
  onCancel: fn(),
};

const meta = {
  title: "Conversation/CustomProviderPresetDialog",
  component: CustomProviderPresetDialog,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof CustomProviderPresetDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A host that does not probe the local servers. */
export const PresetPlain: Story = {};

export const PresetChecking: Story = {
  args: { probes: { ollama: { status: "checking" }, lmstudio: { status: "checking" } } },
};

/** Ollama answers at its default address; LM Studio does not. */
export const PresetProbed: Story = {
  args: { probes: { ollama: { status: "running", models: 4 } } },
};
