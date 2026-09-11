import { expect, fn, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ProviderPicker, type ProviderPickerOption } from "../src/components/ProviderPicker";

const options: ProviderPickerOption[] = [
  {
    id: "codex",
    name: "Codex",
    state: "available",
    email: "person@example.com",
  },
  {
    id: "claude",
    name: "Claude",
    state: "sign-in-required",
    email: "person@example.com",
    message: "Sign in to Claude to use this provider.",
  },
  {
    id: "grok",
    name: "Grok",
    state: "available",
    email: null,
  },
];

const args: Parameters<typeof ProviderPicker>[0] = {
  value: "codex",
  options,
  ariaLabel: "Default provider",
  label: "Default provider",
  hint: "You can change this later in settings.",
  onChange: fn(),
};

const meta = {
  title: "Setup/ProviderPicker",
  component: ProviderPicker,
  args,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ProviderPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {};

export const Embedded: Story = {
  args: { embedded: true, label: undefined },
};

export const ProviderUnavailable: Story = {
  args: {
    value: null,
    options: options.map((option) => ({
      ...option,
      state: "not-installed",
      message: "Install this provider to continue.",
    })),
  },
};

/**
 * The three isolated update states. An update is a re-download of a newer runtime, so the
 * in-flight and failed rows reuse the Cancel and Retry buttons a first download already has.
 */
const claudeReady: ProviderPickerOption["runtimeStatus"] = {
  phase: "ready",
  progress: 100,
  message: null,
  version: "2.1.246",
};

function withClaudeUpdate(runtimeStatus: ProviderPickerOption["runtimeStatus"]): ProviderPickerOption[] {
  return options.map((option) =>
    option.id === "claude"
      ? { ...option, state: "available", message: null, runtimeStatus, availableVersion: "2.1.250" }
      : option,
  );
}

export const UpdateAvailable: Story = {
  args: { value: "claude", options: withClaudeUpdate(claudeReady), onUpdateProvider: fn() },
};

export const UpdateInProgress: Story = {
  args: {
    value: "claude",
    options: withClaudeUpdate({ phase: "downloading", progress: 42, message: null, version: "2.1.246" }),
    onCancelProviderDownload: fn(),
  },
};

export const UpdateFailed: Story = {
  args: {
    value: "claude",
    options: withClaudeUpdate({
      phase: "download-error",
      progress: 55,
      message: "The update was interrupted.",
      version: "2.1.246",
    }),
    onDownloadProvider: fn(),
  },
};

/**
 * A CLI the user installed themselves, with a newer version pinned by this OpenBot release. The row
 * reads exactly like a managed update - same badge, same button - because only the work behind the
 * button differs, and the row does not choose it.
 */
export const UserOwnedCliUpdate: Story = {
  args: {
    value: "codex",
    options: options.map((option) =>
      option.id === "codex"
        ? {
            ...option,
            runtimeStatus: { phase: "ready", progress: null, message: null, version: "0.146.0" },
            availableVersion: "0.153.4",
          }
        : option,
    ),
    onConnectProvider: fn(),
    onUpdateProvider: fn(),
  },
};

export const AllowUnavailableSelection: Story = {
  args: {
    value: "claude",
    allowUnavailableSelection: true,
  },
};

/**
 * A custom endpoint runs as OpenCode, so its row follows OpenCode's row: it offers OpenCode's install
 * until the CLI is there, and Add from then on, with or without an OpenCode account.
 */
function withOpenCode(state: ProviderPickerOption["state"]): ProviderPickerOption[] {
  return [...options, { id: "opencode", name: "OpenCode", state, description: "Use your installed OpenCode CLI" }];
}

export const CustomProviderNotInstalled: Story = {
  args: { options: withOpenCode("not-installed"), onAddCustomProvider: fn(), onInstallProvider: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Install custom provider" }));
    await expect(args.onInstallProvider).toHaveBeenCalledWith("opencode");
    await expect(canvas.queryByRole("button", { name: "Add custom provider" })).toBeNull();
  },
};

/**
 * Two saved endpoints in the one row that stands for them all. The row is a choice now, so it joins
 * the group and takes the check mark from the provider that serves it, and the count is the button
 * that opens the list. The button sits beside Add, outside the label: a button inside a `<label>`
 * would answer the radio instead.
 */
export const CustomProviderEndpoints: Story = {
  args: {
    value: "opencode",
    options: withOpenCode("available"),
    customProviders: [
      {
        id: "studio-local",
        name: "Studio Local",
        baseUrl: "http://127.0.0.1:11434/v1",
        hasApiKey: false,
        models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
      },
      {
        id: "house-router",
        name: "House Router",
        baseUrl: "https://models.example.com/v1",
        hasApiKey: true,
        models: [{ id: "gpt-oss-120b", name: "GPT OSS 120B" }],
      },
    ],
    customSelected: false,
    onAddCustomProvider: fn(),
    onSelectCustomProvider: fn(),
    onManageCustomProviders: fn(),
  },
  play: async ({ args, canvas, userEvent }) => {
    const providers = within(canvas.getByRole("radiogroup", { name: "Default provider" }));
    const custom = providers.getByRole("radio", { name: /Custom provider/ });
    await userEvent.click(custom);
    await expect(args.onSelectCustomProvider).toHaveBeenCalledTimes(1);
    // The count counts, and opens the list. The radio keeps its own name.
    await expect(custom).not.toHaveAccessibleName(/endpoints/);
    const manage = canvas.getByRole("button", { name: "Manage 2 endpoints" });
    await expect(manage).toHaveTextContent("2 endpoints");
    await userEvent.click(manage);
    await expect(args.onManageCustomProviders).toHaveBeenCalledTimes(1);
    // Add keeps its own place on the row, so choosing the row never opens the form.
    await expect(canvas.getByRole("button", { name: "Add custom provider" })).toBeVisible();
  },
};

/**
 * One endpoint, chosen, and no list to open. Without `onManageCustomProviders` the count stays a
 * badge inside the label and counts in the singular. No provider row holds the check.
 */
export const CustomProviderSelected: Story = {
  args: {
    value: "opencode",
    options: withOpenCode("available"),
    customProviders: [
      {
        id: "studio-local",
        name: "Studio Local",
        baseUrl: "http://127.0.0.1:11434/v1",
        hasApiKey: false,
        models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
      },
    ],
    customSelected: true,
    onAddCustomProvider: fn(),
    onSelectCustomProvider: fn(),
  },
  play: async ({ canvas }) => {
    const providers = within(canvas.getByRole("radiogroup", { name: "Default provider" }));
    const custom = providers.getByRole("radio", { name: /Custom provider/ });
    await expect(custom).toBeChecked();
    await expect(custom).toHaveAccessibleName(/1 endpoint/);
    await expect(providers.getByRole("radio", { name: /OpenCode/ })).not.toBeChecked();
  },
};

export const CustomProviderReady: Story = {
  args: { options: withOpenCode("sign-in-required"), onAddCustomProvider: fn() },
  play: async ({ args, canvas, userEvent }) => {
    // Anywhere on the row answers, as it does on the rows above, not only the button at its edge.
    await userEvent.click(canvas.getByText("Custom provider"));
    await expect(args.onAddCustomProvider).toHaveBeenCalledTimes(1);
    // It adds, it does not select, so it stays outside the group of choices.
    await expect(canvas.getByRole("radiogroup", { name: "Default provider" })).not.toContainElement(
      canvas.getByRole("button", { name: "Add custom provider" }),
    );
  },
};
