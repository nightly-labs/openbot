import { serverStorageGb } from "@openbot/contracts/billing";
import { StorageTierDialog, type StorageTierDialogProps } from "@openbot/ui/features/billing/StorageTierDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { previewStorageFields } from "../src/preview/mock-billing";

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

export const Low: Story = { render: () => <StarterDialog /> };

const standard = { plan: "standard", interval: "year", currency: "usd" } as const;
const standardFields = previewStorageFields(standard, 1);

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

export const Pending: Story = { render: () => <StarterDialog pending /> };

export const PaymentFailed: Story = {
  render: () => <StarterDialog error="The payment for the storage failed. Update the payment method and try again." />,
};

export const Billing: Story = { render: () => <StarterDialog mode="billing" disk={undefined} /> };
