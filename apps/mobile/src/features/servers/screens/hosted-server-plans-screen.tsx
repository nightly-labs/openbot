import {
  BILLING_CURRENCIES,
  type BillingCurrency,
  type BillingInterval,
  type BillingPlanId,
} from "@openbot/contracts/billing";
import {
  HOSTED_SERVER_CONTACT_URL,
  type HostedServerCatalogPlan,
  type HostedServerList,
} from "@openbot/contracts/hosted-servers";
import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import * as Linking from "expo-linking";
import { router, Stack } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Alert, Button, Chip, Skeleton, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Check, Gauge, HardDrive, Lock, Mail, Ticket, UsersRound } from "lucide-react-native";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Mask, RadialGradient, Rect, Stop } from "react-native-svg";
import { useUniwind } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { type HostedServerCalls, hostedServerCalls } from "@/features/servers/api/hosted-servers";
import { BillingPeriodPicker } from "@/features/servers/components/billing-period-picker";
import {
  hostedRequestKeys,
  openHostedCheckout,
  rememberHostedServer,
  useHostedServerAvailability,
} from "@/features/servers/model/hosted-server-checkout";
import {
  formatHostedPrice,
  guessHostedCurrency,
  hostedMonthlyAmount,
  hostedServerLimit,
  hostedYearlyDiscountPercent,
  newestHostedServerInSetup,
  RECOMMENDED_HOSTED_PLAN,
} from "@/features/servers/model/hosted-server-plans";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { refreshMobileFeatures, useMobileFeature } from "@/shared/lib/mobile-features";
import { phoneCurrencyAndRegion } from "@/shared/lib/phone-languages";
import { isIOS } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";

const PLAN_TEXT = {
  starter: { name: "mobile.server.hosted.plan.starter", summary: "mobile.server.hosted.plan.starterSummary" },
  standard: { name: "mobile.server.hosted.plan.standard", summary: "mobile.server.hosted.plan.standardSummary" },
  pro: { name: "mobile.server.hosted.plan.pro", summary: "mobile.server.hosted.plan.proSummary" },
} as const satisfies Record<BillingPlanId, { name: MobileTextKey; summary: MobileTextKey }>;

type Load =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; plans: HostedServerCatalogPlan[]; list: HostedServerList };

function firstCurrency(): BillingCurrency {
  const phone = phoneCurrencyAndRegion();
  return guessHostedCurrency(phone.currency, phone.region);
}

function nextServerName(count: number, t: MobileTranslate): string {
  return count === 0
    ? t("mobile.server.hosted.defaultName")
    : t("mobile.server.hosted.defaultNameNumbered", { number: count + 1 });
}

/**
 * The plans of a hosted server, as in the desktop add server dialog. A plan opens the Stripe
 * Checkout page in the in-app browser; the account server creates the machine after Stripe confirms
 * the payment, and the setup page follows it.
 */
export function HostedServerPlansScreen() {
  const { t, errorMessage } = useText();
  const { session } = useMobileSession();
  const { servers } = useMobileWorkspace();
  const [accent, accentForeground, muted] = useThemeColor(["accent", "accent-foreground", "muted"]);
  const calls = useMemo(() => (session ? hostedServerCalls(session) : null), [session]);
  const userId = session?.user.id ?? null;
  const apiUrl = session?.apiUrl ?? null;
  const cloudServersOn = useMobileFeature(apiUrl ?? "", "cloudServers");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [currency, setCurrency] = useState<BillingCurrency>(firstCurrency);
  const [plan, setPlan] = useState<BillingPlanId>(RECOMMENDED_HOSTED_PLAN);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createInFlight = useRef(false);
  const listedIds = useRef(new Set<string>());
  listedIds.current = new Set(servers.map((server) => server.id));
  usePreventRemove(creating, () => {
    // The account server may be making the server and its payment page; wait for its answer.
  });

  const read = useCallback(
    async (source: HostedServerCalls, resume: boolean): Promise<void> => {
      setLoad({ kind: "loading" });
      try {
        const [catalog, list] = await Promise.all([
          source.plans(),
          source.list(),
          apiUrl ? refreshMobileFeatures(apiUrl, true) : undefined,
        ]);
        hostedRequestKeys.settle(list.servers);
        if (userId) useHostedServerAvailability.setState({ userId, available: list.available, checkedAt: Date.now() });
        setLoad({ kind: "ready", plans: catalog.plans, list });
        const setup = resume ? newestHostedServerInSetup(list.servers, listedIds.current) : null;
        if (setup) {
          rememberHostedServer(setup);
          router.push({ pathname: "/hosted-server/setup", params: { serverId: setup.serverId } });
        }
      } catch (cause) {
        const text = currentText();
        setLoad({ kind: "failed", message: text.errorMessage(cause, text.t("mobile.server.hosted.loadFailed")) });
      }
    },
    [userId, apiUrl],
  );

  useEffect(() => {
    if (calls) void read(calls, true);
  }, [calls, read]);

  /** After a failed create, the limit can explain it better than the error text. */
  async function refreshList(source: HostedServerCalls): Promise<void> {
    const list = await source.list().catch(() => null);
    if (!list) return;
    hostedRequestKeys.settle(list.servers);
    setLoad((current) => (current.kind === "ready" ? { ...current, list } : current));
  }

  async function continueToPayment(): Promise<void> {
    if (!calls || load.kind !== "ready" || !cloudServersOn || createInFlight.current) return;
    // The plan that shows as selected, also when the catalog does not have the first choice.
    const chosen = (load.plans.find((entry) => entry.id === plan) ?? load.plans[0])?.id;
    if (!chosen) return;
    createInFlight.current = true;
    void haptics.impact("medium");
    setCreating(true);
    setError(null);
    const key = hostedRequestKeys.keyFor(chosen, interval, currency);
    try {
      const checkout = await calls.create({
        name: nextServerName(load.list.servers.length, t),
        plan: chosen,
        interval,
        currency,
        requestId: key.requestId,
      });
      // A server that no longer waits for payment, such as one paid after a create timed out, frees
      // the choice, so the next purchase of it makes a new server.
      if (checkout.server.state === "awaiting_payment") key.serverId = checkout.server.serverId;
      else hostedRequestKeys.forget(chosen, interval, currency);
      rememberHostedServer(checkout.server);
      setCreating(false);
      router.push({ pathname: "/hosted-server/setup", params: { serverId: checkout.server.serverId } });
      if (checkout.checkoutUrl) void openHostedCheckout(checkout.checkoutUrl, String(accent));
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.server.hosted.createFailed")));
      void haptics.notification("error");
      setCreating(false);
      await refreshList(calls);
    } finally {
      createInFlight.current = false;
    }
  }

  if (load.kind === "loading") return <PlansLoading />;

  if (load.kind === "failed") {
    return (
      <PlansContent>
        <View className="items-center gap-4 px-4 pt-10">
          <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
            {load.message}
          </Typography.Paragraph>
          <Button size="lg" onPress={() => calls && void read(calls, false)}>
            <Button.Label className="font-sans font-semibold">{t("common.tryAgain")}</Button.Label>
          </Button>
        </View>
      </PlansContent>
    );
  }

  if (!load.list.available || !cloudServersOn || load.plans.length === 0) {
    return (
      <PlansContent>
        <PlansHeader description={t("mobile.server.hosted.unavailable")} />
        <OtherOptions disabled={false} />
      </PlansContent>
    );
  }

  const limit = hostedServerLimit(load.list);
  const discount = hostedYearlyDiscountPercent(load.plans, currency);
  const selected = load.plans.find((entry) => entry.id === plan) ?? load.plans[0];

  return (
    <PlansContent>
      <PlansHeader description={t("mobile.server.hosted.heroDescription")} />

      {isIOS ? <CurrencyMenu currency={currency} disabled={creating} onChange={setCurrency} /> : null}
      <View className="flex-row items-center gap-3">
        <BillingPeriodPicker
          interval={interval}
          yearlyLabel={
            discount > 0
              ? t("mobile.server.hosted.yearlyDiscount", { percent: discount })
              : t("mobile.server.hosted.yearly")
          }
          disabled={creating}
          onChange={setBillingInterval}
        />
        {isIOS ? null : <CurrencyPicker currency={currency} disabled={creating} onChange={setCurrency} />}
      </View>

      {limit !== null ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t("mobile.server.hosted.limitTitle")}</Alert.Title>
            <Alert.Description>{t("mobile.server.hosted.limitDescription", { count: limit })}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.server.hosted.planLabel")} className="gap-3">
        {load.plans.map((entry) => (
          <PlanOption
            key={entry.id}
            plan={entry}
            interval={interval}
            currency={currency}
            selected={entry.id === selected?.id}
            disabled={creating || limit !== null}
            onSelect={() => {
              void haptics.selection();
              setPlan(entry.id);
              setError(null);
            }}
          />
        ))}
      </View>

      <View className="gap-3">
        {error && limit === null ? (
          <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
            {error}
          </Typography.Paragraph>
        ) : null}
        <Button size="lg" isDisabled={creating || limit !== null} onPress={() => void continueToPayment()}>
          {creating ? <Spinner size="sm" color={String(accentForeground)} /> : null}
          <Button.Label className="font-sans font-semibold">
            {creating ? t("mobile.server.hosted.openingPayment") : t("mobile.server.hosted.continue")}
          </Button.Label>
        </Button>
        <View className="flex-row items-center justify-center gap-1.5 px-2">
          <Lock size={12} strokeWidth={2} color={muted} />
          <Typography.Paragraph type="body-xs" weight="medium" className="text-text-secondary">
            {t("mobile.server.hosted.securePayment")}
          </Typography.Paragraph>
        </View>
      </View>

      <OtherOptions disabled={creating} />
    </PlansContent>
  );
}

function PlansContent({ children }: { children: ReactNode }) {
  return (
    <SheetScrollView
      scrollEdgeEffect={false}
      contentContainerClassName="gap-6 px-4 pb-safe-offset-5 pt-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </SheetScrollView>
  );
}

function PlansLoading() {
  const { t } = useText();
  return (
    <PlansContent>
      <View accessible accessibilityLabel={t("mobile.server.hosted.loading")} className="gap-6">
        <View className="items-center gap-3">
          <Skeleton className="h-6 w-3/5 rounded-full" />
          <Skeleton className="h-4 w-4/5 rounded-full" />
        </View>
        <Skeleton className="h-10 rounded-full" />
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-40 rounded-grouped" />
        ))}
      </View>
    </PlansContent>
  );
}

/** The sheet's own header: a title and one short line. */
function PlansHeader({ description }: { description: string }) {
  const { t } = useText();
  return (
    <View className="items-center gap-2 px-4 pt-1">
      <Typography.Heading type="h3" align="center">
        {t("mobile.server.hosted.heroTitle")}
      </Typography.Heading>
      <Typography.Paragraph type="body-sm" align="center" className="max-w-80 text-text-secondary">
        {description}
      </Typography.Paragraph>
    </View>
  );
}

/** The other ways to get a server, as grouped rows like Settings. */
function OtherOptions({ disabled }: { disabled: boolean }) {
  const { t } = useText();
  const [foreground] = useThemeColor(["foreground"]);
  return (
    <SettingsSection>
      <SettingsRow
        leading={<Ticket color={foreground} size={22} strokeWidth={1.8} />}
        supportingText={t("mobile.server.hosted.joinHint")}
        disabled={disabled}
        onPress={() => router.push("/hosted-server/join")}
      >
        <Typography.Paragraph>{t("mobile.server.hosted.join")}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow
        leading={<Mail color={foreground} size={22} strokeWidth={1.8} />}
        supportingText={t("mobile.server.hosted.contactHint")}
        disabled={disabled}
        onPress={() => void Linking.openURL(HOSTED_SERVER_CONTACT_URL).catch(() => undefined)}
      >
        <Typography.Paragraph>{t("mobile.server.hosted.contact")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/** iOS: the currency is a native menu in the sheet header, so the billing switch gets the full width. */
function CurrencyMenu({
  currency,
  disabled,
  onChange,
}: {
  currency: BillingCurrency;
  disabled: boolean;
  onChange: (currency: BillingCurrency) => void;
}) {
  const { t } = useText();
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu accessibilityLabel={t("mobile.server.hosted.currency")} disabled={disabled}>
        <Stack.Toolbar.Label>{currency.toUpperCase()}</Stack.Toolbar.Label>
        {BILLING_CURRENCIES.map((option) => (
          <Stack.Toolbar.MenuAction
            key={option}
            isOn={option === currency}
            onPress={() => {
              if (option === currency) return;
              void haptics.selection();
              onChange(option);
            }}
          >
            {option.toUpperCase()}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );
}

/** Android: the app has no header toolbar there, so the currency stays beside the billing switch. */
function CurrencyPicker({
  currency,
  disabled,
  onChange,
}: {
  currency: BillingCurrency;
  disabled: boolean;
  onChange: (currency: BillingCurrency) => void;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  return (
    <SettingsPicker<BillingCurrency>
      value={currency}
      options={BILLING_CURRENCIES.map((option) => ({ value: option, label: option.toUpperCase() }))}
      enabled={!disabled}
      dark={theme === "dark"}
      label={t("mobile.server.hosted.currency")}
      onChange={(next) => {
        void haptics.selection();
        onChange(next);
      }}
    />
  );
}

function PlanOption({
  plan,
  interval,
  currency,
  selected,
  disabled,
  onSelect,
}: {
  plan: HostedServerCatalogPlan;
  interval: BillingInterval;
  currency: BillingCurrency;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t, format } = useText();
  const [accentForeground, muted] = useThemeColor(["accent-foreground", "muted"]);
  const price = (amount: number) => formatHostedPrice(format, amount, currency);
  const regular = plan.prices[currency].month;
  const monthly = hostedMonthlyAmount(plan, interval, currency);
  const yearly = interval === "year";
  const name = t(PLAN_TEXT[plan.id].name);
  const recommended = plan.id === RECOMMENDED_HOSTED_PLAN;
  const billed = yearly
    ? t("mobile.server.hosted.billedYearly", {
        price: price(plan.prices[currency].year),
        saving: price(regular * 12 - plan.prices[currency].year),
      })
    : t("mobile.server.hosted.billedMonthly");
  const facts = [
    { icon: UsersRound, label: t("mobile.server.hosted.members", { count: plan.memberLimit }) },
    { icon: HardDrive, label: t("mobile.server.hosted.storage", { count: plan.diskGb }) },
    {
      icon: Gauge,
      label:
        plan.relativeSpeed === 1
          ? t("mobile.server.hosted.speedBase")
          : t("mobile.server.hosted.speedFaster", { factor: plan.relativeSpeed }),
    },
  ];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${name}, ${t("mobile.server.hosted.perMonthPrice", { price: price(monthly) })}, ${billed}`}
      disabled={disabled}
      onPress={onSelect}
      className={`gap-3 overflow-hidden rounded-grouped border-2 bg-grouped px-4 py-4 ${selected ? "border-accent" : "border-transparent"}`}
      style={({ pressed }) => ({ opacity: disabled && !selected ? 0.5 : pressed ? 0.75 : 1 })}
    >
      {recommended ? <RecommendedGlow /> : null}
      <View className="flex-row items-center gap-2">
        <Typography.Paragraph weight="semibold">{name}</Typography.Paragraph>
        {recommended ? (
          <Chip size="sm" variant="primary" color="accent">
            <Chip.Label>{t("mobile.server.hosted.recommended")}</Chip.Label>
          </Chip>
        ) : null}
        <View className="flex-1" />
        <View
          className={`size-6 items-center justify-center rounded-full ${selected ? "bg-accent" : "border-2 border-grouped-border"}`}
        >
          {selected ? <Check size={15} strokeWidth={3} color={accentForeground} /> : null}
        </View>
      </View>

      <View className="gap-0.5">
        <View className="flex-row flex-wrap items-baseline gap-x-2">
          <Typography.Heading type="h3" weight="bold">
            {price(monthly)}
          </Typography.Heading>
          <Typography.Paragraph type="body-sm" className="text-text-secondary">
            {t("mobile.server.hosted.perMonth")}
          </Typography.Paragraph>
          {yearly && regular > monthly ? (
            <Typography.Paragraph type="body-sm" className="text-text-secondary line-through">
              {price(regular)}
            </Typography.Paragraph>
          ) : null}
        </View>
        <Typography.Paragraph type="body-xs" className={yearly ? "text-success-text" : "text-text-secondary"}>
          {billed}
        </Typography.Paragraph>
      </View>

      <Typography.Paragraph type="body-sm" className="text-text-secondary">
        {t(PLAN_TEXT[plan.id].summary)}
      </Typography.Paragraph>

      <View className="flex-row flex-wrap gap-x-4 gap-y-1.5">
        {facts.map(({ icon: Icon, label }) => (
          <View key={label} className="flex-row items-center gap-1.5">
            <Icon size={15} strokeWidth={1.8} color={muted} />
            <Typography.Paragraph type="body-xs" className="text-text-secondary">
              {label}
            </Typography.Paragraph>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

/**
 * The desktop mark of the recommended plan: a cool-to-warm line on the top edge and a soft glow at
 * the bottom. It is decoration behind the content, in the theme's accent and warning colors. The
 * layer measures itself, because a percentage size on the SVG resolves inside the card padding.
 */
function RecommendedGlow() {
  const [accent, warning] = useThemeColor(["accent", "warning"]);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}
    >
      {size ? (
        <Svg width={size.width} height={size.height}>
          <Defs>
            <LinearGradient id="recommended-line" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={accent} stopOpacity={0} />
              <Stop offset="0.3" stopColor={accent} stopOpacity={0.9} />
              <Stop offset="0.7" stopColor={warning} stopOpacity={0.9} />
              <Stop offset="1" stopColor={warning} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="recommended-glow" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={accent} />
              <Stop offset="1" stopColor={warning} />
            </LinearGradient>
            {/* As on desktop: the glow fades out from the middle of the bottom edge. */}
            <RadialGradient id="recommended-fade" cx="50%" cy="100%" rx="90%" ry="100%" fx="50%" fy="100%">
              <Stop offset="0" stopColor="white" stopOpacity={1} />
              <Stop offset="1" stopColor="white" stopOpacity={0} />
            </RadialGradient>
            <Mask id="recommended-mask">
              <Rect
                x={0}
                y={size.height / 2}
                width={size.width}
                height={size.height / 2}
                fill="url(#recommended-fade)"
              />
            </Mask>
          </Defs>
          <Rect
            x={0}
            y={size.height / 2}
            width={size.width}
            height={size.height / 2}
            fill="url(#recommended-glow)"
            opacity={0.22}
            mask="url(#recommended-mask)"
          />
          <Rect x={0} y={0} width={size.width} height={1.5} fill="url(#recommended-line)" />
        </Svg>
      ) : null}
    </View>
  );
}
