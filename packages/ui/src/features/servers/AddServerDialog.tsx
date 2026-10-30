import {
  LICENSE_INCLUDED_USERS,
  LICENSE_MAX_USERS,
  type LicenseOrder,
  licenseOrderFor,
} from "@openbot/contracts/license";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  buttonVariants,
  Check,
  ChevronDown,
  Dialog,
  DropdownMenu,
  ErrorReference,
  Heading,
  IconButton,
  Link2,
  Monitor,
  OctagonX,
  Text,
  TriangleAlert,
  X,
} from "@openbot/ui";
import { motionDuration, prefersReducedMotion } from "@openbot/ui/utils";
import type { UserErrorDetails } from "@openbot/user-errors";
import { createEffect, createSignal, For, Match, onCleanup, onSettled, Show, Switch, untrack } from "solid-js";
import { useText } from "../../text";
import {
  guessHostedCurrency,
  HostedBillingSwitch,
  type HostedCurrency,
  HostedCurrencySelect,
  HostedLicensePeople,
  type HostedServerBilling,
  type HostedServerPlan,
  type HostedServerPlanId,
  HostedServerPlans,
  HostedUseSwitch,
  hostedLongestOrderPrice,
  hostedPriceLength,
  hostedWorkYearlyDiscountPercent,
  hostedYearlyDiscountPercent,
} from "./HostedServerPricing";

/**
 * What the consumer reports about the new server after `onCreate` resolves. `payment`: the server
 * waits for the first payment in the browser. The setup starts when Stripe confirms it.
 */
export type HostedServerSetupStatus = "payment" | "creating" | "starting" | "connecting" | "ready" | "error";

export interface CreateHostedServerInput {
  plan: HostedServerPlanId;
  billing: HostedServerBilling;
  currency: HostedCurrency;
  /** The license to buy with the server, for work use. The server and the license have one payment. */
  license?: LicenseOrder | undefined;
}

export interface CreatedHostedServer {
  serverId: string;
  name: string;
}

interface AddServerDialogProps {
  plans: readonly HostedServerPlan[];
  /** The plan that shows the "Best value" badge and the primary button. */
  recommendedPlan: HostedServerPlanId;
  /**
   * The currency to show first, from the user's country when the consumer knows it. Without it,
   * the dialog guesses from the time zone. The user can change it, unless `currencyLocked` is set.
   */
  currency?: HostedCurrency | undefined;
  /** True when the account pays its open plans in `currency`. A Stripe customer pays in one currency. */
  currencyLocked?: boolean | undefined;
  /** Null until the consumer has a server to report on. */
  setupStatus: HostedServerSetupStatus | null;
  /**
   * A server that the user created before, such as after a return from the payment page. The
   * dialog opens on its setup.
   */
  resume?: CreatedHostedServer | undefined;
  onClose: () => void;
  /**
   * For macOS, a Mac mini, or company plans. The consumer opens its contact page or email. Without
   * it, the dialog does not show the "Contact us" footer.
   */
  onContactUs?: (() => void) | undefined;
  /**
   * The maximum number of servers of the account, when the account has that many. The dialog then
   * disables the plans and tells the user to delete a server first.
   */
  serverLimit?: number | null | undefined;
  /** Opens the list of the account's hosted servers. Without it, the limit notice has no button. */
  onManageServers?: (() => void) | undefined;
  /** Opens the invite dialog in place of this one. Without it, the "Other options" menu does not show the item. */
  onJoinWithInvite?: (() => void) | undefined;
  /**
   * Opens the dialog that creates a server on this computer in place of this one. Without it, the "Other
   * options" menu does not show the item.
   */
  onCreateLocal?: (() => void) | undefined;
  /** The consumer names the server, so the user does not have to. The logo uses the ID as its seed, as the rail does. */
  onCreate: (input: CreateHostedServerInput) => Promise<CreatedHostedServer>;
  onRetry: () => void;
  onOpenServer: () => void;
  /** Opens the payment page again, for the `payment` status. */
  onOpenPayment: () => Promise<void>;
  /** Tells the consumer that the user chose another currency. */
  onCurrencyChange?: ((currency: HostedCurrency) => void) | undefined;
  /** Tells the consumer that the user chose another billing period. */
  onBillingChange?: ((billing: HostedServerBilling) => void) | undefined;
  /**
   * Set when the account has no license. The dialog then lets the user choose personal or work use, and
   * for work use it sells a license with the server. `used` is the number of people who use the account's
   * servers now. A license bought before `trialEnd` is free until then.
   */
  licenseOffer?: { used: number; trialEnd?: number | undefined } | undefined;
  /**
   * The order from the pricing page. The dialog shows these choices and creates the server at once, so the
   * user does not choose again. It does not create when the order does not fit the account: another currency
   * than a locked one, the server limit, or fewer license users than the people who use the servers now.
   */
  order?: CreateHostedServerInput | undefined;
}

type Step = "pricing" | "progress";

/**
 * The setup steps, and what each step does, in order. The setup reports
 * only the step, so the detail lines change on a timer. They stop at the last line of the step and
 * do not loop.
 */
const SETUP_STEPS = [
  {
    label: "server.hosted.step.create",
    details: [
      "server.hosted.detail.create.reserve",
      "server.hosted.detail.create.copy",
      "server.hosted.detail.create.key",
    ],
  },
  {
    label: "server.hosted.step.start",
    details: ["server.hosted.detail.start.boot", "server.hosted.detail.start.app", "server.hosted.detail.start.wait"],
  },
  {
    label: "server.hosted.step.connect",
    details: [
      "server.hosted.detail.connect.signIn",
      "server.hosted.detail.connect.publish",
      "server.hosted.detail.connect.check",
    ],
  },
] as const satisfies readonly { label: AppTextKey; details: readonly AppTextKey[] }[];

type SetupStep = (typeof SETUP_STEPS)[number];

function setupStep(index: number): SetupStep {
  return SETUP_STEPS[index] ?? SETUP_STEPS[0];
}

const DETAIL_MS = 2_000;

const SETUP_ORDER: readonly HostedServerSetupStatus[] = ["creating", "starting", "connecting", "ready"];

const CONFETTI_PIECES = 56;

/**
 * The plus button on the server rail opens this dialog. It shows the plans first: one click on a
 * plan creates a hosted server, and the dialog then shows the setup.
 */
export function AddServerDialog(props: AddServerDialogProps) {
  const { t, errorDetails, format } = useText();
  const [step, setStep] = createSignal<Step>(untrack(() => props.resume) ? "progress" : "pricing");
  const order = untrack(() => props.order);
  const [billing, setBilling] = createSignal<HostedServerBilling>(order?.billing ?? "yearly");
  const [currency, setCurrency] = createSignal<HostedCurrency>(
    untrack(() => (props.currencyLocked ? props.currency : (order?.currency ?? props.currency))) ??
      guessHostedCurrency(),
  );
  const [pendingPlan, setPendingPlan] = createSignal<HostedServerPlanId | null>(null);
  const [createError, setCreateError] = createSignal<UserErrorDetails | null>(null);
  const [created, setCreated] = createSignal<CreatedHostedServer | null>(untrack(() => props.resume) ?? null);
  const [paymentPending, setPaymentPending] = createSignal(false);
  const [paymentError, setPaymentError] = createSignal<UserErrorDetails | null>(null);
  const [rendered, setRendered] = createSignal(true);
  const [opened, setOpened] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  const [work, setWork] = createSignal(Boolean(order?.license && untrack(() => props.licenseOffer)));
  /** A license cannot have fewer users than the people who use the account's servers now. */
  const minPeople = () =>
    Math.min(LICENSE_MAX_USERS, licenseOrderFor(Math.max(1, props.licenseOffer?.used ?? 1)).users);
  const [people, setPeople] = createSignal(
    Math.min(LICENSE_MAX_USERS, Math.max(order?.license?.users ?? LICENSE_INCLUDED_USERS, untrack(minPeople))),
  );
  /** The people that the plans price a license for: 0 is personal use, the server alone. */
  const planPeople = () => (props.licenseOffer ? (work() ? people() : 0) : undefined);
  const longestPrice = () =>
    props.licenseOffer ? hostedLongestOrderPrice(props.plans, currency(), format) : undefined;
  const recommended = () =>
    (work() && props.plans.find((plan) => plan.memberLimit >= people())?.id) || props.recommendedPlan;
  const discountPercent = () =>
    work()
      ? hostedWorkYearlyDiscountPercent(props.plans, currency())
      : hostedYearlyDiscountPercent(props.plans, currency());
  // Characters over the 10 that fit in a column at 760 px. The pricing step gets wider for each one.
  // With a license, the longest old and new prices share the line.
  const extraPriceChars = () => {
    const longest = longestPrice();
    const length = longest
      ? longest.was.length + longest.now.length + 2
      : hostedPriceLength(props.plans, currency(), format);
    return Math.max(0, length - 10);
  };
  let stepHeading: HTMLElement | undefined;
  let pricing: HTMLDivElement | undefined;
  let progressLogo: HTMLDivElement | undefined;
  let closeTimer: number | undefined;

  const creating = () => pendingPlan() !== null;
  const setupIndex = () => (props.setupStatus ? SETUP_ORDER.indexOf(props.setupStatus) : 0);
  const serverName = () => created()?.name ?? "";

  const paying = () => props.setupStatus === "payment";
  // The payment is not a setup step: no step runs until Stripe confirms it.
  const running = () => props.setupStatus !== "ready" && props.setupStatus !== "error" && !paying();
  // The error status does not tell which step failed, so keep the last step that ran.
  const [currentIndex, setCurrentIndex] = createSignal(0);
  createEffect(setupIndex, (index) => {
    if (index >= 0) setCurrentIndex(Math.min(index, SETUP_STEPS.length - 1));
  });

  const [detailIndex, setDetailIndex] = createSignal(0);
  createEffect(
    () => (running() ? currentIndex() : -1),
    (index) => {
      setDetailIndex(0);
      if (index < 0) return;
      const last = setupStep(index).details.length - 1;
      const timer = window.setInterval(() => setDetailIndex((detail) => Math.min(detail + 1, last)), DETAIL_MS);
      return () => window.clearInterval(timer);
    },
  );
  const detail = (): AppTextKey | undefined => setupStep(currentIndex()).details[detailIndex()];
  const stepState = (index: number) =>
    paying()
      ? "pending"
      : props.setupStatus === "ready" || index < currentIndex()
        ? "done"
        : index > currentIndex()
          ? "pending"
          : props.setupStatus === "error"
            ? "failed"
            : "active";

  onSettled(() => {
    const frame = window.requestAnimationFrame(() => setOpened(true));
    return () => window.cancelAnimationFrame(frame);
  });

  onSettled(() => {
    if (order && untrack(() => orderFits(order))) void create(order.plan);
  });

  function orderFits(input: CreateHostedServerInput): boolean {
    if (step() !== "pricing" || props.serverLimit != null) return false;
    if (props.currencyLocked && input.currency !== props.currency) return false;
    return !(input.license && props.licenseOffer && input.license.users < minPeople());
  }

  onCleanup(() => {
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
  });

  function focusHeading(): void {
    queueMicrotask(() => stepHeading?.focus({ preventScroll: true }));
  }

  async function create(plan: HostedServerPlanId): Promise<void> {
    if (creating()) return;
    setPendingPlan(plan);
    setCreateError(null);
    try {
      const license = props.licenseOffer && work() ? licenseOrderFor(people()) : undefined;
      setCreated(await props.onCreate({ plan, billing: billing(), currency: currency(), license }));
      setStep("progress");
      focusHeading();
    } catch (cause) {
      setCreateError(errorDetails(cause, t("settings.hostedServers.createFailed")));
    } finally {
      setPendingPlan(null);
    }
  }

  async function openPayment(): Promise<void> {
    if (paymentPending()) return;
    setPaymentPending(true);
    setPaymentError(null);
    try {
      await props.onOpenPayment();
    } catch (cause) {
      setPaymentError(errorDetails(cause, t("server.hosted.paymentFailed")));
    } finally {
      setPaymentPending(false);
    }
  }

  function requestClose(then?: () => void): void {
    if (creating() || closing()) return;
    setClosing(true);
    setOpened(false);
    closeTimer = window.setTimeout(
      () => {
        closeTimer = undefined;
        setRendered(false);
        props.onClose();
        then?.();
      },
      prefersReducedMotion() ? 0 : motionDuration("--modal-close-dur", 150),
    );
  }

  return (
    <Dialog.Root open={rendered()} onOpenChange={(open) => !open && requestClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="join-server-backdrop" data-motion={closing() ? "closing" : "open"}>
          <Show when={props.setupStatus === "ready" && !closing()}>
            <Confetti origin={progressLogo} />
          </Show>
          <Dialog.Content
            as="section"
            class={`join-server-dialog add-server-dialog t-modal${closing() ? " is-closing" : opened() ? " is-open" : ""}`}
            data-step={step()}
            style={{ "--add-server-extra-price-chars": extraPriceChars() }}
            aria-busy={creating() ? "true" : undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              // A dialog that opens on the setup, as after the payment page, reads the step heading.
              if (step() === "progress") focusHeading();
              else
                queueMicrotask(() =>
                  pricing?.querySelector<HTMLInputElement>("input:checked")?.focus({ preventScroll: true }),
                );
            }}
          >
            <Dialog.Title class="sr-only">{t("server.add.title")}</Dialog.Title>
            <Dialog.Description class="sr-only">{t("server.add.description")}</Dialog.Description>

            <IconButton
              class="join-server-close"
              label={t("common.close")}
              tooltip={t("common.close")}
              variant="ghost"
              disabled={creating()}
              data-cuelume-tap="close"
              onClick={() => requestClose()}
            >
              <X />
            </IconButton>

            <Show when={step() === "pricing" && (props.onJoinWithInvite || props.onCreateLocal)}>
              <AddServerOtherOptions
                disabled={creating()}
                onCreateLocal={props.onCreateLocal}
                onJoinWithInvite={props.onJoinWithInvite}
              />
            </Show>

            <div class="join-server-content">
              <Switch>
                <Match when={step() === "pricing"}>
                  <div
                    class="add-server-step add-server-pricing"
                    ref={(element: HTMLDivElement) => (pricing = element)}
                  >
                    <header class="join-server-header add-server-intro">
                      <Heading as="h2" size="lg">
                        {t("server.add.title")}
                      </Heading>
                      <Text as="p" tone="muted">
                        {t("server.add.description")}
                      </Text>
                    </header>

                    <div class="add-server-bar" data-license={props.licenseOffer ? "" : undefined}>
                      <Show when={props.licenseOffer}>
                        <HostedUseSwitch work={work()} onChange={setWork} disabled={creating()} />
                      </Show>
                      <HostedCurrencySelect
                        currency={currency()}
                        onChange={(next) => {
                          setCurrency(next);
                          props.onCurrencyChange?.(next);
                        }}
                        disabled={creating()}
                        locked={props.currencyLocked}
                        mount={pricing}
                      />
                      <HostedBillingSwitch
                        billing={billing()}
                        discountPercent={discountPercent()}
                        onChange={(next) => {
                          setBilling(next);
                          props.onBillingChange?.(next);
                        }}
                        disabled={creating()}
                      />
                    </div>

                    <Show when={props.serverLimit ?? null}>
                      {(limit) => (
                        <Alert class="join-server-alert add-server-limit" tone="warning" role="alert">
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
                                <Button size="sm" onClick={() => requestClose(onManageServers())}>
                                  {t("server.add.limit.manage")}
                                </Button>
                              </AlertActions>
                            )}
                          </Show>
                        </Alert>
                      )}
                    </Show>

                    <div class="add-server-plans">
                      <HostedServerPlans
                        plans={props.plans}
                        billing={billing()}
                        currency={currency()}
                        recommended={recommended()}
                        pendingPlan={pendingPlan()}
                        disabled={props.serverLimit != null}
                        people={planPeople()}
                        longestPrice={longestPrice()}
                        licenseTrialEnd={props.licenseOffer?.trialEnd}
                        onChoose={(plan) => void create(plan)}
                      />
                      <Show when={props.licenseOffer}>
                        <HostedLicensePeople
                          value={people()}
                          min={minPeople()}
                          used={props.licenseOffer?.used ?? 0}
                          disabled={!work() || creating() || props.serverLimit != null}
                          onChange={setPeople}
                        />
                      </Show>
                    </div>

                    <Show when={props.onContactUs}>
                      {(onContactUs) => (
                        <footer class="add-server-custom">
                          <div class="add-server-custom-text">
                            <Text as="p" variant="label">
                              {t("server.add.custom.title")}
                            </Text>
                            <Text as="p" tone="muted">
                              {t("server.add.custom.description")}
                            </Text>
                          </div>
                          <Button variant="outline" size="sm" disabled={creating()} onClick={() => onContactUs()()}>
                            {t("server.add.custom.action")}
                          </Button>
                        </footer>
                      )}
                    </Show>

                    {/* The limit notice above explains a create that failed at the limit. */}
                    <Show when={props.serverLimit == null && createError()}>
                      {(failure) => (
                        <Alert class="join-server-alert" tone="danger" role="alert">
                          <AlertIcon>
                            <OctagonX />
                          </AlertIcon>
                          <AlertContent>
                            <AlertTitle>{t("settings.hostedServers.createFailed")}</AlertTitle>
                            <AlertDescription>{failure().message}</AlertDescription>
                            <ErrorReference reference={failure().reference} />
                          </AlertContent>
                        </Alert>
                      )}
                    </Show>
                  </div>
                </Match>

                <Match when={step() === "progress"}>
                  <div class="add-server-step add-server-progress" data-status={props.setupStatus ?? "creating"}>
                    {/* One ring segment for each step. The running segment fills slowly, because the
                        setup does not report how far a step is. At the end the gaps close into one
                        ring, and the centre changes into a check mark or an X. */}
                    <div
                      ref={(element: HTMLDivElement) => (progressLogo = element)}
                      class="add-server-ring"
                      aria-hidden="true"
                    >
                      <svg class="add-server-ring-segments" viewBox="0 0 100 100" aria-hidden="true">
                        <For each={SETUP_STEPS}>
                          {(_key, index) => (
                            <g class="add-server-ring-segment" data-state={stepState(index())}>
                              <circle class="add-server-ring-track" cx="50" cy="50" r="47" pathLength="100" />
                              <circle class="add-server-ring-fill" cx="50" cy="50" r="47" pathLength="100" />
                            </g>
                          )}
                        </For>
                      </svg>
                      {/* A small server with one light for each step. The light of the running step
                          flickers like disk activity. */}
                      <span class="add-server-ring-core">
                        <For each={SETUP_STEPS}>
                          {(_step, index) => <span class="add-server-light" data-state={stepState(index())} />}
                        </For>
                      </span>
                      <Switch>
                        <Match when={props.setupStatus === "ready"}>
                          <span class="add-server-ring-result">
                            <Check />
                          </span>
                        </Match>
                        <Match when={props.setupStatus === "error"}>
                          <span class="add-server-ring-result" data-tone="danger">
                            <X />
                          </span>
                        </Match>
                      </Switch>
                    </div>
                    <header class="join-server-header" aria-live="polite">
                      <Heading as="h2" size="lg" ref={(element: HTMLElement) => (stepHeading = element)} tabindex={-1}>
                        <Switch fallback={t("server.hosted.progressTitle", { name: serverName() })}>
                          <Match when={props.setupStatus === "ready"}>
                            {t("server.hosted.readyTitle", { name: serverName() })}
                          </Match>
                          <Match when={props.setupStatus === "error"}>{t("server.hosted.failedTitle")}</Match>
                          <Match when={paying()}>{t("server.hosted.paymentTitle")}</Match>
                        </Switch>
                      </Heading>
                      <Show
                        when={!running()}
                        fallback={
                          <>
                            {/* A screen reader hears the step, not each line on the timer. */}
                            <span class="sr-only">{t(setupStep(currentIndex()).label)}</span>
                            {/* Keyed, so that each new line rolls in from below. */}
                            <Show when={detail()} keyed>
                              {(key) => (
                                <p class="add-server-ticker" aria-hidden="true">
                                  {t(key)}
                                </p>
                              )}
                            </Show>
                          </>
                        }
                      >
                        <Text tone="muted" role={props.setupStatus === "error" ? "alert" : undefined}>
                          {props.setupStatus === "ready"
                            ? t("server.hosted.readyDescription")
                            : paying()
                              ? t("server.hosted.paymentDescription")
                              : t("server.hosted.failedDescription")}
                        </Text>
                      </Show>
                    </header>

                    <Show when={!running()}>
                      <footer class="join-server-actions">
                        <Show when={paymentError()}>
                          {(failure) => (
                            <Alert class="join-server-alert" tone="danger" role="alert">
                              <AlertIcon>
                                <OctagonX />
                              </AlertIcon>
                              <AlertContent>
                                <AlertTitle>{t("server.hosted.paymentFailed")}</AlertTitle>
                                <AlertDescription>{failure().message}</AlertDescription>
                                <ErrorReference reference={failure().reference} />
                              </AlertContent>
                            </Alert>
                          )}
                        </Show>
                        <Show
                          when={props.setupStatus === "ready"}
                          fallback={
                            <Show
                              when={paying()}
                              fallback={
                                <Button size="lg" fullWidth onClick={props.onRetry}>
                                  {t("server.hosted.tryAgain")}
                                </Button>
                              }
                            >
                              <Button
                                variant="outline"
                                size="lg"
                                fullWidth
                                loading={paymentPending()}
                                loadingLabel={t("server.hosted.openingPayment")}
                                onClick={() => void openPayment()}
                              >
                                {t("server.hosted.openPayment")}
                              </Button>
                            </Show>
                          }
                        >
                          <Button
                            class="add-server-open"
                            size="lg"
                            fullWidth
                            onClick={() => requestClose(props.onOpenServer)}
                          >
                            {t("server.hosted.open")}
                          </Button>
                        </Show>
                      </footer>
                    </Show>
                  </div>
                </Match>
              </Switch>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The ways to add a server without a plan, in the corner across from the close button. */
function AddServerOtherOptions(props: {
  disabled: boolean;
  onCreateLocal: (() => void) | undefined;
  onJoinWithInvite: (() => void) | undefined;
}) {
  const { t } = useText();
  return (
    <div class="add-server-other">
      <DropdownMenu.Root placement="bottom-start">
        <DropdownMenu.Trigger class={buttonVariants({ variant: "ghost", size: "sm" })} disabled={props.disabled}>
          {t("server.add.otherOptions")}
          <ChevronDown aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="add-server-other-menu" aria-label={t("server.add.otherOptions")}>
            <Show when={props.onCreateLocal}>
              {(onCreateLocal) => (
                <DropdownMenu.Item onSelectAfterClose={() => onCreateLocal()()}>
                  <Monitor aria-hidden="true" />
                  {t("server.local.createTitle")}
                </DropdownMenu.Item>
              )}
            </Show>
            <Show when={props.onJoinWithInvite}>
              {(onJoinWithInvite) => (
                <DropdownMenu.Item onSelectAfterClose={() => onJoinWithInvite()()}>
                  <Link2 aria-hidden="true" />
                  {t("server.add.join.action")}
                </DropdownMenu.Item>
              )}
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/**
 * A burst of paper from the server logo, over the backdrop so that the dialog does not clip it.
 * CSS hides it when the user prefers reduced motion.
 */
function Confetti(props: { origin: HTMLElement | undefined }) {
  const box = props.origin?.getBoundingClientRect();
  const origin = {
    "--confetti-origin-x": `${box ? box.left + box.width / 2 : window.innerWidth / 2}px`,
    "--confetti-origin-y": `${box ? box.top + box.height / 2 : window.innerHeight / 3}px`,
  };
  const pieces = Array.from({ length: CONFETTI_PIECES }, (_, index) => {
    const angle = (index / CONFETTI_PIECES) * Math.PI * 2 + Math.random() * 0.4;
    const reach = 140 + Math.random() * 180;
    return {
      "--confetti-x": `${Math.cos(angle) * reach}px`,
      "--confetti-y": `${Math.sin(angle) * reach * 0.7 - 90}px`,
      "--confetti-spin": `${Math.round(Math.random() * 720 - 360)}deg`,
      "--confetti-delay": `${Math.round(Math.random() * 120)}ms`,
      "--confetti-duration": `${Math.round(1_300 + Math.random() * 700)}ms`,
    };
  });
  return (
    <div class="add-server-confetti" style={origin} aria-hidden="true">
      <For each={pieces}>{(style) => <i style={style} />}</For>
    </div>
  );
}
