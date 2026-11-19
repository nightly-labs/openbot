import type { ProviderApiKeyStatus } from "@openbot/contracts/ipc";
import { OpenCodeKeyDialog, type ProviderKeyApi } from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

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

export const Loading: Story = {
  args: { api: keyApi({ read: "pending" }) },
};

export const Saved: Story = {
  args: { api: keyApi({ status: "saved" }) },
};

export const Unreadable: Story = {
  args: { api: keyApi({ status: "unreadable" }) },
};

export const ReadFailed: Story = {
  args: { api: keyApi({ read: "fails" }) },
};

export const Saving: Story = {
  args: { api: keyApi({ write: "pending" }) },
};

export const WriteFails: Story = {
  args: { api: keyApi({ status: "saved", write: "fails" }) },
};

export const WithReconnect: Story = {
  args: { onReconnect: fn(() => Promise.resolve()) },
};

export const Muse: Story = {
  args: { provider: "muse" },
};

export const Codex: Story = {
  args: { provider: "codex", api: { ...keyApi(), readsCodexKey: true } },
};

export const CodexOnHost: Story = {
  args: { provider: "codex", api: { ...keyApi(), readsCodexKey: true, onHost: true } },
};

export const GeminiSaved: Story = {
  args: { provider: "antigravity", api: keyApi({ status: "saved" }), onReconnect: fn(() => Promise.resolve()) },
};
