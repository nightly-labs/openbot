import type {
  CreditActivityEntry,
  CreditExpiring,
  CreditServerRole,
  CreditServerWallet,
  CreditsState,
} from "@openbot/contracts/credits";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router, useFocusEffect } from "expo-router";
import { Button, Typography } from "heroui-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Hourglass from "lucide-react-native/icons/hourglass";
import Server from "lucide-react-native/icons/server";
import { useCallback, useEffect, useState } from "react";
import { type TextStyle, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { ServerAvatar } from "@/features/servers/components/server-avatar";
import { CreditActivityRow } from "@/features/settings/components/credit-activity-list";
import { CreditCountUp } from "@/features/settings/components/credit-count-up";
import { CreditStar } from "@/features/settings/components/credit-star";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { type CreditMoveHighlight, useCreditMoveHighlight } from "@/features/settings/model/credit-move-highlight";
import { useCreditActivity, useCreditsState } from "@/features/settings/model/credits";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

const ROLE_TEXT = {
  owner: "mobile.settings.credits.role.owner",
  admin: "mobile.settings.credits.role.admin",
  member: "mobile.settings.credits.role.member",
} as const satisfies Record<CreditServerRole, MobileTextKey>;

const STEPS = [
  { title: "mobile.settings.credits.steps.buy", detail: "mobile.settings.credits.steps.buyDetail" },
  { title: "mobile.settings.credits.steps.move", detail: "mobile.settings.credits.steps.moveDetail" },
  { title: "mobile.settings.credits.steps.use", detail: "mobile.settings.credits.steps.useDetail" },
] as const satisfies readonly { title: MobileTextKey; detail: MobileTextKey }[];

const LONG_DATE = { dateStyle: "long" } as const satisfies Intl.DateTimeFormatOptions;
const ROW_AVATAR_SIZE = 20;
const RECENT_ACTIVITY = 3;
const HIGHLIGHT_MAX_AGE_MS = 5000;
const HERO_STAR_SIZE = 34;
const BALANCE_TEXT: TextStyle = { fontSize: 48, lineHeight: 56, letterSpacing: -1.4, fontVariant: ["tabular-nums"] };

export function CreditsSettingsScreen() {
  const { t, errorMessage } = useText();
  const signedIn = useMobileSession().session !== null;
  const credits = useCreditsState();
  const storedHighlight = useCreditMoveHighlight((state) => state.highlight);
  const clearHighlight = useCreditMoveHighlight((state) => state.clear);
  const highlight = storedHighlight && Date.now() - storedHighlight.at < HIGHLIGHT_MAX_AGE_MS ? storedHighlight : null;
  useFocusEffect(
    useCallback(
      () => () => {
        const current = useCreditMoveHighlight.getState().highlight;
        if (current) clearHighlight(current.id);
      },
      [clearHighlight],
    ),
  );
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
      <BalanceHero state={state} highlight={highlight} onHighlightDone={clearHighlight} />
      {state.servers.length > 0 ? (
        <ServerCredits servers={state.servers} highlight={highlight} onHighlightDone={clearHighlight} />
      ) : null}
      <CreditActivity
        state={state}
        entries={activity.data?.entries}
        failed={activity.isError && !activity.data}
        loading={activity.isPending}
      />
    </SettingsContent>
  );
}

interface HighlightProps {
  highlight: CreditMoveHighlight | null;
  onHighlightDone: (id: number) => void;
}

function BalanceHero({ state, highlight, onHighlightDone }: { state: CreditsState } & HighlightProps) {
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
        <CreditCountUp
          value={state.balance}
          from={highlight?.personalFrom ?? null}
          highlightId={highlight?.id ?? null}
          className="font-sans font-bold"
          style={BALANCE_TEXT}
          onDone={onHighlightDone}
        />
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

function ServerCredits({ servers, highlight, onHighlightDone }: { servers: CreditServerWallet[] } & HighlightProps) {
  const { t } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const [showsEmpty, setShowsEmpty] = useState(false);
  const funded = servers.filter((server) => server.balance > 0);
  const empty = servers.filter((server) => server.balance === 0);
  const highlightedEmpty = highlight !== null && empty.some((server) => server.serverId === highlight.serverId);
  useEffect(() => {
    if (highlightedEmpty) setShowsEmpty(true);
  }, [highlightedEmpty]);
  return (
    <SettingsSection
      title={t("mobile.settings.credits.servers")}
      footer={
        servers.some((server) => server.role === "owner") ? t("mobile.settings.credits.serversFooter") : undefined
      }
    >
      {funded.map((wallet) => (
        <ServerCreditRow
          key={wallet.serverId}
          wallet={wallet}
          highlight={highlight}
          onHighlightDone={onHighlightDone}
        />
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
      {showsEmpty
        ? empty.map((wallet) => (
            <ServerCreditRow
              key={wallet.serverId}
              wallet={wallet}
              highlight={highlight}
              onHighlightDone={onHighlightDone}
            />
          ))
        : null}
    </SettingsSection>
  );
}

function ServerCreditRow({ wallet, highlight, onHighlightDone }: { wallet: CreditServerWallet } & HighlightProps) {
  const { t, format } = useText();
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const owner = wallet.role === "owner";
  const highlighted = highlight?.serverId === wallet.serverId ? highlight : null;
  const server = useMobileWorkspaceSelector((current) => current.servers.find((item) => item.id === wallet.serverId));
  return (
    <SettingsRow
      leading={
        server ? <ServerAvatar server={server} size={ROW_AVATAR_SIZE} showStatus={false} /> : <RowIcon icon={Server} />
      }
      supportingText={t(ROLE_TEXT[wallet.role])}
      description={wallet.expiring ? <ExpiringText expiring={wallet.expiring} /> : undefined}
      value={highlighted ? undefined : format.number(wallet.balance)}
      trailing={
        highlighted ? (
          <View className="flex-row items-center gap-2">
            <CreditCountUp
              paragraph
              align="right"
              value={wallet.balance}
              from={highlighted.serverFrom}
              highlightId={highlighted.id}
              className="text-grouped-secondary"
              onDone={onHighlightDone}
            />
            {owner ? <ChevronRight size={18} color={muted} strokeWidth={1.5} style={MIRROR_IN_RTL} /> : null}
          </View>
        ) : undefined
      }
      onPress={
        owner
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
  const { t } = useText();
  const footer = t("mobile.settings.credits.footer");
  const title = t("mobile.settings.credits.activity.recent");
  if (failed || (!entries && loading)) {
    return (
      <SettingsSection title={title} footer={footer}>
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
  return (
    <SettingsSection title={title} footer={footer}>
      {entries.slice(0, RECENT_ACTIVITY).map((entry) => (
        <CreditActivityRow key={entry.id} entry={entry} state={state} withDay />
      ))}
      <SettingsRow key="all" onPress={() => router.push("/settings/credits-activity")}>
        <Typography.Paragraph className="text-accent-text">
          {t("mobile.settings.credits.activity.seeAll")}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
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
