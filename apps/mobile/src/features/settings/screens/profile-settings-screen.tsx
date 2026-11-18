import { validateProfileName } from "@openbot/contracts/validation";
import { useFonts } from "@shopify/react-native-skia";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import { Typography } from "heroui-native";
import MonitorSmartphone from "lucide-react-native/icons/monitor-smartphone";
import { useRef, useState } from "react";
import { Alert, Keyboard } from "react-native";
import { useCSSVariable } from "uniwind";
import interMedium from "@/assets/fonts/inter/Inter-Medium.ttf";
import interSemiBold from "@/assets/fonts/inter/Inter-SemiBold.ttf";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { ProfileActivity } from "@/features/settings/components/profile-activity";
import { ProfileHeaderActions } from "@/features/settings/components/profile-header-actions";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { IDENTITY_PICTURE_SIZE, SettingsIdentityHeader } from "@/features/settings/components/settings-identity-header";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { renderProfileShareImage } from "@/features/settings/model/profile-share-image";
import { useProfileActivity } from "@/features/settings/model/use-profile-activity";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { APP_FONT } from "@/shared/lib/app-font";
import { haptics } from "@/shared/lib/haptics";
import { pickAvatarPhoto } from "@/shared/lib/pick-avatar-photo";
import { useText } from "@/shared/lib/text";

type ProfileAction = "name" | "photo" | "share" | "sign-out";

export function ProfileSettingsScreen() {
  const { session, updateProfile, signOut } = useMobileSession();
  const { t, errorMessage } = useText();
  const savedName = session ? mobileUserName(session.user) : "";
  const [draftName, setDraftName] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ProfileAction | null>(null);
  const locked = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const activity = useProfileActivity();
  const shareColors = {
    surface: String(useCSSVariable("--openbot-paper")),
    text: String(useCSSVariable("--openbot-paper-text")),
    muted: String(useCSSVariable("--openbot-paper-text-muted")),
    border: String(useCSSVariable("--openbot-paper-border")),
    accent: String(useCSSVariable("--openbot-accent")),
    logo: String(useCSSVariable("--openbot-logo-production")),
    logoEye: String(useCSSVariable("--openbot-logo-eye")),
  };
  const shareFonts = useFonts({ [APP_FONT]: [interMedium, interSemiBold] });
  if (!session) return null;
  const busy = pendingAction !== null;
  const name = draftName ?? savedName;
  const validatedName = validateProfileName(name);
  const nameChanged = name.trim() !== savedName;
  const nameError =
    nameChanged && validatedName.error
      ? validatedName.error === "unsafe"
        ? t("mobile.settings.profile.nameUnsafe")
        : t("mobile.settings.profile.nameLength")
      : null;
  const avatarUrl = session.user.avatarUrl ? new URL(session.user.avatarUrl, session.apiUrl).toString() : null;

  async function perform(
    action: ProfileAction,
    operation: () => Promise<void>,
    fallback = t("mobile.settings.profile.saveFailed"),
  ): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setPendingAction(action);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause, fallback));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setPendingAction(null);
    }
  }

  async function saveName(): Promise<void> {
    if (!nameChanged || validatedName.error) return;
    await perform("name", async () => {
      await updateProfile({ name: validatedName.name });
      setDraftName(null);
      Keyboard.dismiss();
      void haptics.notification("success");
    });
  }

  async function choosePhoto(): Promise<void> {
    const photo = await pickAvatarPhoto("/settings/crop-photo");
    if (!photo) return;
    const avatar = { bytes: photo.bytes, mimeType: photo.mimeType };
    await updateProfile({ avatar });
    void haptics.notification("success");
  }

  async function removePhoto(): Promise<void> {
    await updateProfile({ avatar: null });
    void haptics.notification("success");
  }

  const stats = activity.stats;
  const shareStats = stats && stats.tokens > 0 ? stats : null;

  async function share(current: NonNullable<typeof shareStats>): Promise<void> {
    if (!(await Sharing.isAvailableAsync())) throw new Error(t("mobile.settings.support.sharingUnavailable"));
    const file = await renderProfileShareImage({ name: savedName, avatarUrl }, current, shareColors, shareFonts);
    try {
      await Sharing.shareAsync(file.uri, {
        mimeType: "image/png",
        UTI: "public.png",
        dialogTitle: t("mobile.settings.profile.shareTitle"),
      });
    } finally {
      if (file.exists) file.delete();
    }
  }

  function confirmSignOut(): void {
    Alert.alert(t("mobile.settings.profile.signOutTitle"), t("mobile.settings.profile.signOutBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.settings.profile.signOut"),
        style: "destructive",
        onPress: () => void perform("sign-out", signOut),
      },
    ]);
  }

  function editPhoto(): void {
    // The name field locks while the photo picker is open, so it gives up the keyboard first.
    Keyboard.dismiss();
    void haptics.impact("soft");
    if (!avatarUrl) {
      void perform("photo", choosePhoto);
      return;
    }
    Alert.alert(t("mobile.settings.profile.photo"), undefined, [
      { text: t("mobile.settings.profile.changePhoto"), onPress: () => void perform("photo", choosePhoto) },
      {
        text: t("mobile.settings.profile.removePhoto"),
        style: "destructive",
        onPress: () => void perform("photo", removePhoto),
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  return (
    <SettingsContent>
      <ProfileHeaderActions
        save={{
          dirty: nameChanged,
          canSave: !busy && !validatedName.error,
          pending: pendingAction === "name",
          label: t("mobile.settings.profile.saveName"),
          onSave: () => void saveName(),
        }}
        onShare={
          shareStats
            ? () => void perform("share", () => share(shareStats), t("mobile.settings.profile.share.createFailed"))
            : null
        }
        onSignOut={confirmSignOut}
        disabled={busy}
      />
      <SettingsIdentityHeader
        picture={<ProfileAvatar neutral name={savedName} imageUrl={avatarUrl} size={IDENTITY_PICTURE_SIZE} />}
        pictureLabel={avatarUrl ? t("mobile.settings.profile.editPhoto") : t("mobile.settings.profile.addPhoto")}
        onPicturePress={editPhoto}
        name={name}
        nameLabel={t("mobile.settings.profile.name")}
        namePlaceholder={t("mobile.settings.profile.namePlaceholder")}
        disabled={busy}
        onNameChange={(value) => {
          setDraftName(value);
          setError(null);
        }}
        onNameSubmit={() => void saveName()}
        subtitle={
          <Typography.Paragraph
            selectable
            accessibilityLabel={`${t("mobile.settings.profile.email")}: ${session.user.email}`}
            className="text-grouped-secondary"
          >
            {session.user.email}
          </Typography.Paragraph>
        }
      />
      {nameError || error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-1 text-danger-text">
          {nameError ?? error}
        </Typography.Paragraph>
      ) : null}
      <ProfileActivity activity={activity} />
      <SettingsSection title={t("mobile.settings.profile.security")}>
        <SettingsRow
          leading={<RowIcon icon={MonitorSmartphone} />}
          disabled={busy}
          onPress={() => router.push("/settings/sessions")}
        >
          <Typography.Paragraph>{t("mobile.settings.profile.accountSessions")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
