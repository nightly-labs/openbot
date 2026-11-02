/**
 * The update island at the end of the sidebar. Each story sets one updater status. The
 * `sidebar-update-island` wrapper is the class that the sidebar puts around the island.
 */

import type { UpdateStatus } from "@openbot/contracts/ipc";
import { AccountUpdateIsland } from "@openbot/ui/features/account/AccountUpdateIsland";
import { useText } from "@openbot/ui/text";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

function status(overrides: Partial<UpdateStatus>): UpdateStatus {
  return {
    phase: "available",
    currentVersion: "1.42.0",
    availableVersion: "1.43.0",
    progress: null,
    checkedAt: "2026-10-17T09:00:00.000Z",
    message: null,
    errorCode: null,
    ...overrides,
  };
}

const args: Parameters<typeof AccountUpdateIsland>[0] = {
  updateStatus: status({}),
  errorMessage: null,
  onUpdateAction: fn(() => Promise.resolve()),
};

const meta = {
  title: "Updates/AccountUpdateIsland",
  component: AccountUpdateIsland,
  args,
  decorators: [
    (Story) => (
      <main class="foundation-story">
        <div class="sidebar-update-island" style={{ width: "280px", "max-width": "100%" }}>
          <Story />
        </div>
      </main>
    ),
  ],
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof AccountUpdateIsland>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {};

/** The download started, but the updater did not report progress yet. */
export const DownloadStarting: Story = {
  args: { updateStatus: status({ phase: "downloading", progress: null }) },
};

export const Downloading: Story = {
  args: { updateStatus: status({ phase: "downloading", progress: 42 }) },
};

export const Ready: Story = {
  args: { updateStatus: status({ phase: "ready", progress: 100 }) },
};

export const Installing: Story = {
  args: { updateStatus: status({ phase: "installing", progress: 100 }) },
};

/** The host computer manages updates. The island shows the status, but the action is disabled. */
export const ManagedByHost: Story = {
  args: { updateStatus: status({ managedByHost: true }) },
};

/** The updater reports a failed download with no message. The island shows its own text. */
export const DownloadFailed: Story = {
  args: { updateStatus: status({ phase: "error", errorCode: "download_failed" }) },
};

/** The last action failed in the app, and the updater stays in its phase. */
export const ActionFailed: Story = {
  render: (storyArgs) => {
    const { t } = useText();
    return <AccountUpdateIsland {...storyArgs} errorMessage={t("account.menu.updateFailed")} />;
  },
};

/** A failed check has no update to offer, so the island stays closed. */
export const CheckFailed: Story = {
  args: { updateStatus: status({ phase: "error", availableVersion: null, errorCode: "check_failed" }) },
};
