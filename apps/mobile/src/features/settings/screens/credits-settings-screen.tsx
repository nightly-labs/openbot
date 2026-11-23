import type {
  CreditActivityEntry,
  CreditExpiring,
  CreditServerRole,
  CreditServerWallet,
  CreditsState,
} from "@openbot/contracts/credits";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router, useFocusEffect } from "expo-router";
import { Button, Chip, Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import CreditCard from "lucide-react-native/icons/credit-card";
import Gift from "lucide-react-native/icons/gift";
import Hourglass from "lucide-react-native/icons/hourglass";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Server from "lucide-react-native/icons/server";
import Sparkles from "lucide-react-native/icons/sparkles";
import { useCallback, useState } from "react";
import { type TextStyle, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { ServerAvatar } from "@/features/servers/components/server-avatar";
import { CreditStar } from "@/features/settings/components/credit-star";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useCreditActivity, useCreditsState } from "@/features/settings/model/credits";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
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

const STEPS = [
  { title: "mobile.settings.credits.steps.buy", detail: "mobile.settings.credits.steps.buyDetail" },
  { title: "mobile.settings.credits.steps.move", detail: "mobile.settings.credits.steps.moveDetail" },
  { title: "mobile.settings.credits.steps.use", detail: "mobile.settings.credits.steps.useDetail" },
] as const satisfies readonly { title: MobileTextKey; detail: MobileTextKey }[];

const LONG_DATE = { dateStyle: "long" } as const satisfies Intl.DateTimeFormatOptions;
const DAY_THIS_YEAR = { month: "long", day: "numeric" } as const satisfies Intl.DateTimeFormatOptions;
const TIME = { hour: "numeric", minute: "2-digit" } as const satisfies Intl.DateTimeFormatOptions;
const ROW_AVATAR_SIZE = 20;
const HERO_STAR_SIZE = 34;
const BALANCE_TEXT: TextStyle = { fontSize: 48, lineHeight: 56, letterSpacing: -1.4, fontVariant: ["tabular-nums"] };

interface ActivityDay {
  day: string;
  key: string;
  at: number;
  entries: CreditActivityEntry[];
}

export function CreditsSettingsScreen() {
  const { t, errorMessage } = useText();
  const signedIn = useMobileSession().session !== null;
  const credits = useCreditsState();
  const available = credits.data?.available === true;
  const activity = useCreditActivity(available);
  const { refetch: refetchCredits } = credits;
  const { refetch: refetchActivity } = activity;
  useFocusEffect(
    useCallback(() => {
      if (signedIn) void refetchCredits({ cancelRefetch: false });
    }, [refetchCredits, signedIn]),
  );
  useFocusEffect(
    useCallback(() => {
      if (signedIn && available) void refetchActivity({ cancelRefetch: false });
    }, [available, refetchActivity, signedIn]),
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
      <BalanceHero state={state} />
      {state.servers.length > 0 ? <ServerCredits servers={state.servers} /> : null}
      <CreditActivity
        state={state}
        entries={activity.data?.entries}
        failed={activity.isError && !activity.data}
        loading={activity.isPending}
      />
    </SettingsContent>
  );
}

function BalanceHero({ state }: { state: CreditsState }) {
  const { t, format } = useText();
  const [warningSoft, warning] = useCSSVariable(["--openbot-warning-soft", "--openbot-warning-text"]);
  const amount = format.number(state.balance);
  return (
    <View className="items-center gap-2 pt-2">
      <View
        accessible
        accessibilityLabel={t("mobile.settings.credits.amount", { count: state.balance, amount })}
        className="flex-row items-center gap-2.5"
      >
        <CreditStar size={HERO_STAR_SIZE} />
        <Typography weight="bold" style={BALANCE_TEXT}>
          {amount}
        </Typography>
      </View>
      <Typography.Paragraph className="text-grouped-secondary">
        {state.balance > 0 ? t("mobile.settings.credits.yours") : t("mobile.settings.credits.none")}
      </Typography.Paragraph>
      {state.expiring ? (
        <View
          className="mt-1 flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
          style={{ backgroundColor: String(warningSoft) }}
        >
          <Hourglass color={String(warning)} size={13} strokeWidth={2} />
          <Typography.Paragraph type="body-xs" className="font-medium text-warning-text">
            <ExpiringText expiring={state.expiring} />
          </Typography.Paragraph>
        </View>
      ) : null}
    </View>
  );
}

function ServerCredits({ servers }: { servers: CreditServerWallet[] }) {
  const { t } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const [showsEmpty, setShowsEmpty] = useState(false);
  const funded = servers.filter((server) => server.balance > 0);
  const empty = servers.filter((server) => server.balance === 0);
  return (
    <SettingsSection
      title={t("mobile.settings.credits.servers")}
      footer={
        servers.some((server) => server.role === "owner") ? t("mobile.settings.credits.serversFooter") : undefined
      }
    >
      {funded.map((wallet) => (
        <ServerCreditRow key={wallet.serverId} wallet={wallet} />
      ))}
      {empty.length > 0 ? (
        <SettingsRow
          leading={<RowIcon icon={Server} />}
          expanded={showsEmpty}
          disclosure={false}
          onPress={() => setShowsEmpty((current) => !current)}
          trailing={
            <ChevronDown
              color={muted}
              size={18}
              strokeWidth={1.5}
              style={{ transform: [{ rotate: showsEmpty ? "180deg" : "0deg" }] }}
            />
          }
        >
          <Typography.Paragraph className="text-grouped-secondary">
            {t("mobile.settings.credits.emptyServers", { count: empty.length })}
          </Typography.Paragraph>
        </SettingsRow>
      ) : null}
      {showsEmpty ? empty.map((wallet) => <ServerCreditRow key={wallet.serverId} wallet={wallet} />) : null}
    </SettingsSection>
  );
}

function ServerCreditRow({ wallet }: { wallet: CreditServerWallet }) {
  const { t, format } = useText();
  const server = useMobileWorkspaceSelector((current) => current.servers.find((item) => item.id === wallet.serverId));
  return (
    <SettingsRow
      leading={
        server ? <ServerAvatar server={server} size={ROW_AVATAR_SIZE} showStatus={false} /> : <RowIcon icon={Server} />
      }
      supportingText={t(ROLE_TEXT[wallet.role])}
      description={wallet.expiring ? <ExpiringText expiring={wallet.expiring} /> : undefined}
      value={format.number(wallet.balance)}
      onPress={
        wallet.role === "owner"
          ? () => router.push({ pathname: "/settings/credits-move", params: { serverId: wallet.serverId } })
          : undefined
      }
    >
      <Typography.Paragraph numberOfLines={1}>{wallet.name}</Typography.Paragraph>
    </SettingsRow>
  );
}

function ExpiringText({ expiring }: { expiring: CreditExpiring }) {
  const { t, format } = useText();
  return t("mobile.settings.credits.expiring", {
    count: expiring.credits,
    amount: format.number(expiring.credits),
    date: format.date(new Date(expiring.expiresAt), LONG_DATE),
  });
}

function activityDays(entries: CreditActivityEntry[]): ActivityDay[] {
  const days: ActivityDay[] = [];
  for (const entry of entries) {
    const day = new Date(entry.at).toDateString();
    const last = days.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, key: `${day}:${days.length}`, at: entry.at, entries: [entry] });
  }
  return days;
}

function CreditActivity({
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
  const { t, format } = useText();
  const footer = t("mobile.settings.credits.footer");
  if (failed || (!entries && loading)) {
    return (
      <SettingsSection title={t("mobile.settings.credits.activity.title")} footer={footer}>
        <SettingsRow>
          <Typography.Paragraph className="text-grouped-secondary">
            {failed ? t("mobile.settings.credits.activity.loadFailed") : t("mobile.settings.credits.activity.loading")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    );
  }
  if (!entries) return null;
  if (entries.length === 0) return <CreditSteps />;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const dayTitle = (at: number) => {
    const date = new Date(at);
    if (date.toDateString() === today.toDateString()) return t("mobile.settings.credits.activity.today");
    if (date.toDateString() === yesterday.toDateString()) return t("mobile.settings.credits.activity.yesterday");
    return format.date(date, date.getFullYear() === today.getFullYear() ? DAY_THIS_YEAR : LONG_DATE);
  };
  const days = activityDays(entries);
  return (
    <>
      {days.map((day, index) => (
        <SettingsSection key={day.key} title={dayTitle(day.at)} footer={index === days.length - 1 ? footer : undefined}>
          {day.entries.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} state={state} />
          ))}
        </SettingsSection>
      ))}
    </>
  );
}

function CreditSteps() {
  const { t, format } = useText();
  return (
    <SettingsSection title={t("mobile.settings.credits.steps.title")}>
      {STEPS.map((step, index) => (
        <SettingsRow
          key={step.title}
          leading={
            <View className="size-5 items-center justify-center rounded-full bg-control-active">
              <Typography type="body-xs" weight="semibold">
                {format.number(index + 1)}
              </Typography>
            </View>
          }
          supportingText={t(step.detail)}
        >
          <Typography.Paragraph>{t(step.title)}</Typography.Paragraph>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
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

function ActivityRow({ entry, state }: { entry: CreditActivityEntry; state: CreditsState }) {
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
  const time = format.date(entry.at, TIME);
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
