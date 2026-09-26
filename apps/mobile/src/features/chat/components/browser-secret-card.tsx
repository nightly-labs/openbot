import type { BrowserTakeoverRequest, RespondToBrowserSecretInput } from "@openbot/contracts/ipc";
import { Button, Input, Typography } from "heroui-native";
import { useState } from "react";
import { View } from "react-native";
import { useText } from "@/shared/lib/text";

export function BrowserSecretCard({
  request,
  respond,
  respondToTakeover,
}: {
  request: BrowserTakeoverRequest;
  respondToTakeover: (decision: "complete" | "cancel") => Promise<void>;
  respond: (input: RespondToBrowserSecretInput) => Promise<void>;
}) {
  const { t } = useText();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const password = request.secret?.method === "password";
  const digits = request.secret?.digits ?? 6;
  const title = password
    ? t("mobile.chat.browserSecret.password")
    : request.secret?.method === "authenticator"
      ? t("mobile.chat.browserSecret.authenticatorCode")
      : t("mobile.chat.browserSecret.oneTimeCode");
  const send = async (decision: "submit" | "cancel" | "takeover") => {
    if (pending) return;
    setPending(true);
    setError(false);
    const identity = { agentId: request.agentId, requestId: request.requestId };
    const input: RespondToBrowserSecretInput =
      decision === "submit" ? { ...identity, decision, secret: value } : { ...identity, decision };
    setValue("");
    try {
      await respond(input);
    } catch {
      setError(true);
    } finally {
      if (input.decision === "submit") input.secret = "";
      setPending(false);
    }
  };
  if (!request.secret || request.secret.requiresReload) {
    const finish = async (decision: "complete" | "cancel") => {
      if (pending) return;
      setPending(true);
      setError(false);
      try {
        await respondToTakeover(decision);
      } catch {
        setError(true);
      } finally {
        setPending(false);
      }
    };
    return (
      <View className="gap-2 border-t border-border bg-background p-4">
        <Typography.Heading>{t("mobile.chat.browserSecret.takeoverTitle")}</Typography.Heading>
        <Typography.Paragraph>
          {t("mobile.chat.browserSecret.takeoverBody")}{" "}
          {request.secret?.requiresReload ? t("mobile.chat.browserSecret.takeoverReload") : ""}
        </Typography.Paragraph>
        {error ? (
          <Typography.Paragraph accessibilityRole="alert">
            {t("mobile.chat.browserSecret.takeoverFailed")}
          </Typography.Paragraph>
        ) : null}
        <View className="flex-row gap-2">
          <Button isDisabled={pending} onPress={() => void finish("complete")}>
            <Button.Label>{t("mobile.chat.browserSecret.done")}</Button.Label>
          </Button>
          <Button variant="secondary" isDisabled={pending} onPress={() => void finish("cancel")}>
            <Button.Label>{t("common.cancel")}</Button.Label>
          </Button>
        </View>
      </View>
    );
  }
  return (
    <View className="gap-2 border-t border-border bg-background p-4">
      <Typography.Heading>{title}</Typography.Heading>
      <Typography.Paragraph>
        {t("mobile.chat.browserSecret.submitOnce", { origin: request.secret?.origin ?? "" })}
      </Typography.Paragraph>
      <Input
        accessibilityLabel={title}
        secureTextEntry
        autoCorrect={false}
        autoCapitalize="none"
        keyboardType={password ? "default" : "number-pad"}
        autoComplete={password ? "off" : "one-time-code"}
        maxLength={password ? 4096 : digits}
        value={value}
        editable={!pending}
        onChangeText={(text) => setValue(password ? text : text.replace(/[^0-9]/gu, "").slice(0, digits))}
      />
      {!password ? (
        <Typography className="text-center tracking-widest" accessible={false}>
          {Array.from({ length: digits }, (_, index) => (index < value.length ? "•" : "–")).join(" ")}
        </Typography>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert">
          {t("mobile.chat.browserSecret.submitFailed")}
        </Typography.Paragraph>
      ) : null}
      <View className="flex-row gap-2">
        <Button
          isDisabled={pending || (password ? !value : value.length !== digits)}
          onPress={() => void send("submit")}
        >
          <Button.Label>{t("mobile.chat.browserSecret.submit")}</Button.Label>
        </Button>
        <Button variant="secondary" isDisabled={pending} onPress={() => void send("cancel")}>
          <Button.Label>{t("common.cancel")}</Button.Label>
        </Button>
        <Button variant="tertiary" isDisabled={pending} onPress={() => void send("takeover")}>
          <Button.Label>{t("mobile.chat.browserSecret.takeOver")}</Button.Label>
        </Button>
      </View>
    </View>
  );
}
