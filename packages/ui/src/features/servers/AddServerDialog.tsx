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
  Confetti,
  Dialog,
  DropdownMenu,
  ErrorReference,
  Heading,
  IconButton,
  Link2,
  Monitor,
  OctagonX,
  Server,
  Text,
  TriangleAlert,
  X,
} from "@openbot/ui";
import { motionDuration, prefersReducedMotion } from "@openbot/ui/utils";
import type { UserErrorDetails } from "@openbot/user-errors";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onSettled,
  Show,
  Switch,
  untrack,
} from "solid-js";
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
  hostedCurrencies,
  hostedLongestOrderPrice,
  hostedPriceLength,
  hostedWorkYearlyDiscountPercent,
  hostedYearlyDiscountPercent,
} from "./HostedServerPricing";

export type HostedServerSetupStatus = "payment" | "creating" | "starting" | "connecting" | "ready" | "error";

export interface CreateHostedServerInput {
  plan: HostedServerPlanId;
  billing: HostedServerBilling;
  currency: HostedCurrency;
  license?: LicenseOrder | undefined;
}

export interface CreatedHostedServer {
  serverId: string;
  name: string;
}

interface AddServerDialogProps {
  plans: readonly HostedServerPlan[];
  recommendedPlan: HostedServerPlanId;
  currency?: HostedCurrency | undefined;
  currencyLocked?: boolean | undefined;
  setupStatus: HostedServerSetupStatus | null;
  resume?: CreatedHostedServer | undefined;
  onClose: () => void;
  onContactUs?: (() => void) | undefined;
  serverLimit?: number | null | undefined;
  onManageServers?: (() => void) | undefined;
  onJoinWithInvite?: (() => void) | undefined;
  onCreateLocal?: (() => void) | undefined;
  onInstallServer?: (() => void) | undefined;
  onCreate: (input: CreateHostedServerInput) => Promise<CreatedHostedServer>;
  onRetry: () => void;
  onOpenServer: () => void;
  onOpenPayment: () => Promise<void>;
  onCurrencyChange?: ((currency: HostedCurrency) => void) | undefined;
  onBillingChange?: ((billing: HostedServerBilling) => void) | undefined;
  licenseOffer?: { used: number; trialEnd?: number | undefined } | undefined;
  order?: CreateHostedServerInput | undefined;
}

type Step = "pricing" | "progress";

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

export function AddServerDialog(props: AddServerDialogProps) {
  const { t, errorDetails, format } = useText();
  const [step, setStep] = createSignal<Step>(untrack(() => props.resume) ? "progress" : "pricing");
  const order = untrack(() => props.order);
  const [billing, setBilling] = createSignal<HostedServerBilling>(order?.billing ?? "yearly");
  const currencies = createMemo(() => hostedCurrencies(props.plans));
  const [chosenCurrency, setCurrency] = createSignal<HostedCurrency | undefined>(
    untrack(() => (props.currencyLocked ? props.currency : (order?.currency ?? props.currency))),
  );
  const currency = (): HostedCurrency => {
    const chosen = chosenCurrency();
    return chosen && (props.currencyLocked || currencies().includes(chosen))
      ? chosen
      : guessHostedCurrency(currencies());
  };
  const [pendingPlan, setPendingPlan] = createSignal<HostedServerPlanId | null>(null);
  const [createError, setCreateError] = createSignal<UserErrorDetails | null>(null);
  const [created, setCreated] = createSignal<CreatedHostedServer | null>(untrack(() => props.resume) ?? null);
  const [paymentPending, setPaymentPending] = createSignal(false);
  const [paymentError, setPaymentError] = createSignal<UserErrorDetails | null>(null);
  const [rendered, setRendered] = createSignal(true);
  const [opened, setOpened] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  const [work, setWork] = createSignal(Boolean(order?.license && untrack(() => props.licenseOffer)));
  const minPeople = () =>
    Math.min(LICENSE_MAX_USERS, licenseOrderFor(Math.max(1, props.licenseOffer?.used ?? 1)).users);
  const [people, setPeople] = createSignal(
    Math.min(LICENSE_MAX_USERS, Math.max(order?.license?.users ?? LICENSE_INCLUDED_USERS, untrack(minPeople))),
  );
  const planPeople = () => (props.licenseOffer ? (work() ? people() : 0) : undefined);
  const longestPrice = () =>
    props.licenseOffer ? hostedLongestOrderPrice(props.plans, currency(), format) : undefined;
  const recommended = () =>
    (work() && props.plans.find((plan) => plan.memberLimit >= people())?.id) || props.recommendedPlan;
  const discountPercent = () =>
    work()
      ? hostedWorkYearlyDiscountPercent(props.plans, currency())
      : hostedYearlyDiscountPercent(props.plans, currency());
  const extraPriceChars = () => {
    const longest = longestPrice();
    const length = longest
      ? longest.was.length + longest.now.length + 2
      : hostedPriceLength(props.plans, currency(), format) + 2;
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
  const running = () => props.setupStatus !== "ready" && props.setupStatus !== "error" && !paying();
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

            <Show
              when={step() === "pricing" && (props.onJoinWithInvite || props.onCreateLocal || props.onInstallServer)}
            >
              <AddServerOtherOptions
                disabled={creating()}
                onCreateLocal={props.onCreateLocal}
                onInstallServer={props.onInstallServer}
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
                        options={currencies().includes(currency()) ? currencies() : [...currencies(), currency()]}
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
                            <span class="sr-only">{t(setupStep(currentIndex()).label)}</span>
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

export function AddServerOtherOptions(props: {
  disabled: boolean;
  onCreateLocal: (() => void) | undefined;
  onInstallServer: (() => void) | undefined;
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
            <Show when={props.onInstallServer}>
              {(onInstallServer) => (
                <DropdownMenu.Item onSelectAfterClose={() => onInstallServer()()}>
                  <Server aria-hidden="true" />
                  {t("server.install.title")}
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
