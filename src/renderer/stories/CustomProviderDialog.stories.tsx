import { expect, fn, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CustomProviderDialog } from "../src/features/custom-providers/CustomProviderDialog";
import type { CustomProviderDraft } from "../src/features/custom-providers/custom-provider-form";

const localEndpoint: CustomProviderDraft = {
  providerId: "studio-local",
  displayName: "Studio Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  // Never a shape that could be mistaken for a live key, here or in any other story.
  apiKey: "story-placeholder-not-a-key",
  models: [
    { id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" },
    { id: "gpt-oss:120b", name: "GPT-OSS 120B" },
  ],
  headers: [{ name: "X-Tenant", value: "studio" }],
};

const args: Parameters<typeof CustomProviderDialog>[0] = {
  open: true,
  onSubmit: fn(),
  onCancel: fn(),
};

const meta = {
  title: "Conversation/CustomProviderDialog",
  component: CustomProviderDialog,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof CustomProviderDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DialogBlank: Story = {};

export const DialogFilled: Story = {
  args: { draft: localEndpoint, onBack: fn() },
};

export const DialogErrors: Story = {
  args: {
    showErrors: true,
    draft: {
      providerId: "My Provider",
      displayName: "",
      baseUrl: "127.0.0.1:11434",
      apiKey: "",
      models: [
        { id: "qwen 3", name: "Qwen 3" },
        { id: "qwen 3", name: "Qwen 3 again" },
      ],
      headers: [{ name: "X Tenant", value: "" }],
    },
  },
};

export const DialogSubmits: Story = {
  args: { draft: localEndpoint },
  play: async ({ args: storyArgs, userEvent }) => {
    const body = within(document.body);
    await userEvent.click(body.getByRole("button", { name: "Submit" }));
    await expect(storyArgs.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "studio-local", apiKey: "story-placeholder-not-a-key" }),
    );
  },
};

export const DialogRefusesAnEmptyForm: Story = {
  play: async ({ args: storyArgs, userEvent }) => {
    const body = within(document.body);
    await userEvent.click(body.getByRole("button", { name: "Submit" }));
    await expect(body.findByText("Enter a provider ID.")).resolves.toBeTruthy();
    await expect(storyArgs.onSubmit).not.toHaveBeenCalled();
  },
};

export const DialogAddsRows: Story = {
  args: { draft: localEndpoint },
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(body.getByRole("button", { name: "Add model" }));
    await expect(body.findByRole("textbox", { name: "Model 3 ID" })).resolves.toBeTruthy();
    await userEvent.click(body.getByRole("button", { name: "Remove model 3" }));
  },
};

export const DialogBusy: Story = {
  args: { draft: localEndpoint, busy: true },
};

export const DialogSubmitError: Story = {
  args: { draft: localEndpoint, submitError: "OpenBot could not reach http://127.0.0.1:11434/v1." },
};

/** Long enough to scroll, which is the only way to see the top and bottom fades. */
export const DialogScrolls: Story = {
  args: {
    draft: {
      ...localEndpoint,
      models: Array.from({ length: 9 }, (_, index) => ({
        id: `qwen3-coder:${index + 1}b`,
        name: `Qwen3 Coder ${index + 1}B`,
      })),
    },
  },
};
