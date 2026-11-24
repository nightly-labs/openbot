import type { BillingPlanId } from "@openbot/contracts/billing";
import { type LicenseTier, pricingOrderSearch } from "@openbot/contracts/license";
import type { TranslatedLocale } from "@openbot/i18n";
import { Checkbox } from "@openbot/ui/checkbox";
import { OrderForm, type OrderFormOrder } from "@openbot/ui/features/billing/OrderForm";
import { TextProvider, useText } from "@openbot/ui/text";
import { Link } from "@tanstack/solid-router";
import { type Accessor, createSignal, createUniqueId, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { PRICING_ROUTE, type PricingOffer } from "../../lib/pricing-page";
import { LandingFooter } from "../landing/LandingFooter";
import { LandingGlow } from "../landing/LandingGlow";
import { SiteHeader } from "../landing/SiteHeader";
import { useSitePath } from "../landing/SiteText";
import { ButtonLink } from "../ui/button";
import { CONSENT_POLICY_MARKER, CONSENT_TERMS_MARKER, type PricingPageText } from "./pricing-page-text";
import "./PricingPage.css";

const RARITY = [
  { rgb: "154, 163, 184" },
  { rgb: "56, 168, 255" },
  { rgb: "56, 71, 255" },
  { rgb: "164, 108, 245" },
  { rgb: "236, 72, 153" },
  { rgb: "255, 106, 43" },
] as const;

const LICENSE_RARITY_STEPS: Record<LicenseTier | "none", number> = { none: 0, starter: 1, team: 2 };

const FIRST_SERVER: BillingPlanId = "standard";
const FIRST_LICENSE: LicenseTier = "team";

const CONSENT_MARKERS = new RegExp(`(${CONSENT_POLICY_MARKER}|${CONSENT_TERMS_MARKER})`);

function Consent(props: {
  id: string;
  text: PricingPageText["consent"];
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const path = useSitePath();
  const part = (piece: string) => {
    if (piece === CONSENT_POLICY_MARKER) {
      return (
        <Link to={path("/privacy")} target="_blank" rel="noopener">
          {props.text.policy}
        </Link>
      );
    }
    if (piece === CONSENT_TERMS_MARKER) {
      return (
        <Link to={path("/terms")} target="_blank" rel="noopener">
          {props.text.terms}
        </Link>
      );
    }
    return piece;
  };
  const pieces = () => props.text.statement.split(CONSENT_MARKERS).filter((piece) => piece !== "");
  return (
    <div class="pricing-consent">
      <Checkbox
        id={props.id}
        class="pricing-consent-box"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <label id={`${props.id}-label`} for={props.id} class="pricing-consent-label">
        {pieces().map(part)}
      </label>
    </div>
  );
}

function OrderAction(props: {
  order: Accessor<OrderFormOrder>;
  consent: PricingPageText["consent"];
  accepted: Accessor<boolean>;
  onAccept: (accepted: boolean) => void;
}) {
  const { t } = useText();
  const id = `pricing-consent-${createUniqueId()}`;
  const buying = () => props.order().server !== null || props.order().license !== null;
  const start = () => (props.order().server === null ? "license" : "server");
  const label = () => (props.order().server === null ? t("billing.order.cta.license") : t("billing.order.cta.server"));
  const blocked = () => !props.accepted();
  const download = () => (
    <ButtonLink to="/download" variant="secondary" size="md" icon="download" class="pricing-cta">
      {t("billing.order.cta.download")}
    </ButtonLink>
  );
  return (
    <Show when={buying()} fallback={download()}>
      <div class="pricing-consent-action">
        <Consent id={id} text={props.consent} checked={props.accepted()} onChange={props.onAccept} />
        <ButtonLink
          to="/app"
          search={{ start: start(), ...pricingOrderSearch(props.order()) }}
          reloadDocument
          variant="primary"
          size="md"
          icon="arrow-right"
          class="pricing-cta"
          disabled={blocked()}
          aria-describedby={`${id}-label`}
        >
          {label()}
        </ButtonLink>
      </div>
    </Show>
  );
}

function ContactAction() {
  const { t } = useText();
  const path = useSitePath();
  return (
    <ButtonLink to={path("/contact")} variant="primary" size="md" icon="contact" class="pricing-cta">
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
  const [accepted, setAccepted] = createSignal(false);

  const path = useSitePath();

  onSettled(() => landingAnalytics.start(document, window.location.hostname, PRICING_ROUTE));

  const rarity = () => {
    const size = props.offer.plans.findIndex((plan) => plan.id === order().server) + 1;
    const step = size + LICENSE_RARITY_STEPS[order().license ?? "none"];
    return RARITY[Math.min(RARITY.length - 1, step)] ?? RARITY[0];
  };
  const heading = () => (
    <div class="landing-section-heading pricing-heading">
      <h1 id="pricing-title">{props.text.heading}</h1>
    </div>
  );
  const action = (current: Accessor<OrderFormOrder>) => (
    <OrderAction order={current} consent={props.text.consent} accepted={accepted} onAccept={setAccepted} />
  );
  const contact = () => <ContactAction />;
  const remember = (next: OrderFormOrder) => setOrder({ server: next.server, license: next.license?.tier ?? null });

  return (
    <div class="landing-page pricing-page" lang={props.lang}>
      <SiteHeader page="landing" />
      <main>
        <section
          class="landing-hero pricing-hero"
          aria-labelledby="pricing-title"
          style={{ "--pricing-accent": rarity().rgb }}
        >
          <section class="pricing-enterprise pricing-personal" aria-labelledby="pricing-personal">
            <div>
              <h2 id="pricing-personal">{props.text.personal.title}</h2>
              <p class="pricing-enterprise-body">{props.text.personal.body}</p>
            </div>
            <ButtonLink to="/download" variant="primary" size="md" icon="download">
              {props.text.personal.download}
            </ButtonLink>
          </section>

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
            <ButtonLink to={path("/contact")} variant="primary" size="md" icon="contact">
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
