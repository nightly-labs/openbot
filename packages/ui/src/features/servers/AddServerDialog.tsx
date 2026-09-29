import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Check,
  Dialog,
  Heading,
  IconButton,
  OctagonX,
  Text,
  X,
} from "@openbot/ui";
import { motionDuration, prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createSignal, For, Match, onCleanup, onSettled, Show, Switch, untrack } from "solid-js";
import { useText } from "../../text";
import {
  guessHostedCurrency,
  HostedBillingSwitch,
  type HostedCurrency,
  HostedCurrencySelect,
  type HostedServerBilling,
  type HostedServerPlan,
  type HostedServerPlanId,
  HostedServerPlans,
  hostedPriceLength,
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
   * the dialog guesses from the time zone. The user can change it.
   */
  currency?: HostedCurrency | undefined;
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
  /** Opens the invite dialog in place of this one. Without it, the dialog does not show the link. */
  onJoinWithInvite?: (() => void) | undefined;
  /** The consumer names the server, so the user does not have to. The logo uses the ID as its seed, as the rail does. */
  onCreate: (input: CreateHostedServerInput) => Promise<CreatedHostedServer>;
  onRetry: () => void;
  onOpenServer: () => void;
  /** Opens the payment page again, for the `payment` status. */
  onOpenPayment: () => Promise<void>;
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
  const { t, errorMessage, format } = useText();
  const [step, setStep] = createSignal<Step>(untrack(() => props.resume) ? "progress" : "pricing");
  const [billing, setBilling] = createSignal<HostedServerBilling>("yearly");
  const [currency, setCurrency] = createSignal<HostedCurrency>(untrack(() => props.currency) ?? guessHostedCurrency());
  const [pendingPlan, setPendingPlan] = createSignal<HostedServerPlanId | null>(null);
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [created, setCreated] = createSignal<CreatedHostedServer | null>(untrack(() => props.resume) ?? null);
  const [paymentPending, setPaymentPending] = createSignal(false);
  const [paymentError, setPaymentError] = createSignal<string | null>(null);
  const [rendered, setRendered] = createSignal(true);
  const [opened, setOpened] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  // Characters over the 10 that fit in a column at 760 px. The pricing step gets wider for each one.
  const extraPriceChars = () => Math.max(0, hostedPriceLength(props.plans, currency(), format) - 10);
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
      setCreated(await props.onCreate({ plan, billing: billing(), currency: currency() }));
      setStep("progress");
      focusHeading();
    } catch (cause) {
      setCreateError(errorMessage(cause, t("settings.hostedServers.createFailed")));
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
      setPaymentError(errorMessage(cause, t("server.hosted.paymentFailed")));
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
              onClick={() => requestClose()}
            >
              <X />
            </IconButton>

            <div class="join-server-content">
              <Switch>
                <Match when={step() === "pricing"}>
                  <div
                    class="add-server-step add-server-pricing"
                    ref={(element: HTMLDivElement) => (pricing = element)}
                  >
                    <div class="add-server-bar">
                      <HostedCurrencySelect
                        currency={currency()}
                        onChange={setCurrency}
                        disabled={creating()}
                        mount={pricing}
                      />
                      <HostedBillingSwitch
                        billing={billing()}
                        discountPercent={hostedYearlyDiscountPercent(props.plans, currency())}
                        onChange={setBilling}
                        disabled={creating()}
                      />
                    </div>

                    <HostedServerPlans
                      plans={props.plans}
                      billing={billing()}
                      currency={currency()}
                      recommended={props.recommendedPlan}
                      pendingPlan={pendingPlan()}
                      onChoose={(plan) => void create(plan)}
                    />

                    <Show when={props.onJoinWithInvite}>
                      {(onJoinWithInvite) => (
                        <Text as="p" tone="muted" class="add-server-join">
                          {t("server.add.join.title")}{" "}
                          <Button variant="link" size="sm" disabled={creating()} onClick={() => onJoinWithInvite()()}>
                            {t("server.add.join.action")}
                          </Button>
                        </Text>
                      )}
                    </Show>

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

                    <Show when={createError()}>
                      {(message) => (
                        <Alert class="join-server-alert" tone="danger" role="alert">
                          <AlertIcon>
                            <OctagonX />
                          </AlertIcon>
                          <AlertContent>
                            <AlertTitle>{t("settings.hostedServers.createFailed")}</AlertTitle>
                            <AlertDescription>{message()}</AlertDescription>
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
                          {(message) => (
                            <Alert class="join-server-alert" tone="danger" role="alert">
                              <AlertIcon>
                                <OctagonX />
                              </AlertIcon>
                              <AlertContent>
                                <AlertTitle>{t("server.hosted.paymentFailed")}</AlertTitle>
                                <AlertDescription>{message()}</AlertDescription>
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
