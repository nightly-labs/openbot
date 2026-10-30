/**
 * The optional API key dialog of OpenCode Go, Muse and Gemini. The dialog reads and writes the key
 * through `api`, so each story gives an `api` that answers in one way. A failure has no message, so
 * the dialog shows its own text for it.
 */

import type { ProviderApiKeyStatus } from "@openbot/contracts/ipc";
import { OpenCodeKeyDialog, type ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/** How one call of the story `api` answers. */
type Answer = "succeeds" | "pending" | "fails";

interface KeyApiOptions {
  status?: ProviderApiKeyStatus;
  read?: Answer;
  write?: Answer;
}

function answer<T>(kind: Answer, value: T): Promise<T> {
  if (kind === "pending") return new Promise<T>(() => undefined);
  if (kind === "fails") return Promise.reject(new Error());
  return Promise.resolve(value);
}

function keyApi(options: KeyApiOptions = {}): ProviderKeyApi {
  const status = options.status ?? "missing";
  return {
    getProviderApiKeyState: (provider) => answer(options.read ?? "succeeds", { provider, status }),
    setProviderApiKey: () => answer(options.write ?? "succeeds", undefined),
    clearProviderApiKey: () => answer(options.write ?? "succeeds", undefined),
    openExternal: () => Promise.resolve(),
  };
}

const args: Parameters<typeof OpenCodeKeyDialog>[0] = {
  api: keyApi(),
  provider: "opencode",
  onClose: fn(),
};

const meta = {
  title: "Settings/OpenCodeKeyDialog",
  component: OpenCodeKeyDialog,
  args,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof OpenCodeKeyDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoKey: Story = {};

/** The saved state is not read yet, so the field and the actions are disabled. */
export const Loading: Story = {
  args: { api: keyApi({ read: "pending" }) },
};

export const Saved: Story = {
  args: { api: keyApi({ status: "saved" }) },
};

/** A key is stored, but the app cannot read it. */
export const Unreadable: Story = {
  args: { api: keyApi({ status: "unreadable" }) },
};

export const ReadFailed: Story = {
  args: { api: keyApi({ read: "fails" }) },
};

/** Type a key and save it to see the save in progress. */
export const Saving: Story = {
  args: { api: keyApi({ write: "pending" }) },
};

/** Type a key and save it, or remove the saved key, to see the failure. */
export const WriteFails: Story = {
  args: { api: keyApi({ status: "saved", write: "fails" }) },
};

/** A free provider that failed to connect can try again without a key. */
export const WithReconnect: Story = {
  args: { onReconnect: fn(() => Promise.resolve()) },
};

export const Muse: Story = {
  args: { provider: "muse" },
};

/** Gemini does not show Reconnect: its reconnect is a Google sign-in. */
export const GeminiSaved: Story = {
  args: { provider: "antigravity", api: keyApi({ status: "saved" }), onReconnect: fn(() => Promise.resolve()) },
};
