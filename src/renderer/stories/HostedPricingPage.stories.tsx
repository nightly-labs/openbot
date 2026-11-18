import type { BillingDetailsDraft } from "@openbot/ui/features/billing/BillingDetailsFields";
import { HostedPricingPage } from "@openbot/ui/features/servers/HostedPricingPage";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MOCK_HOSTED_SERVER_CATALOG } from "../src/preview/mock-hosted-servers";

/**
 * The plan picker of Add server, with the billing country and the EU VAT ID above the order button. The order
 * button stays off until a country is chosen. Nothing leaves the browser.
 */
function PricingStory(props: { details: BillingDetailsDraft; offerLicense?: boolean }) {
  const [details, setDetails] = createSignal(props.details);
  return (
    <HostedPricingPage
      overlay
      plans={MOCK_HOSTED_SERVER_CATALOG.plans}
      currency="eur"
      offerLicense={props.offerLicense ?? true}
      used={3}
      thisComputer
      busy={false}
      error={null}
      billingDetails={details()}
      onBillingDetailsChange={setDetails}
      onSubmit={() => undefined}
      onClose={() => undefined}
      onOpenPrivacy={() => undefined}
      onOpenTerms={() => undefined}
      onContactUs={() => undefined}
    />
  );
}

const meta = {
  title: "Team/Hosted Pricing Page",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A first purchase: no billing country yet, so the order button is off. */
export const NoBillingCountry: Story = {
  render: () => <PricingStory details={{ country: null, vatId: "" }} />,
};

/**
 * A consumer in Germany. The optional EU VAT ID shows, with DE as its placeholder. A server order also asks that the
 * hosting service begin before the withdrawal period ends: the order button stays off until both boxes are ticked.
 */
export const EuCountry: Story = {
  render: () => <PricingStory details={{ country: "DE", vatId: "" }} />,
};

/**
 * A VAT ID that is not one of the country. The error shows when the field loses focus. A buyer with a VAT ID is a
 * business, so the early start box does not show.
 */
export const EuCountryWrongVatId: Story = {
  render: () => <PricingStory details={{ country: "FR", vatId: "DE123456789" }} />,
};

/** A buyer outside the EU: no VAT ID field. */
export const OutsideEu: Story = {
  render: () => <PricingStory details={{ country: "US", vatId: "" }} />,
};
