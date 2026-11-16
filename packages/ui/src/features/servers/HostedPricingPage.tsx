import { BILLING_PLANS, type BillingCurrency, type BillingPlanId } from "@openbot/contracts/billing";
import type { HostedServerCatalogPlan } from "@openbot/contracts/hosted-servers";
import { LICENSE_MAX_USERS, type LicenseTier, type PricingOrder } from "@openbot/contracts/license";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  ArrowRight,
  Button,
  Checkbox,
  ErrorReference,
  MessageSquare,
  Monitor,
  OctagonX,
  TriangleAlert,
} from "@openbot/ui";
import type { UserErrorDetails } from "@openbot/user-errors";
import { type Accessor, createSignal, createUniqueId, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { OrderForm, type OrderFormOrder } from "../billing/OrderForm";
import { PageHeader, type PageHeaderFrame } from "../window/PageHeader";
import { AddServerOtherOptions } from "./AddServerDialog";

/**
 * Like loot rarity in a game: a bigger order gives a rarer colour to the glow of the form, as on the web pricing
 * page (`apps/auth-api/src/components/pricing/PricingPage.tsx`). The steps are silver, sky, blue, violet, pink and
 * orange.
 */
const RARITY = ["154, 163, 184", "56, 168, 255", "56, 71, 255", "164, 108, 245", "236, 72, 153", "255, 106, 43"];

/** A license moves the colour: Standard with the Team license is pink, and Pro with it is orange. */
const LICENSE_RARITY_STEPS: Record<LicenseTier | "none", number> = { none: 0, starter: 1, team: 2 };

/** Yearly billing, the Standard server and the Team license are the default, as on the web page. */
const FIRST_SERVER: BillingPlanId = "standard";
const FIRST_LICENSE: LicenseTier = "team";

/** The largest team that the page sells to. A larger team contacts sales. */
const PRICING_MAX_MEMBERS = Math.max(LICENSE_MAX_USERS, ...BILLING_PLANS.map((plan) => plan.memberLimit));

/** Private-use characters that mark where the two links go in the consent sentence of each language. */
const CONSENT_POLICY_MARKER = "";
const CONSENT_TERMS_MARKER = "";
const CONSENT_MARKERS = new RegExp(`(${CONSENT_POLICY_MARKER}|${CONSENT_TERMS_MARKER})`);

export interface HostedPricingPageProps {
  plans: readonly HostedServerCatalogPlan[];
  currency?: BillingCurrency | undefined;
  /** A Stripe customer pays in one currency, so an account with open subscriptions cannot change it. */
  currencyLocked?: boolean | undefined;
  /** The people who use the account's servers now. A license must be for at least this many users. */
  used?: number | undefined;
  licenseTrialEnd?: number | undefined;
  /** False when the account has its own license: the order then starts without one. */
  offerLicense: boolean;
  /** True in the desktop app, which runs on the user's computer. The web client has no computer of its own. */
  thisComputer: boolean;
  /** Set when the account has as many hosted servers as it can have. */
  serverLimit?: number | null | undefined;
  /**
   * True when the page covers the whole app frame. Without it, the page fills its parent, such as the card of the
   * app window.
   */
  overlay?: boolean | undefined;
  /** In the top row of the app window, the header has no Back button, as on the other pages of the window. */
  headerFrame?: PageHeaderFrame | undefined;
  /** True while the order goes to the payment page. */
  busy: boolean;
  error: UserErrorDetails | null;
  /** The title of the error. Without it, the title says that the server could not be created. */
  errorTitle?: string | undefined;
  onSubmit: (order: PricingOrder) => void;
  onClose: () => void;
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
  onContactUs?: (() => void) | undefined;
  onManageServers?: (() => void) | undefined;
  onCreateLocal?: (() => void) | undefined;
  onInstallServer?: (() => void) | undefined;
  onJoinWithInvite?: (() => void) | undefined;
}

/**
 * The web pricing page in the app window, with the same layout: the switches, the order form, and Enterprise. The
 * app's page header takes the place of the site header and the big heading. The app is already on the user's computer, so it does not say that personal use is free.
 */
export function HostedPricingPage(props: HostedPricingPageProps) {
  const { t } = useText();
  const initialLicense = untrack(() => (props.offerLicense ? FIRST_LICENSE : null));
  const [order, setOrder] = createSignal<{ server: BillingPlanId | null; license: LicenseTier | null }>({
    server: FIRST_SERVER,
    license: initialLicense,
  });
  // The tick stays when the buyer changes the order.
  const [accepted, setAccepted] = createSignal(false);
  /** The switches of the order go in the header, as the filters of the usage page do. */
  const [controlsMount, setControlsMount] = createSignal<HTMLElement>();

  const accent = () => {
    const size = props.plans.findIndex((plan) => plan.id === order().server) + 1;
    const step = size + LICENSE_RARITY_STEPS[order().license ?? "none"];
    return RARITY[Math.min(RARITY.length - 1, step)] ?? RARITY[0];
  };
  const otherOptions = () => Boolean(props.onCreateLocal || props.onInstallServer || props.onJoinWithInvite);
  const action = (current: Accessor<OrderFormOrder>) => (
    <OrderAction
      order={current}
      accepted={accepted}
      onAccept={setAccepted}
      busy={props.busy}
      serverBlocked={props.serverLimit != null}
      thisComputer={props.thisComputer}
      onSubmit={props.onSubmit}
      onClose={props.onClose}
      onOpenPrivacy={props.onOpenPrivacy}
      onOpenTerms={props.onOpenTerms}
    />
  );
  const contact = () => (
    <Show when={props.onContactUs}>
      {(onContactUs) => (
        <Button class="hosted-pricing-pill" onClick={() => onContactUs()()}>
          <MessageSquare aria-hidden="true" />
          {t("billing.license.contact.action")}
        </Button>
      )}
    </Show>
  );
  // The order goes to the payment page: the page stays open until it is there, as Escape does.
  const back = () => {
    if (!props.busy) props.onClose();
  };
  const remember = (next: OrderFormOrder) => setOrder({ server: next.server, license: next.license?.tier ?? null });
  const noServerTitle = () => (props.thisComputer ? t("billing.order.server.thisComputer") : undefined);

  return (
    <section
      class="hosted-pricing-page"
      data-overlay={props.overlay ? "" : undefined}
      aria-labelledby="hosted-pricing-title"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || props.busy) return;
        event.preventDefault();
        props.onClose();
      }}
    >
      <PageHeader
        class="hosted-pricing-header"
        title={t("sitePage.pricing.heading")}
        headingId="hosted-pricing-title"
        onBack={back}
        frame={props.headerFrame}
      >
        <div class="hosted-pricing-header-controls" ref={setControlsMount} />
        <Show when={otherOptions()}>
          <AddServerOtherOptions
            disabled={props.busy}
            onCreateLocal={props.onCreateLocal}
            onInstallServer={props.onInstallServer}
            onJoinWithInvite={props.onJoinWithInvite}
          />
        </Show>
      </PageHeader>
      <div class="hosted-pricing-scroll">
        {/* The accent colour of the whole page follows the size of the order. */}
        <div class="hosted-pricing-hero" style={{ "--hosted-pricing-accent": accent() }}>
          <Show when={props.serverLimit ?? null}>
            {(limit) => (
              <Alert class="hosted-pricing-alert" tone="warning" role="alert">
                <AlertIcon>
                  <TriangleAlert />
                </AlertIcon>
                <AlertContent>
                  <AlertTitle>{t("server.add.limit.title")}</AlertTitle>
                  <AlertDescription>{t("server.add.limit.description", { count: limit() })}</AlertDescription>
                </AlertContent>
                <Show when={props.onManageServers}>
                  {(onManageServers) => (
                    <AlertActions>
                      <Button size="sm" onClick={() => onManageServers()()}>
                        {t("server.add.limit.manage")}
                      </Button>
                    </AlertActions>
                  )}
                </Show>
              </Alert>
            )}
          </Show>
          <Show when={props.error}>
            {(failure) => (
              <Alert class="hosted-pricing-alert" tone="danger" role="alert">
                <AlertIcon>
                  <OctagonX />
                </AlertIcon>
                <AlertContent>
                  <AlertTitle>{props.errorTitle ?? t("settings.hostedServers.createFailed")}</AlertTitle>
                  <AlertDescription>{failure().message}</AlertDescription>
                  <ErrorReference reference={failure().reference} />
                </AlertContent>
              </Alert>
            )}
          </Show>

          <OrderForm
            plans={props.plans}
            currency={props.currency}
            currencyLocked={props.currencyLocked}
            used={props.used}
            licenseTrialEnd={props.licenseTrialEnd}
            initialServer={FIRST_SERVER}
            initialLicense={initialLicense}
            noServerTitle={noServerTitle()}
            controlsMount={controlsMount()}
            action={action}
            contact={contact}
            onOrderChange={remember}
          />

          <Show when={props.onContactUs}>
            {(onContactUs) => (
              <section class="hosted-pricing-strip" aria-labelledby="hosted-pricing-enterprise">
                <div>
                  <h2 id="hosted-pricing-enterprise">{t("sitePage.pricing.enterprise.title")}</h2>
                  <p>{t("sitePage.pricing.enterprise.body", { count: PRICING_MAX_MEMBERS })}</p>
                </div>
                <Button class="hosted-pricing-pill" onClick={() => onContactUs()()}>
                  <MessageSquare aria-hidden="true" />
                  {t("sitePage.pricing.enterprise.contact")}
                </Button>
              </section>
            )}
          </Show>
        </div>
      </div>
    </section>
  );
}

/**
 * The consent and the buy button of the web page. The buyer accepts the privacy policy, the terms and the right of
 * withdrawal first. Without a server and a license, the button closes the page.
 */
function OrderAction(props: {
  order: Accessor<OrderFormOrder>;
  accepted: Accessor<boolean>;
  onAccept: (accepted: boolean) => void;
  busy: boolean;
  /** At the server limit, an order with a server cannot go on. */
  serverBlocked: boolean;
  thisComputer: boolean;
  onSubmit: (order: PricingOrder) => void;
  onClose: () => void;
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
}) {
  const { t } = useText();
  const id = `hosted-pricing-consent-${createUniqueId()}`;
  const buying = () => props.order().server !== null || props.order().license !== null;
  const label = () => (props.order().server === null ? t("billing.order.cta.license") : t("billing.order.cta.server"));
  const blocked = () => !props.accepted() || props.busy || (props.serverBlocked && props.order().server !== null);
  const keepContent = () =>
    props.thisComputer ? (
      <>
        <Monitor aria-hidden="true" />
        {t("billing.order.cta.keepComputer")}
      </>
    ) : (
      t("common.close")
    );
  const keep = () => (
    <Button
      variant="outline"
      class="hosted-pricing-pill hosted-pricing-pill-secondary hosted-pricing-cta"
      onClick={() => props.onClose()}
    >
      {keepContent()}
    </Button>
  );
  const part = (piece: string) => {
    if (piece === CONSENT_POLICY_MARKER) {
      return (
        <Button variant="link" class="hosted-pricing-link" onClick={() => props.onOpenPrivacy()}>
          {t("sitePage.pricing.consent.policy")}
        </Button>
      );
    }
    if (piece === CONSENT_TERMS_MARKER) {
      return (
        <Button variant="link" class="hosted-pricing-link" onClick={() => props.onOpenTerms()}>
          {t("sitePage.pricing.consent.terms")}
        </Button>
      );
    }
    return piece;
  };
  const pieces = () =>
    t("sitePage.pricing.consent.statement", { policy: CONSENT_POLICY_MARKER, terms: CONSENT_TERMS_MARKER })
      .split(CONSENT_MARKERS)
      .filter((piece) => piece !== "");
  return (
    <Show when={buying()} fallback={keep()}>
      <div class="hosted-pricing-consent-action">
        <div class="hosted-pricing-consent">
          <Checkbox
            id={id}
            checked={props.accepted()}
            disabled={props.busy}
            onChange={(event) => props.onAccept(event.currentTarget.checked)}
          />
          <label id={`${id}-label`} for={id}>
            {pieces().map(part)}
          </label>
        </div>
        <Button
          class="hosted-pricing-pill hosted-pricing-cta"
          disabled={blocked()}
          aria-describedby={`${id}-label`}
          onClick={() => props.onSubmit(props.order())}
        >
          {label()}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </Show>
  );
}
