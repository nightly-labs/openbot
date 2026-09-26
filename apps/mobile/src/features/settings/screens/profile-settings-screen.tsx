import { validateProfileName } from "@openbot/contracts/validation";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Camera } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Keyboard, Pressable, View } from "react-native";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { pickAvatarPhoto } from "@/shared/lib/pick-avatar-photo";
import { useText } from "@/shared/lib/text";

export function ProfileSettingsScreen() {
  const { session, updateProfile, signOut } = useMobileSession();
  const { t, errorMessage } = useText();
  const foreground = useThemeColor("foreground");
  const savedName = session ? mobileUserName(session.user) : "";
  const [draftName, setDraftName] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"name" | "photo" | "sign-out" | null>(null);
  const locked = useRef(false);
  const [error, setError] = useState<string | null>(null);
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

  async function perform(action: "name" | "photo" | "sign-out", operation: () => Promise<void>): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setPendingAction(action);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.settings.profile.saveFailed")));
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
    });
  }

  async function choosePhoto(): Promise<void> {
    const photo = await pickAvatarPhoto("/settings/crop-photo");
    if (!photo) return;
    const avatar = { bytes: photo.bytes, mimeType: photo.mimeType };
    await updateProfile({ avatar });
  }

  function editPhoto(): void {
    if (!avatarUrl) {
      void perform("photo", choosePhoto);
      return;
    }
    Alert.alert(t("mobile.settings.profile.photo"), undefined, [
      { text: t("mobile.settings.profile.changePhoto"), onPress: () => void perform("photo", choosePhoto) },
      {
        text: t("mobile.settings.profile.removePhoto"),
        style: "destructive",
        onPress: () => void perform("photo", () => updateProfile({ avatar: null })),
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <SheetSaveAction
        dirty={nameChanged}
        canSave={!busy && !validatedName.error}
        pending={pendingAction === "name"}
        label={t("mobile.settings.profile.saveName")}
        onSave={() => void saveName()}
      />
      <View className="gap-6">
        <Pressable
          className="self-center"
          accessibilityRole="button"
          accessibilityLabel={
            avatarUrl ? t("mobile.settings.profile.editPhoto") : t("mobile.settings.profile.addPhoto")
          }
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={editPhoto}
        >
          <ProfileAvatar neutral name={savedName} imageUrl={avatarUrl} size={112} />
          <View className="absolute right-0 bottom-0 size-9 items-center justify-center rounded-full border-4 border-sheet bg-grouped">
            <Camera color={foreground} size={14} />
          </View>
        </Pressable>
        <SheetFormField
          label={t("mobile.settings.profile.name")}
          appearance="soft"
          placeholder={t("mobile.settings.profile.namePlaceholder")}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          value={name}
          editable={!busy}
          onChangeText={(value) => {
            setDraftName(value);
            setError(null);
          }}
          onSubmitEditing={() => void saveName()}
        />
      </View>
      {nameError || error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {nameError ?? error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection title={t("mobile.settings.profile.email")}>
        <SettingsRow>
          <Typography.Paragraph selectable className="text-grouped-secondary">
            {session.user.email}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.settings.profile.security")}>
        <SettingsRow disabled={busy} onPress={() => router.push("/settings/sessions")}>
          <Typography.Paragraph>{t("mobile.settings.profile.accountSessions")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          disclosure={false}
          disabled={busy}
          onPress={() =>
            Alert.alert(t("mobile.settings.profile.signOutTitle"), t("mobile.settings.profile.signOutBody"), [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("mobile.settings.profile.signOut"),
                style: "destructive",
                onPress: () => void perform("sign-out", signOut),
              },
            ])
          }
        >
          <Typography.Paragraph className="text-danger-text">
            {t("mobile.settings.profile.signOut")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SheetScrollView>
  );
}
