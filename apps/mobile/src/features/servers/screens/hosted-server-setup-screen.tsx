import type { HostedServerSummary } from "@openbot/contracts/hosted-servers";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Circle, CircleCheck, CircleX } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { AppLogo } from "@/features/auth/components/app-logo";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import {
  closeHostedCheckout,
  hostedRequestKeys,
  knownHostedServer,
  openHostedCheckout,
  rememberHostedServer,
} from "@/features/servers/model/hosted-server-checkout";
import {
  type HostedSetupStatus,
  hostedSetupSettled,
  hostedSetupStatus,
} from "@/features/servers/model/hosted-server-plans";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/** How often the screen reads the new server while it waits for the payment and the setup. */
const POLL_INTERVAL_MS = 3_000;
/** The setup reports only its step, so the detail lines of a step change on a timer, as on desktop. */
const DETAIL_MS = 2_000;

/** The payment, then the setup steps of the desktop dialog, in order. */
const STEPS = [
  { label: "mobile.server.hosted.step.payment", details: ["mobile.server.hosted.detail.payment"] },
  {
    label: "mobile.server.hosted.step.create",
    details: [
      "mobile.server.hosted.detail.reserve",
      "mobile.server.hosted.detail.copy",
      "mobile.server.hosted.detail.key",
    ],
  },
  {
    label: "mobile.server.hosted.step.start",
    details: [
      "mobile.server.hosted.detail.boot",
      "mobile.server.hosted.detail.app",
      "mobile.server.hosted.detail.wait",
    ],
  },
  {
    label: "mobile.server.hosted.step.connect",
    details: [
      "mobile.server.hosted.detail.signIn",
      "mobile.server.hosted.detail.publish",
      "mobile.server.hosted.detail.check",
    ],
  },
] as const satisfies readonly { label: MobileTextKey; details: readonly MobileTextKey[] }[];

const STEP_OF_STATUS: Record<Exclude<HostedSetupStatus, "error">, number> = {
  payment: 0,
  creating: 1,
  starting: 2,
  connecting: 3,
  ready: STEPS.length,
};

type StepState = "done" | "active" | "pending" | "failed";

/**
 * The new server after its plan was chosen: the payment, then the setup until the server shows in
 * the server list of this phone. The account server goes on with the setup when this sheet closes,
 * and the plans page opens this page again for a server that is still in setup.
 */
export function HostedServerSetupScreen() {
  const { serverId = "" } = useLocalSearchParams<{ serverId?: string }>();
  const { t, errorMessage } = useText();
  const { session } = useMobileSession();
  const { servers, refreshServers, selectServer } = useMobileWorkspace();
  const [accent] = useThemeColor(["accent"]);
  const calls = useMemo(() => (session ? hostedServerCalls(session) : null), [session]);
  const [server, setServer] = useState<HostedServerSummary | null>(() => knownHostedServer(serverId));
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState<"payment" | "retry" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const listed = servers.some((entry) => entry.id === serverId);
  const status: HostedSetupStatus | null = missing ? "error" : server ? hostedSetupStatus(server, listed) : null;
  const settled = status !== null && hostedSetupSettled(status);

  // The error status does not tell which step failed, so it keeps the last step that ran.
  const lastStep = useRef(0);
  if (status && status !== "error") lastStep.current = Math.min(STEP_OF_STATUS[status], STEPS.length - 1);
  const current = status === "ready" ? STEPS.length : lastStep.current;

  const refreshServersRef = useRef(refreshServers);
  refreshServersRef.current = refreshServers;
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!calls || !serverId || settled) return;
    let active = true;
    let reading = false;
    async function poll(): Promise<void> {
      // A read can take longer than the interval, so the next tick skips and reads do not overlap.
      if (reading || AppState.currentState !== "active" || !calls) return;
      reading = true;
      try {
        const [list] = await Promise.all([
          calls.list().catch(() => null),
          statusRef.current === "connecting" ? refreshServersRef.current().catch(() => undefined) : undefined,
        ]);
        if (!active || !list) return;
        // The plans page stays mounted under this page. A key whose server was paid or removed is
        // forgotten now, so "Choose a plan" does not send the key of an expired server again.
        hostedRequestKeys.settle(list.servers);
        const next = list.servers.find((entry) => entry.serverId === serverId);
        // An unpaid server is removed when its payment page expires.
        if (!next) {
          setMissing(true);
          return;
        }
        rememberHostedServer(next);
        setServer(next);
      } finally {
        reading = false;
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    // On Android the payment page leaves the app, so the read runs again as soon as the user returns.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void poll();
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [calls, serverId, settled]);

  const previousStatus = useRef(status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (previous === status) return;
    // Stripe confirmed the payment, or the page expired: the open payment page has nothing more to do.
    if (previous === "payment") closeHostedCheckout();
    if (status === "error") void haptics.notification("error");
    else if (status === "ready" || (previous === "payment" && status !== null)) void haptics.notification("success");
  }, [status]);

  const [detail, setDetail] = useState(0);
  useEffect(() => {
    setDetail(0);
    if (settled) return;
    const last = (STEPS[current]?.details.length ?? 1) - 1;
    const timer = setInterval(() => setDetail((value) => Math.min(value + 1, last)), DETAIL_MS);
    return () => clearInterval(timer);
  }, [current, settled]);

  function stepState(index: number): StepState {
    if (status === "ready" || index < current) return "done";
    if (index > current) return "pending";
    return status === "error" ? "failed" : "active";
  }

  async function openPayment(): Promise<void> {
    if (!calls || pending) return;
    void haptics.impact("medium");
    setPending("payment");
    setActionError(null);
    try {
      const checkout = await calls.checkout(serverId);
      rememberHostedServer(checkout.server);
      setServer(checkout.server);
      setPending(null);
      if (checkout.checkoutUrl) await openHostedCheckout(checkout.checkoutUrl, String(accent));
    } catch (cause) {
      setActionError(errorMessage(cause, t("mobile.server.hosted.paymentFailed")));
      void haptics.notification("error");
      setPending(null);
    }
  }

  async function retry(): Promise<void> {
    if (!calls || pending) return;
    void haptics.impact("medium");
    setPending("retry");
    setActionError(null);
    try {
      const next = await calls.wake(serverId);
      rememberHostedServer(next);
      setServer(next);
    } catch (cause) {
      const text = currentText();
      setActionError(text.errorMessage(cause, text.t("mobile.server.hosted.wakeFailed")));
    } finally {
      setPending(null);
    }
  }

  const name = server?.name ?? t("mobile.server.hosted.defaultName");
  const title = missing
    ? t("mobile.server.hosted.expiredTitle")
    : status === "ready"
      ? t("mobile.server.hosted.readyTitle", { name })
      : status === "error"
        ? t("mobile.server.hosted.failedTitle")
        : status === "payment"
          ? t("mobile.server.hosted.paymentTitle")
          : t("mobile.server.hosted.progressTitle", { name });
  const description = missing
    ? t("mobile.server.hosted.expiredDescription")
    : status === "ready"
      ? t("mobile.server.hosted.readyDescription")
      : status === "error"
        ? t("mobile.server.hosted.failedDescription")
        : status === "payment"
          ? t("mobile.server.hosted.paymentDescription")
          : t("mobile.server.hosted.progressDescription");

  return (
    <SheetScrollView
      scrollEdgeEffect={false}
      contentContainerClassName="gap-7 px-5 pb-safe-offset-5 pt-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <View className="items-center gap-3 px-4" accessibilityLiveRegion="polite">
        <AppLogo animation="blink" interactive size={72} />
        <Typography.Heading type="h3" align="center" className="pt-1" accessibilityRole="header">
          {title}
        </Typography.Heading>
        <Typography.Paragraph
          align="center"
          className="max-w-80 text-text-secondary"
          accessibilityRole={status === "error" ? "alert" : undefined}
        >
          {description}
        </Typography.Paragraph>
      </View>

      {missing ? null : (
        <View className="overflow-hidden rounded-grouped bg-grouped">
          {STEPS.map((step, index) => {
            const state = status === null ? "pending" : stepState(index);
            const detailKey = state === "active" ? step.details[Math.min(detail, step.details.length - 1)] : undefined;
            return (
              <View key={step.label}>
                {index > 0 ? <View className="ml-14 h-px bg-grouped-border" /> : null}
                <SetupStep state={state} label={t(step.label)} detail={detailKey ? t(detailKey) : null} />
              </View>
            );
          })}
        </View>
      )}

      <View className="gap-3">
        {actionError ? (
          <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
            {actionError}
          </Typography.Paragraph>
        ) : null}
        {missing ? (
          <Button size="lg" onPress={() => router.back()}>
            <Button.Label className="font-sans font-semibold">{t("mobile.server.hosted.choosePlan")}</Button.Label>
          </Button>
        ) : status === "ready" ? (
          <Button
            size="lg"
            onPress={() => {
              void haptics.impact("soft");
              selectServer(serverId);
              router.dismissTo("/connected");
            }}
          >
            <Button.Label className="font-sans font-semibold">{t("mobile.server.hosted.open")}</Button.Label>
          </Button>
        ) : status === "error" ? (
          <Button size="lg" isDisabled={pending !== null} onPress={() => void retry()}>
            <Button.Label className="font-sans font-semibold">
              {pending === "retry" ? t("mobile.server.hosted.retrying") : t("common.tryAgain")}
            </Button.Label>
          </Button>
        ) : status === "payment" ? (
          <>
            <Button size="lg" isDisabled={pending !== null} onPress={() => void openPayment()}>
              <Button.Label className="font-sans font-semibold">
                {pending === "payment" ? t("mobile.server.hosted.openingPayment") : t("mobile.server.hosted.continue")}
              </Button.Label>
            </Button>
            <Button size="lg" variant="ghost" isDisabled={pending !== null} onPress={() => router.back()}>
              <Button.Label className="font-sans font-semibold">{t("mobile.server.hosted.otherPlan")}</Button.Label>
            </Button>
          </>
        ) : (
          <Typography.Paragraph type="body-xs" align="center" className="px-4 text-text-secondary">
            {t("mobile.server.hosted.closeHint")}
          </Typography.Paragraph>
        )}
      </View>
    </SheetScrollView>
  );
}

function SetupStep({ state, label, detail }: { state: StepState; label: string; detail: string | null }) {
  const { t } = useText();
  const [accent, success, danger, muted] = useThemeColor(["accent", "success", "danger", "muted"]);
  const stateLabel = {
    done: t("mobile.server.hosted.stepDone"),
    active: t("mobile.server.hosted.stepActive"),
    pending: t("mobile.server.hosted.stepPending"),
    failed: t("mobile.server.hosted.stepFailed"),
  }[state];
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${stateLabel}`}
      className="min-h-14 flex-row items-center gap-3 px-4 py-3"
    >
      <View className="size-6 items-center justify-center">
        {state === "done" ? (
          <CircleCheck size={22} strokeWidth={2} color={success} />
        ) : state === "active" ? (
          <Spinner size="sm" color={String(accent)} />
        ) : state === "failed" ? (
          <CircleX size={22} strokeWidth={2} color={danger} />
        ) : (
          <Circle size={22} strokeWidth={1.5} color={muted} />
        )}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Typography.Paragraph
          weight={state === "active" ? "semibold" : "normal"}
          className={state === "pending" ? "text-text-secondary" : undefined}
        >
          {label}
        </Typography.Paragraph>
        {detail ? (
          <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1}>
            {detail}
          </Typography.Paragraph>
        ) : null}
      </View>
    </View>
  );
}
