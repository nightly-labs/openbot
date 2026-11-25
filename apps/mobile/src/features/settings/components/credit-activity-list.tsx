import type { CreditActivityEntry, CreditsState } from "@openbot/contracts/credits";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Chip, Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import CreditCard from "lucide-react-native/icons/credit-card";
import Gift from "lucide-react-native/icons/gift";
import Hourglass from "lucide-react-native/icons/hourglass";
import RotateCcw from "lucide-react-native/icons/rotate-ccw";
import Sparkles from "lucide-react-native/icons/sparkles";
import { View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useText } from "@/shared/lib/text";

const STATUS_TEXT = {
  running: "mobile.settings.credits.activity.running",
  failed: "mobile.settings.credits.activity.failed",
  canceled: "mobile.settings.credits.activity.canceled",
} as const satisfies Record<NonNullable<CreditActivityEntry["status"]>, MobileTextKey>;

const LONG_DATE = { dateStyle: "long" } as const satisfies Intl.DateTimeFormatOptions;
const DAY_THIS_YEAR = { month: "long", day: "numeric" } as const satisfies Intl.DateTimeFormatOptions;
const TIME = { hour: "numeric", minute: "2-digit" } as const satisfies Intl.DateTimeFormatOptions;
const DAY_AND_TIME = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;

interface ActivityDay {
  day: string;
  key: string;
  at: number;
  entries: CreditActivityEntry[];
}

function activityDays(entries: readonly CreditActivityEntry[]): ActivityDay[] {
  const days: ActivityDay[] = [];
  for (const entry of entries) {
    const day = new Date(entry.at).toDateString();
    const last = days.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, key: `${day}:${days.length}`, at: entry.at, entries: [entry] });
  }
  return days;
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

export function CreditActivityDays({
  state,
  entries,
  footer,
}: {
  state: CreditsState;
  entries: readonly CreditActivityEntry[];
  footer?: string;
}) {
  const { t, format } = useText();
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
  return days.map((day, index) => (
    <SettingsSection key={day.key} title={dayTitle(day.at)} footer={index === days.length - 1 ? footer : undefined}>
      {day.entries.map((entry) => (
        <CreditActivityRow key={entry.id} entry={entry} state={state} />
      ))}
    </SettingsSection>
  ));
}

export function CreditActivityRow({
  entry,
  state,
  withDay = false,
}: {
  entry: CreditActivityEntry;
  state: CreditsState;
  withDay?: boolean;
}) {
  const { t, format } = useText();
  const serverName = (serverId: string) =>
    state.servers.find((server) => server.serverId === serverId)?.name ??
    t("mobile.settings.credits.activity.someServer");
  const counterpart = entry.otherServerId
    ? serverName(entry.otherServerId)
    : entry.actor === "you"
      ? t("mobile.settings.credits.activity.yourCredits")
      : t("mobile.settings.credits.activity.ownerCredits");
  const actor =
    entry.actor === "you"
      ? t("mobile.settings.credits.you")
      : entry.actor === "openbot"
        ? t("mobile.settings.credits.activity.openbot")
        : (entry.actorName ?? t("mobile.settings.credits.activity.member"));
  const wallet = entry.serverId ? serverName(entry.serverId) : t("mobile.settings.credits.yours");
  const sameDay = new Date(entry.at).toDateString() === new Date().toDateString();
  const time = format.date(entry.at, withDay && !sameDay ? DAY_AND_TIME : TIME);
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
          {activityTitle(entry, counterpart)}
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
