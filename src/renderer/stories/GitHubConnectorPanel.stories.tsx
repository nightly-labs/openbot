import type { GitHubConnectorRepositories, GitHubConnectorStatus } from "@openbot/contracts/ipc";
import { GitHubConnectorPanel } from "@openbot/ui/features/settings/GitHubConnectorPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Settings/GitHubConnectorPanel",
  component: GitHubConnectorPanel,
  parameters: { layout: "padded", a11y: { test: "error" } },
} satisfies Meta<typeof GitHubConnectorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const DISCONNECTED: GitHubConnectorStatus = {
  available: true,
  state: "disconnected",
  login: null,
  avatarUrl: null,
  userCode: null,
  verificationUri: null,
  error: null,
};

const REPOSITORIES: GitHubConnectorRepositories = {
  repositories: [
    { fullName: "octocat/hello-world", private: false },
    { fullName: "octocat/private-notes", private: true },
    { fullName: "octo-org/website", private: false },
  ],
  total: 3,
};

const args = (
  status: Partial<GitHubConnectorStatus>,
  busy = false,
  repositories: GitHubConnectorRepositories | null = REPOSITORIES,
  repositoriesError: string | null = null,
) => ({
  status: { ...DISCONNECTED, ...status },
  busy,
  repositories,
  repositoriesError,
  onConnect: fn(),
  onCancel: fn(),
  onDisconnect: fn(),
  onOpenVerification: fn(),
  onOpenInstall: fn(),
});

export const Disconnected: Story = { args: args({}) };

export const Pending: Story = {
  args: args({ state: "pending", userCode: "WDJB-MJHT", verificationUri: "https://github.com/login/device" }),
};

/** GitHub has not answered the device code request yet. */
export const PendingWithoutCode: Story = { args: args({ state: "pending" }) };

export const Connected: Story = { args: args({ state: "connected", login: "octocat" }) };

/** The first repository list has not arrived. */
export const ConnectedLoading: Story = { args: args({ state: "connected", login: "octocat" }, false, null) };

export const ConnectedWithoutRepositories: Story = {
  args: args({ state: "connected", login: "octocat" }, false, { repositories: [], total: 0 }),
};

/** The list stops at a limit. The rest is a count. */
export const ConnectedWithMoreRepositories: Story = {
  args: args({ state: "connected", login: "octocat" }, false, { ...REPOSITORIES, total: 540 }),
};

export const ConnectedRepositoriesFailed: Story = {
  args: args({ state: "connected", login: "octocat" }, false, null, "OpenBot cannot reach GitHub: fetch failed"),
};

export const Expired: Story = { args: args({ state: "expired", login: "octocat" }) };

export const Failed: Story = {
  args: args({ error: "The GitHub sign-in was refused." }),
};
