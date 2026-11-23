import { router, useFocusEffect } from "expo-router";
import { Typography } from "heroui-native";
import Bell from "lucide-react-native/icons/bell";
import Bot from "lucide-react-native/icons/bot";
import CreditCard from "lucide-react-native/icons/credit-card";
import Gift from "lucide-react-native/icons/gift";
import Info from "lucide-react-native/icons/info";
import Languages from "lucide-react-native/icons/languages";
import Layers2 from "lucide-react-native/icons/layers-2";
import Lock from "lucide-react-native/icons/lock";
import MessageCircleQuestionMark from "lucide-react-native/icons/message-circle-question-mark";
import MessagesSquare from "lucide-react-native/icons/messages-square";
import Mic from "lucide-react-native/icons/mic";
import Palette from "lucide-react-native/icons/palette";
import Shield from "lucide-react-native/icons/shield";
import SquareMenu from "lucide-react-native/icons/square-menu";
import Vibrate from "lucide-react-native/icons/vibrate";
import WandSparkles from "lucide-react-native/icons/wand-sparkles";
import { useCallback } from "react";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { CreditStar } from "@/features/settings/components/credit-star";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { agentDefaultsServers } from "@/features/settings/model/agent-defaults";
import { useBillingState } from "@/features/settings/model/billing";
import { useCreditsState } from "@/features/settings/model/credits";
import { shortcutsSupported } from "@/features/shortcuts/shortcuts-native";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { useRefreshedMobileFeature } from "@/shared/lib/mobile-features";
import { useText } from "@/shared/lib/text";

export function SettingsScreen() {
  const { session } = useMobileSession();
  const { t, format } = useText();
  const managesAgents = useMobileWorkspaceSelector((workspace) => agentDefaultsServers(workspace).length > 0);
  const displayName = session ? mobileUserName(session.user) : t("mobile.settings.home.profile");
  const apiUrl = session?.apiUrl ?? "";
  const cloudServersOn = useRefreshedMobileFeature(apiUrl, "cloudServers");
  const billing = useBillingState(cloudServersOn);
  const showsBilling = cloudServersOn && billing.data?.available !== false;
  const planCount = billing.data?.servers.length;
  const credits = useCreditsState();
  const { refetch: refetchCredits } = credits;
  useFocusEffect(
    useCallback(() => {
      void refetchCredits({ cancelRefetch: false });
    }, [refetchCredits]),
  );
  return (
    <SettingsContent>
      <SettingsSection>
        <SettingsRow
          onPress={() => router.push("/settings/profile")}
          supportingText={session?.user.email}
          leading={
            <ProfileAvatar
              neutral
              name={displayName}
              imageUrl={session?.user.avatarUrl ? new URL(session.user.avatarUrl, session.apiUrl).toString() : null}
              size={40}
            />
          }
        >
          <Typography.Paragraph>{displayName}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {showsBilling || session ? (
        <SettingsSection title={t("mobile.settings.home.account")}>
          {showsBilling ? (
            <SettingsRow
              leading={<RowIcon icon={CreditCard} />}
              onPress={() => router.push("/settings/billing")}
              supportingText={
                planCount === undefined
                  ? undefined
                  : planCount === 0
                    ? t("mobile.settings.billing.noPlans")
                    : t("mobile.settings.billing.planCount", { count: planCount })
              }
            >
              <Typography.Paragraph>{t("mobile.settings.billing.title")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {session ? (
            <SettingsRow
              leading={<CreditStar />}
              onPress={() => router.push("/settings/credits")}
              value={credits.data?.available ? format.number(credits.data.balance) : undefined}
            >
              <Typography.Paragraph>{t("mobile.settings.credits.title")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          {session ? (
            <SettingsRow leading={<RowIcon icon={Gift} />} onPress={() => router.push("/settings/invite")}>
              <Typography.Paragraph>{t("mobile.settings.invite.title")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}
      <SettingsSection title={t("mobile.settings.home.preferences")}>
        <SettingsRow leading={<RowIcon icon={Palette} />} onPress={() => router.push("/settings/appearance")}>
          <Typography.Paragraph>{t("mobile.settings.appearance.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={WandSparkles} />} onPress={() => router.push("/settings/animations")}>
          <Typography.Paragraph>{t("mobile.settings.animations.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Vibrate} />} onPress={() => router.push("/settings/haptics")}>
          <Typography.Paragraph>{t("mobile.settings.feedback.haptics")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Languages} />} onPress={() => router.push("/settings/language")}>
          <Typography.Paragraph>{t("mobile.settings.language.title")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection>
        <SettingsRow leading={<RowIcon icon={MessagesSquare} />} onPress={() => router.push("/settings/conversations")}>
          <Typography.Paragraph>{t("mobile.settings.conversations.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Mic} />} onPress={() => router.push("/settings/voice")}>
          <Typography.Paragraph>{t("mobile.settings.voice.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Bell} />} onPress={() => router.push("/settings/notifications")}>
          <Typography.Paragraph>{t("mobile.settings.notifications.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={SquareMenu} />} onPress={() => router.push("/settings/quick-actions")}>
          <Typography.Paragraph>{t("mobile.settings.quickActions.title")}</Typography.Paragraph>
        </SettingsRow>
        {shortcutsSupported ? (
          <SettingsRow leading={<RowIcon icon={Layers2} />} onPress={() => router.push("/settings/shortcuts")}>
            <Typography.Paragraph>{t("mobile.settings.shortcuts.title")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {managesAgents ? (
          <SettingsRow leading={<RowIcon icon={Bot} />} onPress={() => router.push("/settings/agents")}>
            <Typography.Paragraph>{t("mobile.settings.agents.title")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SettingsSection>
        <SettingsRow leading={<RowIcon icon={Shield} />} onPress={() => router.push("/settings/privacy")}>
          <Typography.Paragraph>{t("mobile.settings.privacy.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Lock} />} onPress={() => router.push("/settings/app-lock")}>
          <Typography.Paragraph>{t("mobile.appLock.title")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          leading={<RowIcon icon={MessageCircleQuestionMark} />}
          onPress={() => router.push("/settings/support")}
          supportingText={t("mobile.settings.home.supportHint")}
        >
          <Typography.Paragraph>{t("mobile.settings.home.support")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Info} />} onPress={() => router.push("/settings/about")}>
          <Typography.Paragraph>{t("mobile.settings.home.about")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
