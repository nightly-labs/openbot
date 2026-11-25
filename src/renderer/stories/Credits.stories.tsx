import type { BillingDetails } from "@openbot/contracts/billing-details";
import type { CreditsState } from "@openbot/contracts/credits";
import { CREDITS_UNAVAILABLE_STATE, EMPTY_CREDIT_ACTIVITY } from "@openbot/contracts/credits";
import { sourceText } from "@openbot/i18n/source";
import type { BillingDetailsCalls } from "@openbot/ui/features/billing/BillingDetailsFields";
import { BuyCreditsPage } from "@openbot/ui/features/credits/BuyCreditsPage";
import { CreditActivitySection } from "@openbot/ui/features/credits/CreditActivitySection";
import { CreditsExplainerDialog } from "@openbot/ui/features/credits/CreditsExplainerDialog";
import { CreditsSection } from "@openbot/ui/features/credits/CreditsSection";
import { type CreditsCalls, createCreditsStore } from "@openbot/ui/features/credits/credits-store";
import { RedeemCreditsDialog } from "@openbot/ui/features/credits/RedeemCreditsDialog";
import { createSignal, untrack } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createMockCredits } from "../src/preview/mock-credits";

function detailsCalls(initial: BillingDetails): BillingDetailsCalls {
  let details = initial;
  return {
    getDetails: async () => details,
    setDetails: async (request) => {
      details = { country: request.country, vatId: request.vatId ?? null };
      return details;
    },
  };
}

const NEW_BUYER: BillingDetails = { country: null, vatId: null, suggestedCountry: "DE" };
const KNOWN_BUYER: BillingDetails = { country: "US", vatId: null };

function BuyStory(props: { calls: CreditsCalls; details?: BillingDetails; serverId?: string }) {
  const calls = untrack(() => props.calls);
  const store = createCreditsStore(
    () => calls,
    () => true,
  );
  const details = detailsCalls(props.details ?? KNOWN_BUYER);
  return (
    <BuyCreditsPage store={store} initialServerId={props.serverId} billingDetails={details} onClose={() => undefined} />
  );
}

function SectionStory(props: { calls: CreditsCalls }) {
  const calls = untrack(() => props.calls);
  const store = createCreditsStore(
    () => calls,
    () => true,
    undefined,
    { activity: true },
  );
  return (
    <main class="foundation-story" style={{ "max-width": "640px" }}>
      <CreditsSection store={store} onBuy={() => undefined} />
      <CreditActivitySection store={store} />
    </main>
  );
}

function ExplainerStory() {
  const [open, setOpen] = createSignal(true);
  return <CreditsExplainerDialog open={open()} onOpenChange={setOpen} onOpenPrices={() => undefined} />;
}

function fixedCalls(state: CreditsState): CreditsCalls {
  return {
    getState: async () => state,
    getActivity: async () => EMPTY_CREDIT_ACTIVITY,
    openCheckout: async () => undefined,
    transfer: async () => state,
    redeem: () => Promise.reject(new Error(sourceText("error.billing.creditCodeInvalid"))),
  };
}

function RedeemStory() {
  const calls = createMockCredits();
  const store = createCreditsStore(
    () => calls,
    () => true,
  );
  return (
    <RedeemCreditsDialog
      store={store}
      target={{ serverId: null, name: "You", role: null, balance: 640.5 }}
      onClose={() => undefined}
    />
  );
}

const meta = {
  title: "Account/Credits",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const BuyForYou: Story = { render: () => <BuyStory calls={createMockCredits()} details={NEW_BUYER} /> };

export const BuyForServer: Story = { render: () => <BuyStory calls={createMockCredits()} serverId="team" /> };

export const BuyUnavailable: Story = { render: () => <BuyStory calls={fixedCalls(CREDITS_UNAVAILABLE_STATE)} /> };

export const BuyLoadError: Story = {
  render: () => (
    <BuyStory
      calls={{
        ...createMockCredits(),
        getState: () => Promise.reject(new Error("Network unavailable")),
      }}
    />
  ),
};

export const RedeemCode: Story = { render: () => <RedeemStory /> };

export const BillingSection: Story = { render: () => <SectionStory calls={createMockCredits()} /> };

export const Explainer: Story = { render: () => <ExplainerStory /> };
