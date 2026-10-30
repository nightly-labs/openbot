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

/** The end of the license promotion: a new license is free until then. */
const TRIAL_END = Date.UTC(2026, 11, 1);

/** Active server plans only, so the failed-payment alert of a server does not hide the license. */
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
    // One month after the story opens, so the renewal date is never in the past.
    currentPeriodEnd: Date.now() + 30 * DAY,
    cancelAtPeriodEnd: false,
    ...change,
  };
}

/** The Billing panel with the license section above the server plans. */
function LicenseStory(props: { calls: LicenseDesktopApi }) {
  const billing = createBillingStore(
    () => createMockBilling(SERVERS),
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
        license={<LicenseSection store={store} onManagePayment={() => undefined} onContactUs={() => undefined} />}
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

/** No license, and 4 people use the owner's servers. "Buy a license" opens the slider dialog at 4 people. */
export const Buy: Story = story({});

/** No license, and only the owner. The dialog starts on the Starter license. */
export const BuyStarter: Story = story({ used: 1, users: previewLicenseUsers().slice(0, 1) });

/** No license, and the account pays for a server. Each license has the bundle price. */
export const BuyWithServer: Story = story({
  used: 1,
  users: previewLicenseUsers().slice(0, 1),
  bundle: true,
});

/** No license and no open subscription. The dialog uses the currency of the time zone. */
export const BuyNewCustomer: Story = story({ currency: null, used: 1, users: previewLicenseUsers().slice(0, 1) });

/** No license, and the account pays in złoty. */
export const BuyPln: Story = story({ currency: "pln" });

/** A promotion: a new license is free until 1 December, and Stripe charges its first payment then. */
export const BuyTrial: Story = story({ trialEnd: TRIAL_END });

/** A license in its free trial. */
export const Trial: Story = story({
  license: license(5, { status: "trialing", currentPeriodEnd: TRIAL_END }),
  trialEnd: TRIAL_END,
});

/** A Starter license. The row menu has Change to Team in place of Change users. */
export const Starter: Story = story({
  license: license(1, {}, { tier: "starter", interval: "month", bundle: false }),
  used: 1,
  users: previewLicenseUsers().slice(0, 1),
});

/** A Starter license that 3 people use: the warning offers Change to Team. */
export const StarterOverLimit: Story = story({
  license: license(1, {}, { tier: "starter", interval: "month", bundle: true }),
  bundle: true,
  used: 3,
});

/** A yearly Team license. The row shows the yearly price, and the menu has no Change to yearly. */
export const TeamYearly: Story = story({ license: license(7, {}, { tier: "team", interval: "year", bundle: false }) });

/** 4 of 10 users. The row menu has Users, Change users, Update payment method and Cancel. */
export const Active: Story = story({ license: license(10) });

/** More people use the license than it pays for: a warning with "Change users". */
export const OverLimit: Story = story({ license: license(5), used: 7 });

/** The renewal payment failed. */
export const PaymentFailed: Story = story({ license: license(10, { status: "past_due" }) });

/** The license ends at the end of its period. The menu has Renew. */
export const Cancelling: Story = story({ license: license(10, { cancelAtPeriodEnd: true }) });

/** A member of a server whose owner has a license. */
export const CoveredBy: Story = story({
  used: 1,
  users: previewLicenseUsers().slice(0, 1),
  coveredBy: [{ ownerName: "Ana Kowalska", ownerEmail: "ana@example.com" }],
});

/** The license ended. The account can buy a new one. */
export const Ended: Story = story({
  license: license(10, { status: "canceled", currentPeriodEnd: Date.now() - 3 * DAY }),
});

/** The account server has no license price. Only the server plans show. */
export const Unavailable: Story = story({ available: false });
