import { REFERRAL_SHARE_PERCENT } from "@openbot/contracts/referral";
import { Stack } from "expo-router";
import { Button, Typography } from "heroui-native";
import Copy from "lucide-react-native/icons/copy";
import { Share, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useCSSVariable, useUniwind } from "uniwind";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { InviteTicket } from "@/features/settings/components/invite-ticket";
import { STUB_COLORS } from "@/features/settings/model/invite-stub-texture";
import { useReferralState } from "@/features/settings/model/referrals";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { copyWithHaptic } from "@/shared/lib/clipboard";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

const EMPTY_LINK = "—";
const CONTENT_WIDTH = { width: "100%", maxWidth: 340 } as const;
const GLOW_LAYER = { position: "absolute", top: -160, left: -16, right: -16, height: 620 } as const;

interface InviteGlow {
  inner: string;
  innerOpacity: number;
  outer: string;
  outerOpacity: number;
  ticketShadow: number;
}

const INVITE_GLOWS: Record<"light" | "dark", InviteGlow> = {
  dark: { inner: "#9d6bff", innerOpacity: 0.5, outer: "#5b2bb8", outerOpacity: 0.2, ticketShadow: 0 },
  light: { inner: "#b48cff", innerOpacity: 0.36, outer: "#c9b3ff", outerOpacity: 0.18, ticketShadow: 0.16 },
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
  const { theme } = useUniwind();
  const mode = theme === "dark" ? "dark" : "light";
  const glow = INVITE_GLOWS[mode];
  const sheet = String(useCSSVariable("--openbot-bg-sheet"));

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
    <>
      <InviteCopyAction
        disabled={!link}
        label={t("mobile.settings.invite.copy")}
        onCopy={() => {
          if (link) copyWithHaptic(link);
        }}
      />
      <SheetScrollView contentContainerClassName="items-center gap-7 px-4 pb-safe-offset-5 pt-5">
        <Svg style={GLOW_LAYER} pointerEvents="none">
          <Defs>
            <RadialGradient id="invite-glow" cx="50%" cy="26%" r="60%">
              <Stop offset="0" stopColor={glow.inner} stopOpacity={glow.innerOpacity} />
              <Stop offset="0.45" stopColor={glow.outer} stopOpacity={glow.outerOpacity} />
              <Stop offset="1" stopColor={sheet} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#invite-glow)" />
        </Svg>
        <View className="items-center gap-1.5" style={CONTENT_WIDTH}>
          <Typography.Heading type="h3" align="center">
            {t("mobile.settings.invite.heading")}
          </Typography.Heading>
          <Typography.Paragraph type="body-sm" align="center" className="text-grouped-secondary">
            {t("mobile.settings.invite.subtitle")}
          </Typography.Paragraph>
        </View>
        <InviteTicket
          linkLabel={link ? linkLabel(link) : referral.isPending ? t("mobile.settings.invite.loading") : EMPTY_LINK}
          fromName={fromName}
          friendPerk={t("mobile.settings.invite.perk.friendValue", { percent })}
          youPerk={t("mobile.settings.invite.perk.youValue", { percent })}
          ready={link !== null}
          onTear={share}
          surface={sheet}
          shadowOpacity={glow.ticketShadow}
          stub={STUB_COLORS[mode]}
        />
        {referral.isError ? (
          <View className="items-center gap-3" style={CONTENT_WIDTH}>
            <Typography.Paragraph type="body-sm" align="center" className="text-grouped-secondary">
              {t("mobile.settings.invite.loadFailed")}
            </Typography.Paragraph>
            <Button size="sm" variant="secondary" onPress={() => void referral.refetch()}>
              <Button.Label>{t("common.retry")}</Button.Label>
            </Button>
          </View>
        ) : state && !state.available ? (
          <Typography.Paragraph type="body-sm" align="center" className="text-grouped-secondary" style={CONTENT_WIDTH}>
            {t("mobile.settings.invite.unavailable")}
          </Typography.Paragraph>
        ) : (
          <View className="gap-2" style={CONTENT_WIDTH}>
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
    </>
  );
}

function InviteCopyAction({ disabled, label, onCopy }: { disabled: boolean; label: string; onCopy: () => void }) {
  if (isAndroid) {
    return (
      <AndroidHeaderButton
        placement="right"
        glass
        icon={Copy}
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onCopy}
      />
    );
  }
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="doc.on.doc" accessibilityLabel={label} disabled={disabled} onPress={onCopy} />
    </Stack.Toolbar>
  );
}

function PerkLine({ value, text }: { value: string; text: string }) {
  return (
    <View className="flex-row items-baseline gap-3">
      <Typography.Paragraph type="body-sm" weight="semibold" style={{ minWidth: 86 }}>
        {value}
      </Typography.Paragraph>
      <Typography.Paragraph type="body-sm" className="flex-1 text-grouped-secondary">
        {text}
      </Typography.Paragraph>
    </View>
  );
}
