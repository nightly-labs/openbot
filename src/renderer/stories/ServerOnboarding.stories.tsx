import type { AgentStatus, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { hostSetupProviderProps } from "../src/features/onboarding/host-setup-provider-props";
import { ServerOnboarding } from "../src/features/onboarding/ServerOnboarding";
import type { HostProviderSettings } from "../src/features/settings/ProviderSettingsSection";
import { createFakeCodeLogin } from "./code-login-fixture";
import { STORY_AGENT_STATUS } from "./fixtures";

/** A new hosted server: every CLI is on the host, and none is signed in. */
const newHostStatus: AgentStatus = {
  ...STORY_AGENT_STATUS,
  phase: "blocked",
  providers: [
    { id: "codex", state: "sign-in-required", version: "0.149.1", message: null },
    { id: "claude", state: "sign-in-required", version: "2.1.263", message: null },
    { id: "grok", state: "sign-in-required", version: "1.0.22", message: null },
    { id: "opencode", state: "sign-in-required", version: "1.18.27", message: null },
  ],
  capabilities: { ...STORY_AGENT_STATUS.capabilities, chat: "unavailable" },
};

const connectedHostStatus: AgentStatus = {
  ...newHostStatus,
  phase: "ready",
  providers: newHostStatus.providers?.map((provider) =>
    provider.id === "claude" ? { ...provider, state: "available", email: "person@example.com" } : provider,
  ),
};

const ready = (version: string): ProviderRuntimeStatus => ({ phase: "ready", progress: 100, message: null, version });

function host(agentStatus: AgentStatus): HostProviderSettings {
  return {
    agentStatus,
    providerRuntimeStatuses: {
      codex: ready("0.149.1"),
      claude: ready("2.1.263"),
      grok: ready("1.0.22"),
      opencode: ready("1.18.27"),
    },
    customProviders: [],
    codeLogin: createFakeCodeLogin({ providers: ["codex", "claude", "grok"], finishAfterMs: 0 }),
  };
}

type ServerOnboardingProps = Parameters<typeof ServerOnboarding>[0];

function Story(props: {
  agentStatus: AgentStatus;
  onContinue: ServerOnboardingProps["onContinue"];
  onClose: ServerOnboardingProps["onClose"];
}) {
  onCleanup(() => toast.dismiss());
  return (
    <div style={{ height: "100vh" }}>
      <ServerOnboarding
        serverName="Ada’s server"
        setup={hostSetupProviderProps(host(props.agentStatus))}
        onContinue={props.onContinue}
        onClose={props.onClose}
      />
      <Toaster />
    </div>
  );
}

const meta = {
  title: "Setup/ServerOnboarding",
  component: Story,
  args: { agentStatus: newHostStatus, onContinue: fn(), onClose: fn() },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Story>;

export default meta;
type StoryEntry = StoryObj<typeof meta>;

/** Nothing is signed in on the host. Connect on the Claude row opens the paste sign-in. */
export const NothingConnected: StoryEntry = {};

/** The host is signed in to Claude, so Continue opens the agent form. */
export const Connected: StoryEntry = {
  args: { agentStatus: connectedHostStatus },
};
