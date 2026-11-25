import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import { type BillingDetails, isWithdrawalConsumer } from "@openbot/contracts/billing-details";
import type {
  CustomServerCheckoutRequest,
  CustomServerCheckoutResult,
  CustomServerPlan,
} from "@openbot/contracts/custom-server-plans";
import type { AgentStepActivity, AvatarHue, ServerSummary } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertTitle,
  ArrowLeft,
  ArrowRight,
  Button,
  Checkbox,
  Cpu,
  ExternalLink,
  HardDrive,
  LifeBuoy,
  MemoryStick,
  RefreshCw,
} from "@openbot/ui";
import { createEffect, createSignal, createUniqueId, For, Match, onCleanup, onSettled, Show, Switch } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import {
  type BillingDetailsCalls,
  type BillingDetailsDraft,
  BillingDetailsFields,
  billingDetailsDraft,
  billingDetailsRequest,
  saveBillingDetails,
} from "../billing/BillingDetailsFields";
import { formatMinorMoney } from "../billing/money";

export type ServerPaywallPhase = "offer" | "failed" | "checkout" | "paid";

interface CrewMember {
  seed: string;
  hue: AvatarHue;
  animationOffset: number;
  activity: AgentStepActivity;
  wakeRank: number;
}

const CREW_HUES: readonly AvatarHue[] = [215, 30, 320, 150, 55, 280, 185];
const CREW_ACTIVITIES: readonly AgentStepActivity[] = [
  "searching",
  "browsing",
  "reading",
  "working",
  "editing",
  "running",
  "reviewing",
];
const WAKE_ORDER = [3, 2, 4, 1, 5, 0, 6];
const WAKE_STEP_MS = 70;

const CREW: readonly CrewMember[] = CREW_HUES.map((hue, index) => ({
  seed: `server-paywall-crew-${index}`,
  hue,
  animationOffset: index * 0.35,
  activity: CREW_ACTIVITIES[index] ?? "working",
  wakeRank: WAKE_ORDER.indexOf(index),
}));

export interface ServerPaywall {
  server: () => ServerSummary | null;
  phase: () => ServerPaywallPhase;
  error: () => string | null;
  pending: () => boolean;
  canSubscribe: boolean;
  readyToSubscribe: () => boolean;
  earlyStartAsked: () => boolean;
  earlyStart: () => boolean;
  setEarlyStart: (requested: boolean) => void;
  billingDraft: () => BillingDetailsDraft | null;
  setBillingDraft: (draft: BillingDetailsDraft) => void;
  loadBillingDetails: () => void;
  subscribe: () => Promise<void>;
  dismiss: () => void;
}

interface MissingBillingDetails {
  saved: BillingDetails | null;
  draft: BillingDetailsDraft;
}

export function serverPaymentRequired(server: ServerSummary | undefined | null): boolean {
  return server?.kind === "remote" && server.paymentRequired === true;
}

export function createServerPaywall(input: {
  server: () => ServerSummary | undefined;
  subscribe?: ((request: CustomServerCheckoutRequest) => Promise<CustomServerCheckoutResult>) | undefined;
  billingDetails?: BillingDetailsCalls | undefined;
  errorMessage: (error: unknown) => string;
}): ServerPaywall {
  const [checkout, setCheckout] = createSignal<{ serverId: string; paid: boolean } | null>(null);
  const [failure, setFailure] = createSignal<{ serverId: string; message: string } | null>(null);
  const [pendingFor, setPendingFor] = createSignal<string | null>(null);
  const [billingChecked, setBillingChecked] = createSignal(input.billingDetails === undefined);
  const [missingBilling, setMissingBilling] = createSignal<MissingBillingDetails | null>(null);
  const [savedBilling, setSavedBilling] = createSignal<BillingDetails | null>(null);
  const [earlyStartFor, setEarlyStartFor] = createSignal<string | null>(null);
  createEffect(
    () => {
      const current = input.server();
      return current?.kind === "remote" && current.paymentRequired !== true ? current.id : null;
    },
    (paidServerId) => {
      if (paidServerId === null) return;
      setEarlyStartFor((serverId) => (serverId === paidServerId ? null : serverId));
      setCheckout((started) =>
        started?.serverId === paidServerId && !started.paid ? { serverId: paidServerId, paid: true } : started,
      );
    },
  );
  let billingLoad: Promise<void> | null = null;
  const loadBillingDetails = () => {
    const calls = input.billingDetails;
    if (!calls || billingLoad) return;
    billingLoad = calls
      .getDetails()
      .catch(() => null)
      .then((saved) => {
        setSavedBilling(saved);
        if (!saved?.country) setMissingBilling({ saved, draft: billingDetailsDraft(saved) });
        setBillingChecked(true);
      });
  };
  const saveMissingBilling = async () => {
    const missing = missingBilling();
    if (!missing || !input.billingDetails) return;
    const saved = await saveBillingDetails(input.billingDetails, missing.saved, missing.draft);
    if (saved?.country) {
      setSavedBilling(saved);
      setMissingBilling(null);
    }
  };
  const earlyStartAsked = () => {
    if (!input.billingDetails) return true;
    const missing = missingBilling();
    return isWithdrawalConsumer(missing ? missing.draft : savedBilling());
  };
  const earlyStart = () => {
    const serverId = earlyStartFor();
    return serverId !== null && serverId === server()?.id;
  };
  const setEarlyStart = (requested: boolean) => setEarlyStartFor(requested ? (server()?.id ?? null) : null);
  const readyToSubscribe = () => {
    const missing = missingBilling();
    return (
      billingChecked() &&
      (missing === null || billingDetailsRequest(missing.draft) !== null) &&
      (!earlyStartAsked() || earlyStart())
    );
  };
  const server = () => {
    const current = input.server();
    if (current?.kind !== "remote") return null;
    if (current.paymentRequired === true || checkout()?.serverId === current.id) return current;
    return null;
  };
  const phase = (): ServerPaywallPhase => {
    const current = server();
    if (!current) return "offer";
    if (current.paymentRequired !== true) return "paid";
    if (failure()?.serverId === current.id) return "failed";
    const started = checkout();
    if (started?.serverId === current.id && !started.paid) return "checkout";
    return "offer";
  };
  const subscribe = async () => {
    const current = server();
    if (!current || !input.subscribe || pendingFor() !== null || !readyToSubscribe()) return;
    setPendingFor(current.id);
    setFailure(null);
    try {
      await saveMissingBilling();
      const result = await input.subscribe(
        earlyStartAsked() ? { serverId: current.id, earlyStart: true } : { serverId: current.id },
      );
      if (result.opened) setCheckout({ serverId: current.id, paid: false });
    } catch (error) {
      setFailure({ serverId: current.id, message: input.errorMessage(error) });
    } finally {
      setPendingFor(null);
    }
  };
  return {
    server,
    phase,
    error: () => failure()?.message ?? null,
    pending: () => pendingFor() !== null,
    canSubscribe: input.subscribe !== undefined,
    readyToSubscribe,
    earlyStartAsked,
    earlyStart,
    setEarlyStart,
    billingDraft: () => missingBilling()?.draft ?? null,
    setBillingDraft: (draft) => setMissingBilling((missing) => (missing ? { ...missing, draft } : missing)),
    loadBillingDetails,
    subscribe,
    dismiss: () => setCheckout(null),
  };
}

function createWakeWave(size: number) {
  const [count, setCount] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  onCleanup(stop);
  const wake = (awake: boolean) => {
    stop();
    const target = awake ? size : 0;
    const step = awake ? 1 : -1;
    timer = setInterval(() => {
      const next = count() + step;
      if ((awake && next > target) || (!awake && next < target)) {
        stop();
        return;
      }
      setCount(next);
    }, WAKE_STEP_MS);
  };
  return { count, wake };
}

function CrewRow(props: { moodOf: (member: CrewMember) => AvatarMood; cheer: boolean }) {
  return (
    <div class={["server-paywall-crew", { "server-paywall-crew-cheer": props.cheer }]} aria-hidden="true">
      <For each={CREW}>
        {(member) => (
          <AgentAvatar
            seed={member.seed}
            hue={member.hue}
            motion="idle"
            mood={props.moodOf(member)}
            activity={member.activity}
            animationOffset={member.animationOffset}
            followPointer
            class="server-paywall-avatar"
          />
        )}
      </For>
    </div>
  );
}

function PlanLines(props: { plan: CustomServerPlan }) {
  const { t, format } = useText();
  return (
    <ul>
      <li>
        <Cpu aria-hidden="true" />
        <span>{t("server.paywall.vcpu", { value: format.number(props.plan.vcpu) })}</span>
      </li>
      <li>
        <MemoryStick aria-hidden="true" />
        <span>{t("server.paywall.memory", { value: format.number(props.plan.memoryGb) })}</span>
      </li>
      <li>
        <HardDrive aria-hidden="true" />
        <span>{t("server.paywall.storage", { value: format.number(props.plan.storageGb) })}</span>
      </li>
      <Show when={props.plan.personalizedSupport}>
        <li>
          <LifeBuoy aria-hidden="true" />
          <span>{t("server.paywall.support")}</span>
        </li>
      </Show>
    </ul>
  );
}

function PaywallOffer(props: {
  server: ServerSummary;
  plan: CustomServerPlan;
  paywall: ServerPaywall;
  titleId: string;
  onWake: (awake: boolean) => void;
}) {
  const { t, format } = useText();
  const planId = createUniqueId();
  const earlyStartId = createUniqueId();
  const failed = () => props.paywall.phase() === "failed";
  const interval = () =>
    props.plan.interval === "month" ? t("billing.order.unit.month") : t("server.paywall.perYear");
  onSettled(() => props.paywall.loadBillingDetails());
  return (
    <section class="server-paywall-panel">
      <h1 id={props.titleId}>{t("server.paywall.ready", { name: props.server.name })}</h1>
      <p class="server-paywall-description">{t("server.paywall.wakeUp")}</p>
      <Show when={props.paywall.error()}>
        {(message) => (
          <Alert tone="danger" role="alert" class="server-paywall-alert">
            <AlertContent>
              <AlertTitle>{t("server.paywall.checkoutFailed")}</AlertTitle>
              <AlertDescription>{message()}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </Show>
      <section class="hosted-pricing-strip server-paywall-strip" aria-labelledby={planId}>
        <div class="server-paywall-plan">
          <div class="server-paywall-plan-name">
            <span>{t("server.paywall.yourPlan")}</span>
            <h2 id={planId}>{props.plan.name}</h2>
          </div>
          <PlanLines plan={props.plan} />
        </div>
        <Show when={props.paywall.billingDraft()}>
          {(draft) => (
            <div class="server-paywall-details">
              <BillingDetailsFields
                value={draft()}
                disabled={props.paywall.pending()}
                onChange={(next) => props.paywall.setBillingDraft(next)}
              />
            </div>
          )}
        </Show>
        <div class="server-paywall-buy">
          <p class="server-paywall-price">
            <strong>{formatMinorMoney(format, props.plan.amount, props.plan.currency)}</strong>
            <span>{interval()}</span>
          </p>
          <Button
            class="hosted-pricing-pill server-paywall-subscribe"
            disabled={!props.paywall.readyToSubscribe()}
            loading={props.paywall.pending()}
            loadingLabel={t("settings.hostedServers.openingCheckout")}
            onClick={() => void props.paywall.subscribe()}
            onPointerEnter={() => props.onWake(true)}
            onPointerLeave={() => props.onWake(false)}
            onFocus={() => props.onWake(true)}
            onBlur={() => props.onWake(false)}
          >
            <Show
              when={failed()}
              fallback={
                <>
                  {t("server.paywall.subscribe")}
                  <ExternalLink aria-hidden="true" />
                </>
              }
            >
              <RefreshCw aria-hidden="true" />
              {t("common.tryAgain")}
            </Show>
          </Button>
        </div>
      </section>
      <Show when={props.paywall.earlyStartAsked()}>
        <div class="hosted-pricing-consent server-paywall-consent">
          <Checkbox
            id={earlyStartId}
            checked={props.paywall.earlyStart()}
            disabled={props.paywall.pending()}
            onChange={(event) => props.paywall.setEarlyStart(event.currentTarget.checked)}
          />
          <label for={earlyStartId}>{t("sitePage.pricing.consent.earlyStart")}</label>
        </div>
      </Show>
    </section>
  );
}

function PaywallCheckout(props: { paywall: ServerPaywall; titleId: string }) {
  const { t } = useText();
  return (
    <section class="server-paywall-panel" role="status" aria-live="polite">
      <h1 id={props.titleId}>{t("server.paywall.checkoutTitle")}</h1>
      <p class="server-paywall-description">{t("server.paywall.checkoutDescription")}</p>
      <div class="server-paywall-actions">
        <Button variant="ghost" disabled={props.paywall.pending()} onClick={() => props.paywall.dismiss()}>
          <ArrowLeft aria-hidden="true" />
          {t("common.back")}
        </Button>
        <Button
          variant="outline"
          loading={props.paywall.pending()}
          loadingLabel={t("settings.hostedServers.openingCheckout")}
          onClick={() => void props.paywall.subscribe()}
        >
          <ExternalLink aria-hidden="true" />
          {t("server.paywall.openCheckoutAgain")}
        </Button>
      </div>
    </section>
  );
}

function PaywallPaid(props: { server: ServerSummary; paywall: ServerPaywall; titleId: string }) {
  const { t } = useText();
  return (
    <section class="server-paywall-panel" role="status">
      <h1 id={props.titleId}>{t("server.paywall.active", { name: props.server.name })}</h1>
      <p class="server-paywall-description">{t("server.paywall.activeDescription")}</p>
      <div class="server-paywall-actions">
        <Button class="hosted-pricing-pill server-paywall-subscribe" onClick={() => props.paywall.dismiss()}>
          {t("server.paywall.open", { name: props.server.name })}
          <ArrowRight aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

function PaywallWait(props: { server: ServerSummary; titleId: string }) {
  const { t } = useText();
  return (
    <section class="server-paywall-panel">
      <h1 id={props.titleId}>{t("server.paywall.almostReady", { name: props.server.name })}</h1>
      <p class="server-paywall-description">{t("server.paywall.ownerSubscribes", { name: props.server.name })}</p>
    </section>
  );
}

export function ServerPaywallScreen(props: { server: ServerSummary; paywall: ServerPaywall }) {
  const titleId = createUniqueId();
  const wave = createWakeWave(CREW.length);
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  const plan = () => (props.paywall.canSubscribe ? (props.server.customPlan ?? null) : null);
  const paid = () => props.paywall.phase() === "paid";
  const moodOf = (member: CrewMember): AvatarMood => {
    if (paid()) return "responded";
    if (!plan()) return "asleep";
    const phase = props.paywall.phase();
    if (phase === "checkout") return "working";
    if (phase === "failed") return "waiting";
    return member.wakeRank < wave.count() ? "waiting" : "asleep";
  };
  return (
    <>
      <main
        class={["server-paywall", { "server-paywall-success": paid() }, fades.classes()]}
        aria-labelledby={titleId}
        ref={(element) => fades.bind(element)}
        onScroll={fades.measure}
      >
        <div class="server-paywall-shell" ref={(element) => fades.watch(element)}>
          <CrewRow moodOf={moodOf} cheer={paid()} />
          <Switch>
            <Match when={paid()}>
              <PaywallPaid server={props.server} paywall={props.paywall} titleId={titleId} />
            </Match>
            <Match when={!plan()}>
              <PaywallWait server={props.server} titleId={titleId} />
            </Match>
            <Match when={props.paywall.phase() === "checkout"}>
              <PaywallCheckout paywall={props.paywall} titleId={titleId} />
            </Match>
            <Match when={plan()}>
              {(current) => (
                <PaywallOffer
                  server={props.server}
                  plan={current()}
                  paywall={props.paywall}
                  titleId={titleId}
                  onWake={wave.wake}
                />
              )}
            </Match>
          </Switch>
        </div>
      </main>
      <ScrollEdgeBlur fades={fades} />
    </>
  );
}
