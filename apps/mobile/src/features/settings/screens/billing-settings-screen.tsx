import type { BillingServerPlan, BillingSubscriptionStatus } from "@openbot/contracts/billing";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useFocusEffect } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Monitor from "lucide-react-native/icons/monitor";
import { useCallback, useEffect } from "react";
import { View } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { HOSTED_PLAN_TEXT } from "@/features/servers/model/hosted-server-plans";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useBillingState } from "@/features/settings/model/billing";
import { refreshMobileFeatures, useMobileFeature } from "@/shared/lib/mobile-features";
import { useText } from "@/shared/lib/text";

const DATE_FORMAT = { dateStyle: "medium" } as const satisfies Intl.DateTimeFormatOptions;

/**
 * The status that the page names, or null for an active plan, which needs no status row. The account
 * server sends only open plans, so a canceled or expired plan does not come.
 */
const STATUS_TEXT = {
  active: null,
  trialing: "mobile.settings.billing.status.trialing",
  past_due: "mobile.settings.billing.status.pastDue",
  unpaid: "mobile.settings.billing.status.unpaid",
  canceled: null,
  incomplete: null,
  incomplete_expired: null,
  paused: "mobile.settings.billing.status.paused",
} as const satisfies Record<BillingSubscriptionStatus, MobileTextKey | null>;

/**
 * The plan, the billing period, the next date and the price of each hosted server, read only. The
 * user changes a plan or the payment method in OpenBot on the computer. Settings shows this page only
 * while the cloudServers feature flag is on.
 */
export function BillingSettingsScreen() {
  const { t, errorMessage } = useText();
  const { session } = useMobileSession();
  // A link can open this page also while the flag is off, or before Settings read the flags. It reads
  // the flags, and while the flag is off it reads and shows nothing.
  const apiUrl = session?.apiUrl ?? "";
  const cloudServersOn = useMobileFeature(apiUrl, "cloudServers");
  useEffect(() => {
    if (apiUrl) void refreshMobileFeatures(apiUrl);
  }, [apiUrl]);
  const billing = useBillingState(cloudServersOn);
  const { refetch } = billing;
  useFocusEffect(
    useCallback(() => {
      if (cloudServersOn) void refetch({ cancelRefetch: false });
    }, [cloudServersOn, refetch]),
  );

  // An account server with no billing has no plans to show, and the user cannot get one.
  if (!cloudServersOn || billing.data?.available === false) return <SettingsContent />;

  if (billing.isError && !billing.data) {
    return (
      <SettingsContent>
        <View className="items-center gap-4 px-4 pt-10">
          <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
            {errorMessage(billing.error, t("mobile.settings.billing.loadFailed"))}
          </Typography.Paragraph>
          <Button size="lg" isDisabled={billing.isFetching} onPress={() => void refetch()}>
            <Button.Label className="font-sans font-semibold">{t("common.tryAgain")}</Button.Label>
          </Button>
        </View>
      </SettingsContent>
    );
  }
  if (!billing.data) {
    return (
      <SettingsContent>
        <Typography.Paragraph align="center" className="px-4 pt-10 text-text-secondary">
          {t("mobile.settings.billing.loading")}
        </Typography.Paragraph>
      </SettingsContent>
    );
  }
  const plans = billing.data.servers;
  return (
    <SettingsContent>
      {plans.length === 0 ? (
        <NoPlans />
      ) : (
        plans.map((plan, index) => (
          <PlanSection key={plan.subscriptionId} plan={plan} last={index === plans.length - 1} />
        ))
      )}
    </SettingsContent>
  );
}

/** One plan. The last section has the footer that says where the user changes a plan. */
function PlanSection({ plan, last }: { plan: BillingServerPlan; last: boolean }) {
  const { t, format } = useText();
  const status = STATUS_TEXT[plan.status];
  return (
    <SettingsSection
      title={plan.serverName ?? t("mobile.server.hosted.defaultName")}
      footer={last ? t("mobile.settings.billing.footer") : undefined}
    >
      <SettingsRow value={t(HOSTED_PLAN_TEXT[plan.plan].name)}>
        <Typography.Paragraph>{t("mobile.settings.billing.plan")}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow
        value={plan.interval === "year" ? t("mobile.server.hosted.yearly") : t("mobile.server.hosted.monthly")}
      >
        <Typography.Paragraph>{t("mobile.settings.billing.period")}</Typography.Paragraph>
      </SettingsRow>
      {plan.currentPeriodEnd !== null ? (
        <SettingsRow value={format.date(plan.currentPeriodEnd, DATE_FORMAT)}>
          <Typography.Paragraph>
            {plan.cancelAtPeriodEnd ? t("mobile.settings.billing.endsOn") : t("mobile.settings.billing.renewsOn")}
          </Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {plan.amount !== null ? (
        <SettingsRow
          value={t(
            plan.interval === "year" ? "mobile.settings.billing.pricePerYear" : "mobile.settings.billing.pricePerMonth",
            {
              price: format.number(plan.amount / 100, { style: "currency", currency: plan.currency.toUpperCase() }),
            },
          )}
        >
          <Typography.Paragraph>{t("mobile.settings.billing.price")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {status ? (
        <SettingsRow value={t(status)}>
          <Typography.Paragraph>{t("mobile.settings.billing.statusLabel")}</Typography.Paragraph>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}

/** No plan yet. The flag is on here, so the page can say where the user gets a cloud server. */
function NoPlans() {
  const { t } = useText();
  const [foreground] = useThemeColor(["foreground"]);
  return (
    <>
      <Typography.Paragraph align="center" className="px-4 pt-6 text-text-secondary">
        {t("mobile.settings.billing.empty")}
      </Typography.Paragraph>
      <SettingsSection>
        <SettingsRow
          leading={<Monitor color={foreground} size={22} strokeWidth={1.8} />}
          supportingText={t("mobile.server.hosted.computer.addHint")}
        >
          <Typography.Paragraph>{t("mobile.server.hosted.computer.add")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
