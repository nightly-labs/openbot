import type { CreditActivityEntry, CreditExpiring, CreditServerRole, CreditsState } from "@openbot/contracts/credits";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useFocusEffect } from "expo-router";
import { Button, Chip, Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import CreditCard from "lucide-react-native/icons/credit-card";
import Gift from "lucide-react-native/icons/gift";
import Hourglass from "lucide-react-native/icons/hourglass";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Server from "lucide-react-native/icons/server";
import Sparkles from "lucide-react-native/icons/sparkles";
import { useCallback } from "react";
import { View } from "react-native";
import { CreditStar } from "@/features/settings/components/credit-star";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useCreditActivity, useCreditsState } from "@/features/settings/model/credits";
import { useText } from "@/shared/lib/text";

const ROLE_TEXT = {
  owner: "mobile.settings.credits.role.owner",
  admin: "mobile.settings.credits.role.admin",
  member: "mobile.settings.credits.role.member",
} as const satisfies Record<CreditServerRole, MobileTextKey>;

const STATUS_TEXT = {
  running: "mobile.settings.credits.activity.running",
  failed: "mobile.settings.credits.activity.failed",
  canceled: "mobile.settings.credits.activity.canceled",
} as const satisfies Record<NonNullable<CreditActivityEntry["status"]>, MobileTextKey>;

const EXPIRY_DATE = { dateStyle: "long" } as const satisfies Intl.DateTimeFormatOptions;
const SAME_DAY_TIME = { hour: "numeric", minute: "2-digit" } as const satisfies Intl.DateTimeFormatOptions;
const OTHER_DAY_TIME = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

export function CreditsSettingsScreen() {
  const { t, format, errorMessage } = useText();
  const credits = useCreditsState();
  const available = credits.data?.available === true;
  const activity = useCreditActivity(available);
  const { refetch: refetchCredits } = credits;
  const { refetch: refetchActivity } = activity;
  useFocusEffect(
    useCallback(() => {
      void refetchCredits({ cancelRefetch: false });
      if (available) void refetchActivity({ cancelRefetch: false });
    }, [available, refetchActivity, refetchCredits]),
  );

  if (credits.data?.available === false) {
    return (
      <SettingsContent>
        <Typography.Paragraph align="center" className="px-4 pt-10 text-text-secondary">
          {t("mobile.settings.credits.unavailable")}
        </Typography.Paragraph>
      </SettingsContent>
    );
  }
  if (credits.isError && !credits.data) {
    return (
      <SettingsContent>
        <View className="items-center gap-4 px-4 pt-10">
          <Typography.Paragraph accessibilityRole="alert" align="center" className="text-danger-text">
            {errorMessage(credits.error, t("mobile.settings.credits.loadFailed"))}
          </Typography.Paragraph>
          <Button size="lg" isDisabled={credits.isFetching} onPress={() => void refetchCredits()}>
            <Button.Label className="font-sans font-semibold">{t("common.tryAgain")}</Button.Label>
          </Button>
        </View>
      </SettingsContent>
    );
  }
  if (!credits.data) {
    return (
      <SettingsContent>
        <Typography.Paragraph align="center" className="px-4 pt-10 text-text-secondary">
          {t("mobile.settings.credits.loading")}
        </Typography.Paragraph>
      </SettingsContent>
    );
  }
  const state = credits.data;
  return (
    <SettingsContent>
      <SettingsSection>
        <SettingsRow
          leading={<CreditStar size={22} />}
          supportingText={t("mobile.settings.credits.yours")}
          description={state.expiring ? <ExpiringText expiring={state.expiring} /> : undefined}
        >
          <Typography.Paragraph className="font-semibold">
            {t("mobile.settings.credits.amount", { count: state.balance, amount: format.number(state.balance) })}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {state.servers.length > 0 ? (
        <SettingsSection title={t("mobile.settings.credits.servers")}>
          {state.servers.map((server) => (
            <SettingsRow
              key={server.serverId}
              leading={<RowIcon icon={Server} />}
              supportingText={t(ROLE_TEXT[server.role])}
              description={server.expiring ? <ExpiringText expiring={server.expiring} /> : undefined}
              value={t("mobile.settings.credits.amount", {
                count: server.balance,
                amount: format.number(server.balance),
              })}
            >
              <Typography.Paragraph numberOfLines={1}>{server.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      <SettingsSection title={t("mobile.settings.credits.activity.title")} footer={t("mobile.settings.credits.footer")}>
        <ActivityRows
          state={state}
          entries={activity.data?.entries}
          failed={activity.isError && !activity.data}
          loading={activity.isPending}
        />
      </SettingsSection>
    </SettingsContent>
  );
}

function ExpiringText({ expiring }: { expiring: CreditExpiring }) {
  const { t, format } = useText();
  return t("mobile.settings.credits.expiring", {
    count: expiring.credits,
    amount: format.number(expiring.credits),
    date: format.date(new Date(expiring.expiresAt), EXPIRY_DATE),
  });
}

function ActivityRows({
  state,
  entries,
  failed,
  loading,
}: {
  state: CreditsState;
  entries: CreditActivityEntry[] | undefined;
  failed: boolean;
  loading: boolean;
}) {
  const { t } = useText();
  if (failed) {
    return (
      <SettingsRow>
        <Typography.Paragraph className="text-grouped-secondary">
          {t("mobile.settings.credits.activity.loadFailed")}
        </Typography.Paragraph>
      </SettingsRow>
    );
  }
  if (!entries) {
    return loading ? (
      <SettingsRow>
        <Typography.Paragraph className="text-grouped-secondary">
          {t("mobile.settings.credits.activity.loading")}
        </Typography.Paragraph>
      </SettingsRow>
    ) : null;
  }
  if (entries.length === 0) {
    return (
      <SettingsRow>
        <Typography.Paragraph className="text-grouped-secondary">
          {t("mobile.settings.credits.activity.empty")}
        </Typography.Paragraph>
      </SettingsRow>
    );
  }
  const now = Date.now();
  return entries.map((entry) => <ActivityRow key={entry.id} entry={entry} state={state} now={now} />);
}

function activityIcon(entry: CreditActivityEntry): LucideIcon {
  switch (entry.kind) {
    case "generation":
      return Sparkles;
    case "purchase":
      return CreditCard;
    case "move":
      return entry.credits < 0 ? ArrowUp : ArrowDown;
    case "free":
      return Gift;
    case "expired":
      return Hourglass;
    case "refund":
      return RotateCcw;
  }
}

function ActivityRow({ entry, state, now }: { entry: CreditActivityEntry; state: CreditsState; now: number }) {
  const { t, format } = useText();
  const serverName = (serverId: string) =>
    state.servers.find((server) => server.serverId === serverId)?.name ??
    t("mobile.settings.credits.activity.someServer");
  const counterpart = entry.otherServerId
    ? serverName(entry.otherServerId)
    : entry.actor === "you"
      ? t("mobile.settings.credits.activity.yourCredits")
      : t("mobile.settings.credits.activity.ownerCredits");
  const title = activityTitle(entry, counterpart);
  const actor =
    entry.actor === "you"
      ? t("mobile.settings.credits.you")
      : entry.actor === "openbot"
        ? t("mobile.settings.credits.activity.openbot")
        : (entry.actorName ?? t("mobile.settings.credits.activity.member"));
  const wallet = entry.serverId ? serverName(entry.serverId) : t("mobile.settings.credits.yours");
  const time = format.date(
    entry.at,
    new Date(entry.at).toDateString() === new Date(now).toDateString() ? SAME_DAY_TIME : OTHER_DAY_TIME,
  );
  const amount = format.number(Math.abs(entry.credits));
  const signed =
    entry.credits > 0
      ? t("mobile.settings.credits.activity.plus", { amount })
      : entry.credits < 0
        ? t("mobile.settings.credits.activity.minus", { amount })
        : amount;
  return (
    <SettingsRow
      leading={<RowIcon icon={activityIcon(entry)} />}
      supportingText={t("mobile.settings.credits.activity.line", { actor, wallet, time })}
      trailing={
        <Typography.Paragraph className={entry.credits > 0 ? "text-success-text" : "text-grouped-secondary"}>
          {signed}
        </Typography.Paragraph>
      }
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <Typography.Paragraph numberOfLines={1} className="shrink">
          {title}
        </Typography.Paragraph>
        {entry.status ? (
          <Chip size="sm" variant="soft" color={entry.status === "running" ? "accent" : "warning"}>
            <Chip.Label>{t(STATUS_TEXT[entry.status])}</Chip.Label>
          </Chip>
        ) : null}
      </View>
    </SettingsRow>
  );

  function activityTitle(item: CreditActivityEntry, other: string) {
    switch (item.kind) {
      case "generation":
        return item.modelName ?? t("mobile.settings.credits.activity.generation");
      case "purchase":
        return t("mobile.settings.credits.activity.bought");
      case "free":
        return t("mobile.settings.credits.activity.free");
      case "expired":
        return t("mobile.settings.credits.activity.expired");
      case "refund":
        return t("mobile.settings.credits.activity.refund");
      case "move":
        return item.credits < 0
          ? t("mobile.settings.credits.activity.movedTo", { name: other })
          : t("mobile.settings.credits.activity.movedFrom", { name: other });
    }
  }
}
