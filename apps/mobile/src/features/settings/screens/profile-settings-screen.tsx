import { Host, Text as NativeText, TextInput, type TextInputRef, useNativeState } from "@expo/ui";
import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import { AVATAR_IMAGE_LIMITS } from "@openbot/contracts/input-limits";
import { validateProfileName } from "@openbot/contracts/validation";
import { userErrorMessage as errorMessage } from "@openbot/user-errors";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Pencil } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Keyboard, Pressable, View } from "react-native";
import { useResolveClassNames, useUniwind } from "uniwind";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { ProfileAvatar } from "@/shared/components/profile-avatar";

export function ProfileSettingsScreen() {
  const { session, updateProfile, signOut } = useMobileSession();
  const savedName = session ? mobileUserName(session.user) : "";
  const [name, setName] = useState(savedName);
  const [editingName, setEditingName] = useState(false);
  const nativeName = useNativeState(name);
  const nameInput = useRef<TextInputRef>(null);
  const [nameWidth, setNameWidth] = useState(160);
  const [nameRowWidth, setNameRowWidth] = useState(320);
  const { theme } = useUniwind();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const nameTextStyle = useResolveClassNames("text-title font-semibold");
  useEffect(() => {
    if (!editingName) {
      nativeName.value = savedName;
      setName(savedName);
    }
  }, [editingName, nativeName, savedName]);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;
  const validatedName = validateProfileName(name);
  const nameChanged = name !== savedName;
  const profileError =
    error ||
    (editingName && nameChanged && validatedName.error
      ? validatedName.error === "unsafe"
        ? "Remove line breaks and control characters from your name."
        : "Use 3–20 characters for your display name."
      : null);
  const avatarUrl = session.user.avatarUrl ? new URL(session.user.avatarUrl, session.apiUrl).toString() : null;

  async function perform(operation: () => Promise<void>, success: string): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
      setMessage(success);
    } catch (cause) {
      setError(errorMessage(cause, "Could not save changes. Try again."));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  async function saveName(): Promise<void> {
    if (!nameChanged || validatedName.error) return;
    await perform(async () => {
      await updateProfile({ name: validatedName.name });
      setName(validatedName.name);
      setEditingName(false);
      Keyboard.dismiss();
    }, "Name saved.");
  }

  async function choosePhoto(): Promise<void> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.3,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const file = new File(asset.uri);
    const mime = isAvatarMimeType(file.type) ? file.type : asset.mimeType || "";
    if (!isAvatarMimeType(mime)) throw new Error("Choose a JPEG, PNG, or WebP photo.");
    if (file.size > AVATAR_IMAGE_LIMITS.storedBytes) throw new Error("Choose a photo smaller than 512 KB.");
    const avatar = { bytes: await file.bytes(), mimeType: mime };
    await updateProfile({ avatar });
  }

  return (
    <SettingsContent>
      <View>
        <View className="items-center gap-3 py-3">
          <ProfileAvatar neutral name={savedName} imageUrl={avatarUrl} size={72} />
          <View className="w-full items-center gap-0">
            <View
              className="w-full flex-row items-center justify-center"
              onLayout={(event) => setNameRowWidth(event.nativeEvent.layout.width)}
            >
              {/* Measure with the input's native text engine so its font metrics match. */}
              <Host
                matchContents
                ignoreSafeArea="all"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={{ position: "absolute", opacity: 0, maxWidth: Math.max(44, nameRowWidth - 56) }}
                onLayoutContent={(event) => setNameWidth(Math.ceil(event.nativeEvent.width))}
              >
                <NativeText
                  numberOfLines={1}
                  textStyle={{
                    fontSize: nameTextStyle.fontSize,
                    lineHeight: nameTextStyle.lineHeight,
                    fontWeight: "600",
                  }}
                >
                  {name || "Add your name"}
                </NativeText>
              </Host>
              <View className="w-7" />
              <Host
                colorScheme={theme === "dark" ? "dark" : "light"}
                ignoreSafeArea="all"
                style={{
                  height: 44,
                  width: editingName
                    ? Math.max(44, nameRowWidth - 56)
                    : Math.min(nameWidth + 12, Math.max(44, nameRowWidth - 56)),
                }}
              >
                <TextInput
                  ref={nameInput}
                  value={nativeName}
                  placeholder="Add your name"
                  editable={!busy}
                  textAlign="center"
                  autoCapitalize="words"
                  autoCorrect={false}
                  selectTextOnFocus
                  returnKeyType="done"
                  onFocus={() => {
                    setEditingName(true);
                    setMessage(null);
                    setError(null);
                  }}
                  onChangeText={setName}
                  onSubmitEditing={() => {
                    if (nameChanged) void saveName();
                    else {
                      setEditingName(false);
                      Keyboard.dismiss();
                    }
                  }}
                  style={{ height: 44, paddingHorizontal: 6 }}
                  textStyle={{
                    color: foreground,
                    fontSize: nameTextStyle.fontSize,
                    lineHeight: nameTextStyle.lineHeight,
                    fontWeight: "600",
                  }}
                />
              </Host>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit display name"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => nameInput.current?.focus()}
                hitSlop={8}
                className="h-11 w-7 items-center justify-center"
              >
                <Pencil size={16} strokeWidth={1.5} color={muted} />
              </Pressable>
            </View>
            <Typography.Paragraph type="body-xs" align="center" className="text-grouped-secondary" selectable>
              {session.user.email}
            </Typography.Paragraph>
          </View>
        </View>
        <View className="h-12 flex-row items-center justify-center gap-6">
          {editingName ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel name edit"
              disabled={busy}
              onPress={() => {
                setName(savedName);
                nativeName.value = savedName;
                setEditingName(false);
                setError(null);
                Keyboard.dismiss();
              }}
              className="min-h-11 justify-center px-3"
            >
              <Typography.Paragraph className="text-grouped-secondary">Cancel</Typography.Paragraph>
            </Pressable>
          ) : null}
          {editingName && nameChanged ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save name"
              accessibilityState={{ disabled: busy || Boolean(validatedName.error) }}
              disabled={busy || Boolean(validatedName.error)}
              onPress={() => void saveName()}
              className="min-h-11 justify-center px-3"
              style={{ opacity: busy || validatedName.error ? 0.45 : 1 }}
            >
              <Typography.Paragraph weight="semibold">{busy ? "Saving…" : "Save"}</Typography.Paragraph>
            </Pressable>
          ) : null}
        </View>
        <SettingsSection title="Profile photo">
          <SettingsRow disclosure={false} disabled={busy} onPress={() => void perform(choosePhoto, "")}>
            <Typography.Paragraph type="body-sm">{avatarUrl ? "Change photo" : "Add photo"}</Typography.Paragraph>
          </SettingsRow>
          {avatarUrl ? (
            <SettingsRow
              disclosure={false}
              disabled={busy}
              onPress={() => void perform(() => updateProfile({ avatar: null }), "Photo removed.")}
            >
              <Typography.Paragraph type="body-sm" className="text-danger-text">
                Remove photo
              </Typography.Paragraph>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      </View>
      <SettingsSection title="Security">
        <SettingsRow disabled={busy} onPress={() => router.push("/settings/sessions")}>
          <Typography.Paragraph type="body-sm">Account sessions</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>

      <View className="gap-3">
        {profileError ? (
          <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
            {profileError}
          </Typography.Paragraph>
        ) : null}
        {message ? <Typography.Paragraph accessibilityLiveRegion="polite">{message}</Typography.Paragraph> : null}
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={busy}
            onPress={() =>
              Alert.alert("Sign out?", "Reconnect by scanning a new code from OpenBot on your desktop.", [
                { text: "Cancel", style: "cancel" },
                { text: "Sign out", style: "destructive", onPress: () => void perform(signOut, "") },
              ])
            }
          >
            <Typography.Paragraph className="text-danger-text">Sign out</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      </View>
    </SettingsContent>
  );
}
