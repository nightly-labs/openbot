import type { AgentStatus } from "@openbot/contracts/ipc";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { InitialSetup } from "../src/features/onboarding/InitialSetup";
import { STORY_AGENT_STATUS } from "./fixtures";
import { createMockOpenBot } from "./mock-openbot";

type InitialSetupArgs = Parameters<typeof InitialSetup>[0];

/** OpenCode installed with no account of its own: enough to run an endpoint that brings its own key. */
const openCodeInstalledAgentStatus: AgentStatus = {
  ...STORY_AGENT_STATUS,
  providers: [
    ...(STORY_AGENT_STATUS.providers ?? []),
    { id: "opencode", state: "sign-in-required", version: "1.18.27", message: null },
  ],
};

function MockedInitialSetup(props: { args: InitialSetupArgs }) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot();
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    window.openbot = previousApi;
  });
  return <InitialSetup {...props.args} />;
}

const args: InitialSetupArgs = {
  state: { completed: false, preferredProvider: "codex", preferredModel: null },
  agentStatus: openCodeInstalledAgentStatus,
  platform: "darwin",
  accountEmail: "ada@example.com",
  onSave: fn(async () => undefined),
  onPreviewInvite: fn(async () => {
    throw new Error("Not available in this story.");
  }),
  onJoinRemote: fn(async () => undefined),
  onClose: fn(),
  onConnectProvider: fn(async () => undefined),
  onAddCustomProvider: fn(async () => "restarted" as const),
  onDeleteCustomProvider: fn(async () => "restarted" as const),
  customProviders: [
    {
      id: "studio-local",
      name: "Studio Local",
      baseUrl: "http://127.0.0.1:11434/v1",
      hasApiKey: false,
      models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
    },
  ],
};

const meta = {
  title: "Setup/InitialSetup",
  component: InitialSetup,
  args,
  parameters: { layout: "fullscreen" },
  render: (storyArgs) => <MockedInitialSetup args={storyArgs} />,
} satisfies Meta<typeof InitialSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** First-run choice between this computer and a remote server. */
export const FirstRun: Story = {};
