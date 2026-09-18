import { expect, fn, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AccountUsageDetails } from "../src/features/account/AccountUsageDetails";
import { type AccountUsageProviderRow, accountUsageProviderRows } from "../src/features/account/account-usage-view";

const mixedRows = accountUsageProviderRows({
  limits: [
    {
      id: "codex",
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1_786_563_600 },
      secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
    },
    {
      id: "claude",
      primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_786_563_600 },
      secondary: { usedPercent: 64, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
    },
    {
      id: "grok",
      primary: null,
      secondary: { usedPercent: 22, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
    },
  ],
});

const oneProviderRows = mixedRows.filter((row) => row.provider === "codex");
const warningRows: AccountUsageProviderRow[] = mixedRows.map((row) =>
  row.provider === "claude" ? { ...row, remainingPercent: 29, windowLabel: "Weekly", tone: "warning" } : row,
);

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

export const ConnectedProviders: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    await expect(canvas.getByText("ChatGPT")).toBeInTheDocument();
    await expect(canvas.getByText("Claude")).toBeInTheDocument();
    await expect(canvas.getByText("Grok")).toBeInTheDocument();
    await expect(canvas.getByText("0% left")).toBeInTheDocument();
  },
};

export const OneProvider: Story = {
  args: { rows: oneProviderRows },
};

export const Warning: Story = {
  args: { rows: warningRows },
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
