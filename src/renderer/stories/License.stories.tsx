import type { BillingDetails } from "@openbot/contracts/billing-details";
import type { LicenseDesktopApi } from "@openbot/contracts/ipc";
import { type License, type LicensePlan, type LicenseState, licenseMonthlyAmount } from "@openbot/contracts/license";
import { BillingPanel } from "@openbot/ui/features/billing/BillingPanel";
import { createBillingStore } from "@openbot/ui/features/billing/billing-store";
import { LicenseSection } from "@openbot/ui/features/billing/LicenseSection";
import { createLicenseStore } from "@openbot/ui/features/billing/license-store";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createMockBilling, previewBillingServers } from "../src/preview/mock-billing";
import { createMockLicense, previewLicenseUsers } from "../src/preview/mock-license";

const DAY = 24 * 60 * 60_000;

const TRIAL_END = Date.UTC(2026, 11, 1);

const SERVERS = previewBillingServers().filter((server) => server.status === "active");

function license(
  users: number,
  change: Partial<License> = {},
  plan: LicensePlan = { tier: "team", interval: "month", bundle: false },
): License {
  return {
    subscriptionId: "sub_story_license",
    users,
    currency: "eur",
    amount: licenseMonthlyAmount(plan, users, "eur"),
    ...plan,
    status: "active",
    currentPeriodEnd: Date.now() + 30 * DAY,
    cancelAtPeriodEnd: false,
    ...change,
  };
}

function LicenseStory(props: { calls: LicenseDesktopApi; details?: BillingDetails }) {
  const api = createMockBilling(SERVERS, props.details);
  const billing = createBillingStore(
    () => api,
    () => true,
  );
  const store = createLicenseStore(
    () => props.calls,
    () => true,
  );
  return (
    <main class="foundation-story" style={{ "max-width": "720px" }}>
      <BillingPanel
        store={billing}
        available
        license={
          <LicenseSection
            store={store}
            billingDetails={props.details ? api : undefined}
            onManagePayment={() => undefined}
            onContactUs={() => undefined}
          />
        }
      />
    </main>
  );
}

function story(initial: Partial<LicenseState>): Story {
  return { render: () => <LicenseStory calls={createMockLicense(initial)} /> };
}

const meta = {
  title: "Account/Billing/License",
  component: LicenseStory,
  args: { calls: createMockLicense() },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof LicenseStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Buy: Story = story({});

export const BuyBillingCountry: Story = {
  render: () => <LicenseStory calls={createMockLicense({})} details={{ country: null, vatId: null }} />,
};

export const BuyBillingCountryGuessed: Story = {
  render: () => (
    <LicenseStory calls={createMockLicense({})} details={{ country: null, vatId: null, suggestedCountry: "FR" }} />
  ),
};

export const BuyBillingCountrySaved: Story = {
  render: () => <LicenseStory calls={createMockLicense({})} details={{ country: "DE", vatId: "DE123456789" }} />,
};

export const BuyStarter: Story = story({ used: 1, users: previewLicenseUsers().slice(0, 1) });

export const BuyWithServer: Story = story({
  used: 1,
  users: previewLicenseUsers().slice(0, 1),
  bundle: true,
});

export const BuyNewCustomer: Story = story({ currency: null, used: 1, users: previewLicenseUsers().slice(0, 1) });

export const BuyPln: Story = story({ currency: "pln" });

export const BuyTrial: Story = story({ trialEnd: TRIAL_END });

export const Trial: Story = story({
  license: license(5, { status: "trialing", currentPeriodEnd: TRIAL_END }),
  trialEnd: TRIAL_END,
});

export const Starter: Story = story({
  license: license(1, {}, { tier: "starter", interval: "month", bundle: false }),
  used: 1,
  users: previewLicenseUsers().slice(0, 1),
});

export const StarterOverLimit: Story = story({
  license: license(1, {}, { tier: "starter", interval: "month", bundle: true }),
  bundle: true,
  used: 3,
});

export const TeamYearly: Story = story({ license: license(7, {}, { tier: "team", interval: "year", bundle: false }) });

export const Active: Story = story({ license: license(10) });

export const OverLimit: Story = story({ license: license(5), used: 7 });

export const PaymentFailed: Story = story({ license: license(10, { status: "past_due" }) });

export const Cancelling: Story = story({ license: license(10, { cancelAtPeriodEnd: true }) });

export const CoveredBy: Story = story({
  used: 1,
  users: previewLicenseUsers().slice(0, 1),
  coveredBy: [{ ownerName: "Ana Kowalska", ownerEmail: "ana@example.com" }],
});

export const Ended: Story = story({
  license: license(10, { status: "canceled", currentPeriodEnd: Date.now() - 3 * DAY }),
});

export const Unavailable: Story = story({ available: false });
