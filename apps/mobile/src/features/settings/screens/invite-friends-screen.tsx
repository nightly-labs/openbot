import { REFERRAL_SHARE_PERCENT } from "@openbot/contracts/referral";
import { Stack } from "expo-router";
import { Button, Typography } from "heroui-native";
import Share2 from "lucide-react-native/icons/share-2";
import { Share, StyleSheet, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { INVITE_NIGHT, InviteTicket } from "@/features/settings/components/invite-ticket";
import { useReferralState } from "@/features/settings/model/referrals";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { headerFontOptions } from "@/shared/lib/app-font";
import { copyWithHaptic } from "@/shared/lib/clipboard";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

const ON_NIGHT = "#ffffff";
const ON_NIGHT_MUTED = "rgba(255,255,255,0.65)";
const EMPTY_LINK = "—";
const titleFont = "headerTitleStyle" in headerFontOptions ? headerFontOptions.headerTitleStyle : {};
const NIGHT_HEADER = {
  headerTintColor: ON_NIGHT,
  headerTitleStyle: { ...titleFont, color: ON_NIGHT },
  ...(isAndroid ? { headerStyle: { backgroundColor: INVITE_NIGHT } } : {}),
};

function linkLabel(link: string): string {
  return link.replace(/^https?:\/\//u, "").replace(/\/$/u, "");
}

export function InviteFriendsScreen() {
  const { t, format } = useText();
  const { session } = useMobileSession();
  const referral = useReferralState();
  const state = referral.data;
  const link = state?.available ? state.link : null;
  const percent = format.number(REFERRAL_SHARE_PERCENT / 100, { style: "percent" });
  const fromName = session ? (mobileUserName(session.user).split(" ")[0] ?? "") : "";
  const shareLabel = t("mobile.settings.invite.share");

  async function share(): Promise<void> {
    if (!link) return;
    void haptics.impact("light");
    const message = t("mobile.settings.invite.shareMessage", { percent });
    try {
      await Share.share(isIOS ? { message, url: link } : { message: `${message} ${link}` });
    } catch (error) {
      supportLog.add("warn", "app", `Share sheet not opened: ${supportLogValue(error)}`);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: INVITE_NIGHT }}>
      <Stack.Screen options={NIGHT_HEADER} />
      {isAndroid ? (
        <AndroidHeaderButton
          placement="right"
          glass
          icon={Share2}
          accessibilityLabel={shareLabel}
          disabled={!link}
          onPress={() => void share()}
        />
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="square.and.arrow.up"
            accessibilityLabel={shareLabel}
            disabled={!link}
            onPress={() => void share()}
          />
        </Stack.Toolbar>
      )}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="invite-glow" cx="50%" cy="8%" r="75%">
            <Stop offset="0" stopColor="#9d6bff" stopOpacity={0.55} />
            <Stop offset="0.45" stopColor="#5b2bb8" stopOpacity={0.22} />
            <Stop offset="1" stopColor={INVITE_NIGHT} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#invite-glow)" />
      </Svg>
      <SheetScrollView
        className="bg-transparent"
        scrollEdgeEffect={false}
        androidNativeHeader
        contentContainerClassName="items-center gap-6 px-6 pb-safe-offset-8 pt-5"
      >
        <View className="items-center gap-1.5">
          <Typography weight="bold" align="center" style={{ color: ON_NIGHT, fontSize: 28, letterSpacing: -0.6 }}>
            {t("mobile.settings.invite.heading")}
          </Typography>
          <Typography align="center" style={{ color: ON_NIGHT_MUTED, fontSize: 15 }}>
            {t("mobile.settings.invite.subtitle")}
          </Typography>
        </View>
        <InviteTicket
          linkLabel={link ? linkLabel(link) : referral.isPending ? t("mobile.settings.invite.loading") : EMPTY_LINK}
          fromName={fromName}
          friendPerk={t("mobile.settings.invite.perk.friendValue", { percent })}
          youPerk={t("mobile.settings.invite.perk.youValue", { percent })}
          ready={link !== null}
          onCopy={() => {
            if (link) copyWithHaptic(link);
          }}
          onTear={share}
        />
        {referral.isError ? (
          <View className="w-full items-center gap-3" style={{ maxWidth: 340 }}>
            <Typography align="center" style={{ color: ON_NIGHT_MUTED, fontSize: 14 }}>
              {t("mobile.settings.invite.loadFailed")}
            </Typography>
            <Button size="sm" variant="secondary" onPress={() => void referral.refetch()}>
              <Button.Label>{t("common.retry")}</Button.Label>
            </Button>
          </View>
        ) : state && !state.available ? (
          <Typography align="center" style={{ color: ON_NIGHT_MUTED, fontSize: 14, maxWidth: 340 }}>
            {t("mobile.settings.invite.unavailable")}
          </Typography>
        ) : (
          <View className="w-full gap-2" style={{ maxWidth: 340 }}>
            <PerkLine
              value={t("mobile.settings.invite.perk.friendValue", { percent })}
              text={t("mobile.settings.invite.perk.friendDetail")}
            />
            <PerkLine
              value={t("mobile.settings.invite.perk.youValue", { percent })}
              text={t("mobile.settings.invite.perk.youDetail")}
            />
          </View>
        )}
      </SheetScrollView>
    </View>
  );
}

function PerkLine({ value, text }: { value: string; text: string }) {
  return (
    <View className="flex-row items-baseline gap-3">
      <Typography weight="bold" style={{ color: ON_NIGHT, fontSize: 14, minWidth: 86 }}>
        {value}
      </Typography>
      <Typography style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, flex: 1 }}>{text}</Typography>
    </View>
  );
}
