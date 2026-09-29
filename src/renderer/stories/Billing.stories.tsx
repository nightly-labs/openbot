import type { BillingState } from "@openbot/contracts/billing";
import { BillingDialog } from "@openbot/ui/features/billing/BillingDialog";
import { BillingPanel } from "@openbot/ui/features/billing/BillingPanel";
import { type BillingCalls, createBillingStore } from "@openbot/ui/features/billing/billing-store";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createMockBilling, previewBillingServers } from "../src/preview/mock-billing";

/** Calls that always return one state. The Portal does nothing. */
function fixedCalls(state: BillingState): BillingCalls {
  return {
    getState: async () => structuredClone(state),
    openPortal: async () => undefined,
  };
}

function BillingStory(props: { calls: BillingCalls }) {
  const store = createBillingStore(
    () => props.calls,
    () => true,
  );
  return (
    <main class="foundation-story" style={{ "max-width": "640px" }}>
      <BillingPanel store={store} available />
    </main>
  );
}

function BillingDialogStory(props: { calls: BillingCalls }) {
  const [open, setOpen] = createSignal(true);
  const store = createBillingStore(() => props.calls, open);
  return <BillingDialog open={open()} onOpenChange={setOpen} store={store} />;
}

const meta = {
  title: "Account/Billing",
  component: BillingStory,
  args: { calls: createMockBilling() },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BillingStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three servers: an active yearly plan, a failed payment, and a plan that ends. Cancel and Renew act as Stripe would. */
export const Servers: Story = { render: () => <BillingStory calls={createMockBilling()} /> };

export const OneServer: Story = {
  render: () => <BillingStory calls={createMockBilling(previewBillingServers().slice(0, 1))} />,
};

/** The account has paid before, but no server has an open plan. */
export const NoPlans: Story = {
  render: () => <BillingStory calls={fixedCalls({ available: true, hasCustomer: true, servers: [] })} />,
};

export const Loading: Story = {
  render: () => (
    <BillingStory calls={{ ...createMockBilling(), getState: () => new Promise<BillingState>(() => undefined) }} />
  ),
};

export const LoadError: Story = {
  render: () => (
    <BillingStory
      calls={{
        ...createMockBilling(),
        getState: async () => {
          throw new Error("The account server could not be reached.");
        },
      }}
    />
  ),
};

/** The account server has no Stripe key. */
export const Unavailable: Story = {
  render: () => <BillingStory calls={fixedCalls({ available: false, hasCustomer: false, servers: [] })} />,
};

/** The web client shows the panel in a dialog from the account menu. */
export const WebDialog: Story = { render: () => <BillingDialogStory calls={createMockBilling()} /> };
