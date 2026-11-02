import type { BillingPlanId } from "@openbot/contracts/billing";
import { type LicenseTier, pricingOrderSearch } from "@openbot/contracts/license";
import type { TranslatedLocale } from "@openbot/i18n";
import { OrderForm, type OrderFormOrder } from "@openbot/ui/features/billing/OrderForm";
import { TextProvider, useText } from "@openbot/ui/text";
import { type Accessor, createSignal, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { PRICING_ROUTE, type PricingOffer } from "../../lib/pricing-page";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingGlow } from "../landing/LandingGlow";
import { SiteHeader } from "../landing/SiteHeader";
import { ButtonLink } from "../ui/button";
import type { PricingPageText } from "./pricing-page-text";
import "./PricingPage.css";

/**
 * Like loot rarity in a game: a bigger order gives a rarer colour to the glow of the form. The steps are silver,
 * sky, blue, violet, pink and orange.
 */
const RARITY = [
  { rgb: "154, 163, 184" },
  { rgb: "56, 168, 255" },
  { rgb: "56, 71, 255" },
  { rgb: "164, 108, 245" },
  { rgb: "236, 72, 153" },
  { rgb: "255, 106, 43" },
] as const;

/** A license moves the colour: Standard with the Team license is pink, and Pro with it is orange. */
const LICENSE_RARITY_STEPS: Record<LicenseTier | "none", number> = { none: 0, starter: 1, team: 2 };

/** Yearly billing, the Standard server and the Team license are the default. */
const FIRST_SERVER: BillingPlanId = "standard";
const FIRST_LICENSE: LicenseTier = "team";

/**
 * A full page load, as the header's App link. The web app reads `start` and the order after sign-in: an order with
 * a server opens the add server dialog, which sells the server and its license together, and a license alone opens
 * Billing. Each one fills in the order and goes on to Checkout, so the buyer does not choose again.
 */
function OrderAction(props: { order: Accessor<OrderFormOrder> }) {
  const { t } = useText();
  const buying = () => props.order().server !== null || props.order().license !== null;
  const start = () => (props.order().server === null ? "license" : "server");
  const label = () => (props.order().server === null ? t("billing.order.cta.license") : t("billing.order.cta.server"));
  const download = () => (
    <ButtonLink to="/download" variant="secondary" size="md" icon="download" class="pricing-cta">
      {t("billing.order.cta.download")}
    </ButtonLink>
  );
  return (
    <Show when={buying()} fallback={download()}>
      <ButtonLink
        to="/app"
        search={{ start: start(), ...pricingOrderSearch(props.order()) }}
        reloadDocument
        variant="primary"
        size="md"
        icon="arrow-right"
        class="pricing-cta"
      >
        {label()}
      </ButtonLink>
    </Show>
  );
}

/** A team larger than the license allows talks to us about the price. */
function ContactAction() {
  const { t } = useText();
  return (
    <ButtonLink to="/contact" variant="primary" size="md" icon="contact" class="pricing-cta">
      {t("billing.license.contact.action")}
    </ButtonLink>
  );
}

export function PricingPage(props: {
  text: PricingPageText;
  offer: PricingOffer;
  lang: string;
  locale: TranslatedLocale;
}) {
  const [order, setOrder] = createSignal<{ server: BillingPlanId | null; license: LicenseTier | null }>({
    server: FIRST_SERVER,
    license: FIRST_LICENSE,
  });

  onSettled(() => landingAnalytics.start(document, window.location.hostname, PRICING_ROUTE));

  const rarity = () => {
    const size = props.offer.plans.findIndex((plan) => plan.id === order().server) + 1;
    const step = size + LICENSE_RARITY_STEPS[order().license ?? "none"];
    return RARITY[Math.min(RARITY.length - 1, step)] ?? RARITY[0];
  };
  // Component props get named functions, not JSX: JSX or a conditional in a prop moves the hydration keys.
  const heading = () => (
    <div class="landing-section-heading pricing-heading">
      <h1 id="pricing-title">{props.text.heading}</h1>
    </div>
  );
  const action = (current: Accessor<OrderFormOrder>) => <OrderAction order={current} />;
  const contact = () => <ContactAction />;
  const remember = (next: OrderFormOrder) => setOrder({ server: next.server, license: next.license?.tier ?? null });

  return (
    <div class="landing-page pricing-page" lang={props.lang}>
      <SiteHeader page="landing" />
      <main>
        {/* The accent colour of the whole hero follows the size of the order. */}
        <section
          class="landing-hero pricing-hero"
          aria-labelledby="pricing-title"
          style={{ "--pricing-accent": rarity().rgb }}
        >
          <TextProvider locale={props.locale}>
            <OrderForm
              plans={props.offer.plans}
              inEu={props.offer.inEu}
              licenseTrialEnd={props.offer.licenseTrialEnd}
              initialServer={FIRST_SERVER}
              initialLicense={FIRST_LICENSE}
              heading={heading}
              action={action}
              contact={contact}
              onOrderChange={remember}
            />
          </TextProvider>

          <section class="pricing-enterprise" aria-labelledby="pricing-enterprise">
            <div>
              <h2 id="pricing-enterprise">{props.text.enterprise.title}</h2>
              <p class="pricing-enterprise-body">{props.text.enterprise.body}</p>
            </div>
            <ButtonLink to="/contact" variant="primary" size="md" icon="contact">
              {props.text.enterprise.contact}
            </ButtonLink>
          </section>
        </section>
      </main>
      <LandingFooter />
      <LandingGlow />
    </div>
  );
}
