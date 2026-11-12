import { ServerUpgradeDialog } from "@openbot/ui/features/servers/ServerUpgradeDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * The offer of the next plan when the disk of a hosted server is almost full. It shows once at "low"
 * and once more at "full"; the sidebar storage card stays after "Not now".
 */
const meta = {
  title: "Servers/Server upgrade",
  parameters: {
    a11y: { test: "error" },
    viewport: {
      options: {
        upgradePhone: { name: "Phone — 390 × 844", styles: { width: "390px", height: "844px" } },
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const GB = 1024 ** 3;

const actions = { onUpgrade: fn(), onFreeUpSpace: fn(), onClose: fn() };

function LowDialog() {
  return (
    <ServerUpgradeDialog
      serverName="Acme HQ"
      level="low"
      freeBytes={1 * GB}
      totalBytes={12 * GB}
      plan="starter"
      nextPlan="standard"
      interval="month"
      currency="eur"
      amount={null}
      pending={false}
      error={null}
      {...actions}
    />
  );
}

/** A Starter server with 1 GB of its 12 GB disk free. The offer is Standard. */
export const Low: Story = { render: LowDialog };

/** A Standard server on a yearly plan in dollars, with less than 1 GB free. The offer is Pro. */
export const Full: Story = {
  render: () => (
    <ServerUpgradeDialog
      serverName="Research lab with a very long server name"
      level="full"
      freeBytes={0.4 * GB}
      totalBytes={50 * GB}
      plan="standard"
      nextPlan="pro"
      interval="year"
      currency="usd"
      amount={null}
      pending={false}
      error={null}
      {...actions}
    />
  ),
};

/** The Customer Portal did not open. */
export const PortalFailed: Story = {
  render: () => (
    <ServerUpgradeDialog
      serverName="Acme HQ"
      level="low"
      freeBytes={1 * GB}
      totalBytes={12 * GB}
      plan="starter"
      nextPlan="standard"
      interval="month"
      currency="eur"
      amount={null}
      pending={false}
      error="Could not open billing management."
      {...actions}
    />
  ),
};

/** The web client at phone width. */
export const Narrow: Story = {
  globals: { viewport: { value: "upgradePhone", isRotated: false } },
  render: LowDialog,
};
