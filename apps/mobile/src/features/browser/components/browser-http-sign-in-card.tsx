import {
  BROWSER_HTTP_SIGN_IN_PASSWORD_LIMIT,
  BROWSER_HTTP_SIGN_IN_USERNAME_LIMIT,
} from "@openbot/contracts/team-protocol/browser-http-sign-in-v1";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import LogIn from "lucide-react-native/icons/log-in";
import { useRef, useState } from "react";
import { TextInput, type TextInputInstance, View } from "react-native";
import { haptics } from "@/shared/lib/haptics";
import { selectionColorProps } from "@/shared/lib/selection-color";
import { useText } from "@/shared/lib/text";

export function BrowserHttpSignInCard({
  site,
  refused,
  initialUsername,
  onUsernameChange,
  answer,
}: {
  site: string;
  refused: boolean;
  initialUsername: string;
  onUsernameChange: (username: string) => void;
  answer: (value: { username: string; password: string } | null) => Promise<void>;
}) {
  const { t } = useText();
  const [muted, foreground] = useThemeColor(["muted", "foreground"]);
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const passwordField = useRef<TextInputInstance>(null);
  const ready = !pending && Boolean(username || password);
  const run = async (value: { username: string; password: string } | null) => {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      await answer(value);
    } catch {
      setFailed(true);
      void haptics.notification("error");
    } finally {
      setPassword("");
      setPending(false);
    }
  };
  const submit = () => {
    if (ready) void run({ username, password });
  };
  const notice = failed
    ? t("mobile.browser.httpSignIn.failed")
    : refused
      ? t("mobile.browser.httpSignIn.refused")
      : t("mobile.browser.httpSignIn.description");
  const field = "min-h-11 rounded-2xl bg-background px-3 font-sans text-foreground";
  return (
    <View
      className="gap-3 rounded-[26px] bg-control p-4"
      style={{ borderCurve: "continuous" }}
      accessibilityState={{ busy: pending }}
    >
      <View className="gap-0.5">
        <View className="flex-row items-center gap-2">
          <LogIn color={String(foreground)} size={16} />
          <Typography.Paragraph type="body-sm" weight="semibold" className="min-w-0 flex-1" accessibilityRole="header">
            {t("mobile.browser.httpSignIn.title", { site })}
          </Typography.Paragraph>
        </View>
        <Typography.Paragraph
          type="body-xs"
          className={failed || refused ? "text-danger-text" : "text-muted"}
          accessibilityLiveRegion={failed || refused ? "polite" : undefined}
        >
          {notice}
        </Typography.Paragraph>
      </View>
      <TextInput
        accessibilityLabel={t("mobile.browser.httpSignIn.username")}
        placeholder={t("mobile.browser.httpSignIn.username")}
        placeholderTextColor={String(muted)}
        {...selectionColorProps(foreground)}
        className={field}
        style={{ fontSize: 16 }}
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        maxLength={BROWSER_HTTP_SIGN_IN_USERNAME_LIMIT}
        value={username}
        editable={!pending}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordField.current?.focus()}
        onChangeText={(value) => {
          setUsername(value);
          onUsernameChange(value);
        }}
      />
      <TextInput
        ref={passwordField}
        accessibilityLabel={t("mobile.browser.httpSignIn.password")}
        placeholder={t("mobile.browser.httpSignIn.password")}
        placeholderTextColor={String(muted)}
        {...selectionColorProps(foreground)}
        className={field}
        style={{ fontSize: 16 }}
        secureTextEntry
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        maxLength={BROWSER_HTTP_SIGN_IN_PASSWORD_LIMIT}
        value={password}
        editable={!pending}
        returnKeyType="go"
        onSubmitEditing={submit}
        onChangeText={setPassword}
      />
      <View className="flex-row justify-end gap-2">
        <Button size="sm" variant="ghost" isDisabled={pending} onPress={() => void run(null)}>
          <Button.Label>{t("common.cancel")}</Button.Label>
        </Button>
        <Button size="sm" isDisabled={!ready} onPress={submit}>
          <Button.Label>{t("mobile.browser.httpSignIn.submit")}</Button.Label>
        </Button>
      </View>
    </View>
  );
}
