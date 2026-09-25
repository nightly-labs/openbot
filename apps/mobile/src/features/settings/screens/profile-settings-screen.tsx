import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import { validateProfileName } from "@openbot/contracts/validation";
import { userErrorMessage as errorMessage } from "@openbot/user-errors";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
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

export function ProfileSettingsScreen() {
  const { session, updateProfile, signOut } = useMobileSession();
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
        ? "Remove line breaks and control characters from your name."
        : "Use 3–20 characters for your display name."
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
      setError(errorMessage(cause, "Could not save changes. Try again."));
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.3,
    });
    if (result.canceled) return;
    const [asset] = result.assets;
    if (!asset) throw new Error("Could not open this photo. Try again.");
    const file = new File(asset.uri);
    const mime = isAvatarMimeType(file.type) ? file.type : asset.mimeType || "";
    if (!isAvatarMimeType(mime)) throw new Error("Choose a JPEG, PNG, or WebP photo.");
    if (file.size > AVATAR_IMAGE_LIMITS.storedBytes) throw new Error("Choose a photo smaller than 512 KB.");
    const avatar = { bytes: await file.bytes(), mimeType: mime };
    await updateProfile({ avatar });
  }

  function editPhoto(): void {
    if (!avatarUrl) {
      void perform("photo", choosePhoto);
      return;
    }
    Alert.alert("Profile photo", undefined, [
      { text: "Change photo", onPress: () => void perform("photo", choosePhoto) },
      {
        text: "Remove photo",
        style: "destructive",
        onPress: () => void perform("photo", () => updateProfile({ avatar: null })),
      },
      { text: "Cancel", style: "cancel" },
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
        label="Save name"
        onSave={() => void saveName()}
      />
      <View className="gap-6">
        <Pressable
          className="self-center"
          accessibilityRole="button"
          accessibilityLabel={avatarUrl ? "Edit profile photo" : "Add profile photo"}
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
          label="Name"
          appearance="soft"
          placeholder="Add your name"
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
      <SettingsSection title="Email">
        <SettingsRow>
          <Typography.Paragraph selectable>{session.user.email}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Security">
        <SettingsRow disabled={busy} onPress={() => router.push("/settings/sessions")}>
          <Typography.Paragraph>Account sessions</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          disclosure={false}
          disabled={busy}
          onPress={() =>
            Alert.alert("Sign out?", "Reconnect by scanning a new code from OpenBot on your desktop.", [
              { text: "Cancel", style: "cancel" },
              { text: "Sign out", style: "destructive", onPress: () => void perform("sign-out", signOut) },
            ])
          }
        >
          <Typography.Paragraph className="text-danger-text">Sign out</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SheetScrollView>
  );
}
