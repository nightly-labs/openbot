import { serverStorageGb } from "@openbot/contracts/billing";
import { StorageTierDialog, type StorageTierDialogProps } from "@openbot/ui/features/billing/StorageTierDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { previewStorageFields } from "../src/preview/mock-billing";

/*
 * The choice of a larger storage tier for a hosted server on a VPS. The sidebar offers it once at "low"
 * and once more at "full" disk; Billing opens it from "Add storage". Prices are the list prices.
 */
const meta = {
  title: "Servers/Storage tiers",
  parameters: {
    a11y: { test: "error" },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const GB = 1024 ** 3;

const actions = { onBuy: fn(), onFreeUpSpace: fn(), onClose: fn() };

const starter = { plan: "starter", interval: "month", currency: "eur" } as const;
const starterFields = previewStorageFields(starter, 0);

/** A Starter server at 25 GB, on a monthly plan in euros. */
const starterProps: StorageTierDialogProps = {
  mode: "offer",
  serverName: "Acme HQ",
  disk: { level: "low", freeBytes: 2 * GB, totalBytes: 25 * GB },
  storageGb: serverStorageGb({ ...starter, ...starterFields }),
  interval: starter.interval,
  currency: starter.currency,
  amount: starterFields.amount,
  upgrades: starterFields.storageUpgrades ?? [],
  pending: false,
  error: null,
  ...actions,
};

function StarterDialog(props: Partial<StorageTierDialogProps>) {
  return <StorageTierDialog {...starterProps} {...props} />;
}

/** The sidebar offer for a Starter server with 2 GB of its 25 GB free. It can add 50 or 100 GB. */
export const Low: Story = { render: () => <StarterDialog /> };

const standard = { plan: "standard", interval: "year", currency: "usd" } as const;
const standardFields = previewStorageFields(standard, 1);

/** A Standard server on a yearly plan in dollars, already at 125 GB, with less than 1 GB free. Only 200 GB is left. */
export const Full: Story = {
  render: () => (
    <StorageTierDialog
      {...starterProps}
      serverName="Research lab with a very long server name"
      disk={{ level: "full", freeBytes: 0.6 * GB, totalBytes: 125 * GB }}
      storageGb={serverStorageGb({ ...standard, ...standardFields })}
      interval={standard.interval}
      currency={standard.currency}
      amount={standardFields.amount}
      upgrades={standardFields.storageUpgrades ?? []}
    />
  ),
};

/** The account server is adding the storage. */
export const Pending: Story = { render: () => <StarterDialog pending /> };

/** The payment for the storage failed. */
export const PaymentFailed: Story = {
  render: () => <StarterDialog error="The payment for the storage failed. Update the payment method and try again." />,
};

/** "Add storage" in Billing: no disk meter and no description. */
export const Billing: Story = { render: () => <StarterDialog mode="billing" disk={undefined} /> };
