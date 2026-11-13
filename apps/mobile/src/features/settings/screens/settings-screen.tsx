import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import Bell from "lucide-react-native/icons/bell";
import Bot from "lucide-react-native/icons/bot";
import CreditCard from "lucide-react-native/icons/credit-card";
import EyeOff from "lucide-react-native/icons/eye-off";
import Info from "lucide-react-native/icons/info";
import Languages from "lucide-react-native/icons/languages";
import Layers2 from "lucide-react-native/icons/layers-2";
import Lock from "lucide-react-native/icons/lock";
import MessageCircleQuestionMark from "lucide-react-native/icons/message-circle-question-mark";
import Mic from "lucide-react-native/icons/mic";
import Palette from "lucide-react-native/icons/palette";
import Shield from "lucide-react-native/icons/shield";
import Vibrate from "lucide-react-native/icons/vibrate";
import WandSparkles from "lucide-react-native/icons/wand-sparkles";
import { useEffect, useState } from "react";
import { useUniwind } from "uniwind";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { fileLimitText, MOBILE_LARGE_FILE_BYTES } from "@/features/chat/model/large-files";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsSwitch } from "@/features/settings/components/settings-controls";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { agentDefaultsServers } from "@/features/settings/model/agent-defaults";
import { useBillingState } from "@/features/settings/model/billing";
import { saveLargeFilePreference, useLargeFilePreference } from "@/features/settings/model/large-files";
import { savePhotoQualityPreference, usePhotoQualityPreference } from "@/features/settings/model/photo-quality";
import { shortcutsSupported } from "@/features/shortcuts/shortcuts-native";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { haptics } from "@/shared/lib/haptics";
import { refreshMobileFeatures, useMobileFeature } from "@/shared/lib/mobile-features";
import { useText } from "@/shared/lib/text";

export function SettingsScreen() {
  const { session } = useMobileSession();
  const text = useText();
  const { t } = text;
  const { theme } = useUniwind();
  const largeFiles = useLargeFilePreference();
  // Only an owner or admin of a server with `agent-defaults-v1` can change the agent defaults.
  const managesAgents = useMobileWorkspaceSelector((workspace) => agentDefaultsServers(workspace).length > 0);
  const [largeFilesError, setLargeFilesError] = useState<string | null>(null);
  function saveLargeFiles(automatic: boolean) {
    setLargeFilesError(null);
    void saveLargeFilePreference(automatic).catch(() => {
      setLargeFilesError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }
  const photoQuality = usePhotoQualityPreference();
  const [photoQualityError, setPhotoQualityError] = useState<string | null>(null);
  function savePhotoQuality(fullQuality: boolean) {
    setPhotoQualityError(null);
    void savePhotoQualityPreference(fullQuality).catch(() => {
      setPhotoQualityError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  }
  const displayName = session ? mobileUserName(session.user) : t("mobile.settings.home.profile");
  // Billing shows only while the cloudServers feature flag is on and the account server has billing.
  // With the flag off, Settings has no Billing row, also for an account that has hosted servers.
  const apiUrl = session?.apiUrl ?? "";
  const cloudServersOn = useMobileFeature(apiUrl, "cloudServers");
  useEffect(() => {
    if (apiUrl) void refreshMobileFeatures(apiUrl);
  }, [apiUrl]);
  const billing = useBillingState(cloudServersOn);
  const showsBilling = cloudServersOn && billing.data?.available !== false;
  const planCount = billing.data?.servers.length;
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
      {showsBilling ? (
        <SettingsSection title={t("mobile.settings.home.account")}>
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
        </SettingsSection>
      ) : null}
      <SettingsSection title={t("mobile.settings.home.preferences")}>
        <SettingsRow leading={<RowIcon icon={Palette} />} onPress={() => router.push("/settings/appearance")}>
          <Typography.Paragraph>{t("mobile.settings.appearance.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={WandSparkles} />} onPress={() => router.push("/settings/animations")}>
          <Typography.Paragraph>{t("mobile.settings.animations.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Languages} />} onPress={() => router.push("/settings/language")}>
          <Typography.Paragraph>{t("mobile.settings.language.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Mic} />} onPress={() => router.push("/settings/voice")}>
          <Typography.Paragraph>{t("mobile.settings.voice.title")}</Typography.Paragraph>
        </SettingsRow>
        {/* The shortcuts need the Shortcuts app of iOS 26. */}
        {shortcutsSupported ? (
          <SettingsRow leading={<RowIcon icon={Layers2} />} onPress={() => router.push("/settings/shortcuts")}>
            <Typography.Paragraph>{t("mobile.settings.shortcuts.title")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        <SettingsRow leading={<RowIcon icon={Vibrate} />} onPress={() => router.push("/settings/haptics")}>
          <Typography.Paragraph>{t("mobile.settings.feedback.haptics")}</Typography.Paragraph>
        </SettingsRow>
        {managesAgents ? (
          <SettingsRow leading={<RowIcon icon={Bot} />} onPress={() => router.push("/settings/agents")}>
            <Typography.Paragraph>{t("mobile.settings.agents.title")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {/* On iOS the screen also has the Live Activities, which exist only there. */}
        <SettingsRow leading={<RowIcon icon={Bell} />} onPress={() => router.push("/settings/notifications")}>
          <Typography.Paragraph>{t("mobile.settings.notifications.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Shield} />} onPress={() => router.push("/settings/privacy")}>
          <Typography.Paragraph>{t("mobile.settings.privacy.title")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow leading={<RowIcon icon={Lock} />} onPress={() => router.push("/settings/app-lock")}>
          <Typography.Paragraph>{t("mobile.appLock.title")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        title={t("mobile.settings.conversations.title")}
        footer={
          largeFilesError ??
          t("mobile.settings.conversations.largeFilesFooter", {
            small: fileLimitText(text, MOBILE_ATTACHMENT_BYTES),
            large: fileLimitText(text, MOBILE_LARGE_FILE_BYTES),
          })
        }
      >
        <SettingsRow leading={<RowIcon icon={EyeOff} />} onPress={() => router.push("/settings/hidden-chats")}>
          <Typography.Paragraph>{t("mobile.settings.conversations.hiddenChats")}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow>
          <SettingsSwitch
            value={largeFiles.automatic}
            disabled={!largeFiles.ready || largeFiles.saving}
            label={t("mobile.settings.conversations.largeFiles")}
            dark={theme === "dark"}
            onValueChange={saveLargeFiles}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection footer={photoQualityError ?? t("mobile.settings.conversations.fullQualityPhotosFooter")}>
        <SettingsRow>
          <SettingsSwitch
            value={photoQuality.fullQuality}
            disabled={!photoQuality.ready || photoQuality.saving}
            label={t("mobile.settings.conversations.fullQualityPhotos")}
            dark={theme === "dark"}
            onValueChange={savePhotoQuality}
          />
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
