import { AccountUsageDetails } from "@openbot/ui/features/account/AccountUsageDetails";
import {
  type AccountUsageProviderRow,
  accountUsageProviderRows,
} from "@openbot/ui/features/account/account-usage-view";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const nowSeconds = Math.floor(Date.now() / 1_000);
const fiveHourReset = nowSeconds + 2 * 3_600 + 14 * 60;
const weeklyReset = nowSeconds + 4 * 86_400 + 6 * 3_600;

const mixedRows = accountUsageProviderRows({
  limits: [
    {
      id: "codex",
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: fiveHourReset },
      secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: weeklyReset },
    },
    {
      id: "claude",
      primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: fiveHourReset },
      secondary: { usedPercent: 64, windowDurationMins: 10_080, resetsAt: weeklyReset },
    },
    {
      id: "grok",
      primary: null,
      secondary: { usedPercent: 22, windowDurationMins: 10_080, resetsAt: weeklyReset },
    },
  ],
});

const oneProviderRows = mixedRows.filter((row) => row.provider === "codex");
const unreportedRows = accountUsageProviderRows(
  {
    limits: [
      {
        id: "codex",
        primary: null,
        secondary: { usedPercent: 42, windowDurationMins: 10_080, resetsAt: weeklyReset },
      },
    ],
  },
  [
    { id: "grok", state: "available" },
    { id: "antigravity", state: "available" },
  ],
);
const warningRows = accountUsageProviderRows({
  limits: [
    {
      id: "claude",
      primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: fiveHourReset },
      secondary: { usedPercent: 71, windowDurationMins: 10_080, resetsAt: weeklyReset },
    },
  ],
});

function UsagePopover(props: { rows: AccountUsageProviderRow[]; loading?: boolean; error?: string | null }) {
  return (
    <div class="ui-popover-menu-surface account-usage-popover">
      <AccountUsageDetails
        rows={props.rows}
        loading={props.loading ?? false}
        error={props.error ?? null}
        refreshActive={false}
        refreshDisabled={false}
        onRefresh={fn()}
        title={<h2 class="account-usage-popover-title">Usage</h2>}
      />
    </div>
  );
}

const meta = {
  title: "Account/Usage",
  component: UsagePopover,
  args: { rows: mixedRows },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof UsagePopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectedProviders: Story = {};

export const OneProvider: Story = {
  args: { rows: oneProviderRows },
};

export const Warning: Story = {
  args: { rows: warningRows },
};

export const UnreportedProvider: Story = {
  args: { rows: unreportedRows },
};

export const RefreshingUnreportedProvider: Story = {
  args: { rows: unreportedRows, loading: true },
};

export const Loading: Story = {
  args: { rows: [], loading: true },
};

export const Empty: Story = {
  args: { rows: [] },
};

export const ErrorState: Story = {
  args: { rows: oneProviderRows, error: "Usage is unavailable." },
};
