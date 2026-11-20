import type { BillingDetailsDraft } from "@openbot/ui/features/billing/BillingDetailsFields";
import { HostedPricingPage } from "@openbot/ui/features/servers/HostedPricingPage";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MOCK_HOSTED_SERVER_CATALOG } from "../src/preview/mock-hosted-servers";

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

export const NoBillingCountry: Story = {
  render: () => <PricingStory details={{ country: null, vatId: "" }} />,
};

export const EuCountry: Story = {
  render: () => <PricingStory details={{ country: "DE", vatId: "" }} />,
};

export const EuCountryWrongVatId: Story = {
  render: () => <PricingStory details={{ country: "FR", vatId: "DE123456789" }} />,
};

export const UnitedKingdom: Story = {
  render: () => <PricingStory details={{ country: "GB", vatId: "" }} />,
};

export const OutsideEu: Story = {
  render: () => <PricingStory details={{ country: "US", vatId: "" }} />,
};
