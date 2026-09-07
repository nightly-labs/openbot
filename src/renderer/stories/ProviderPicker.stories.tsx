import { fn } from "storybook/test";
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

export const AllowUnavailableSelection: Story = {
  args: {
    value: "claude",
    allowUnavailableSelection: true,
  },
};
