import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { Alert, Keyboard } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function DeleteAccountScreen() {
  const { session, deleteAccount } = useMobileSession();
  const { t, errorMessage } = useText();
  const [email, setEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  if (!session) return null;
  const accountEmail = session.user.email;
  const confirmed = normalizeEmailAddress(email) === accountEmail;

  async function remove(): Promise<void> {
    if (locked.current) return;
    locked.current = true;
    setDeleting(true);
    setError(null);
    try {
      // On success the session ends, and the app shows the sign-in screen.
      await deleteAccount(email);
      void haptics.notification("success");
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.auth.error.accountDeleteFailed")));
      void haptics.notification("error");
    } finally {
      locked.current = false;
      setDeleting(false);
    }
  }

  function confirm(): void {
    if (!confirmed) return;
    Keyboard.dismiss();
    Alert.alert(t("mobile.settings.deleteAccount.finalTitle"), t("mobile.settings.deleteAccount.finalBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("mobile.settings.deleteAccount.confirm"), style: "destructive", onPress: () => void remove() },
    ]);
  }

  return (
    <SettingsContent>
      <Typography.Paragraph>{t("mobile.settings.deleteAccount.body")}</Typography.Paragraph>
      <Typography.Paragraph className="text-grouped-secondary">
        {t("mobile.settings.deleteAccount.localData")}
      </Typography.Paragraph>
      <SheetFormField
        label={t("mobile.settings.deleteAccount.emailLabel", { email: accountEmail })}
        appearance="soft"
        placeholder={accountEmail}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="email"
        returnKeyType="done"
        value={email}
        editable={!deleting}
        onChangeText={(value) => {
          setEmail(value);
          setError(null);
        }}
        onSubmitEditing={confirm}
      />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection>
        <SettingsRow disclosure={false} disabled={!confirmed || deleting} onPress={confirm}>
          <Typography.Paragraph className="text-danger-text">
            {deleting ? t("mobile.settings.deleteAccount.deleting") : t("mobile.settings.deleteAccount.confirm")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
