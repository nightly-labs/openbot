import type { BrowserTakeoverRequest, RespondToBrowserSecretInput } from "@openbot/contracts/ipc";
import { GlassView } from "expo-glass-effect";
import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import Globe from "lucide-react-native/icons/globe";
import KeyRound from "lucide-react-native/icons/key-round";
import X from "lucide-react-native/icons/x";
import { type ReactNode, useState } from "react";
import { Pressable, TextInput, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics } from "@/shared/lib/haptics";
import { selectionColorProps } from "@/shared/lib/selection-color";
import { useText } from "@/shared/lib/text";

/**
 * The surface of a browser request above the composer: one opaque gray, as the chat scrolls under
 * it, and the neutral action color for the one main action. Cancel is the close button.
 */
function BrowserRequestCard({
  icon,
  title,
  body,
  busy,
  onCancel,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  busy: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const insets = useSafeAreaInsets();
  return (
    <View className="pb-2" style={{ paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}>
      <View
        className="gap-3 rounded-[26px] bg-control py-3 pr-2 pl-4"
        style={{ borderCurve: "continuous" }}
        accessibilityState={{ busy }}
      >
        <View className="flex-row items-start gap-2">
          <View className="min-w-0 flex-1 gap-0.5 pt-1.5">
            <View className="flex-row items-center gap-2">
              {icon}
              <Typography.Paragraph
                type="body-sm"
                weight="semibold"
                className="min-w-0 flex-1"
                accessibilityRole="header"
              >
                {title}
              </Typography.Paragraph>
            </View>
            <Typography.Paragraph type="body-xs" className="text-muted">
              {body}
            </Typography.Paragraph>
          </View>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            accessibilityLabel={t("common.cancel")}
            isDisabled={busy}
            onPress={onCancel}
          >
            <X color={String(muted)} size={18} />
          </Button>
        </View>
        <View className="gap-2 pr-2">{children}</View>
      </View>
    </View>
  );
}

/** A browser step that the user completes in the browser: Open browser, I'm done, or Cancel. */
export function BrowserTakeoverCard({
  request,
  respondToTakeover,
  openBrowser,
}: {
  request: BrowserTakeoverRequest;
  respondToTakeover: (decision: "complete" | "cancel") => Promise<void>;
  /** Shows the tab live on the phone. Absent when the host cannot stream it. */
  openBrowser?: () => void;
}) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const finish = async (decision: "complete" | "cancel") => {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      await respondToTakeover(decision);
      void haptics.notification("success");
    } catch {
      void haptics.notification("error");
      setError(true);
    } finally {
      setPending(false);
    }
  };
  const reload = request.secret?.requiresReload ? ` ${t("mobile.chat.browserSecret.takeoverReload")}` : "";
  return (
    <BrowserRequestCard
      icon={<Globe color={String(muted)} size={14} strokeWidth={2.2} />}
      title={t("mobile.chat.browserSecret.takeoverTitle")}
      body={`${t("mobile.chat.browserSecret.takeoverBody")}${reload}`}
      busy={pending}
      onCancel={() => void finish("cancel")}
    >
      <View className="flex-row gap-2">
        {openBrowser ? (
          <Button
            size="sm"
            className="flex-1 bg-action"
            isDisabled={pending}
            onPress={() => {
              void haptics.impact("soft");
              openBrowser();
            }}
          >
            <Button.Label className="text-action-foreground">{t("mobile.browser.open")}</Button.Label>
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={openBrowser ? "ghost" : "primary"}
          className={openBrowser ? "flex-1" : "flex-1 bg-action"}
          isDisabled={pending}
          onPress={() => void finish("complete")}
        >
          <Button.Label className={openBrowser ? undefined : "text-action-foreground"}>
            {t("mobile.chat.browserSecret.done")}
          </Button.Label>
        </Button>
      </View>
      {error ? (
        <Typography.Paragraph type="body-xs" className="text-danger-text" accessibilityRole="alert">
          {t("mobile.chat.browserSecret.takeoverFailed")}
        </Typography.Paragraph>
      ) : null}
    </BrowserRequestCard>
  );
}

/** The request asks the user to type a secret on the phone, not to complete a step in the browser. */
export function asksForSecret(request: BrowserTakeoverRequest) {
  return Boolean(request.secret && !request.secret.requiresReload);
}

// The composer's bar: its inset, its height and its corner, so the secure field takes its place.
const BAR_INSET = 16;
const BAR_HEIGHT = 48;

/**
 * Takes the place of the composer while an agent asks for a password or a code, so the screen has
 * one field. The value stays in this component: it does not go to the draft, the queue or the chat,
 * and it is cleared when sent. The composer comes back when the request is answered or cancelled.
 */
export function BrowserSecretComposer({
  request,
  respond,
  bottomInset,
  liquidGlassAvailable,
  fallbackBackground,
  foreground,
  muted,
  action,
  actionForeground,
}: {
  request: BrowserTakeoverRequest;
  respond: (input: RespondToBrowserSecretInput) => Promise<void>;
  bottomInset: number;
  liquidGlassAvailable: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  muted: ViewStyle["backgroundColor"];
  action: ViewStyle["backgroundColor"];
  actionForeground: ViewStyle["backgroundColor"];
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
  const insets = useSafeAreaInsets();
  const ready = !pending && (password ? Boolean(value) : value.length === digits);
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
      void haptics.notification("success");
    } catch {
      void haptics.notification("error");
      setError(true);
    } finally {
      if (input.decision === "submit") input.secret = "";
      setPending(false);
    }
  };
  return (
    <View>
      <BrowserRequestCard
        icon={<KeyRound color={String(muted)} size={14} strokeWidth={2.2} />}
        title={title}
        body={t("mobile.chat.browserSecret.submitOnce", { origin: request.secret?.origin ?? "" })}
        busy={pending}
        onCancel={() => void send("cancel")}
      >
        <Button
          size="sm"
          variant="ghost"
          className="self-start px-0"
          isDisabled={pending}
          onPress={() => void send("takeover")}
        >
          <Button.Label className="text-text-secondary">{t("mobile.chat.browserSecret.takeOver")}</Button.Label>
        </Button>
        {error ? (
          <Typography.Paragraph type="body-xs" className="text-danger-text" accessibilityRole="alert">
            {t("mobile.chat.browserSecret.submitFailed")}
          </Typography.Paragraph>
        ) : null}
      </BrowserRequestCard>
      <View
        style={{
          paddingLeft: insets.left + BAR_INSET,
          paddingRight: insets.right + BAR_INSET,
          paddingTop: 8,
          paddingBottom: Math.max(bottomInset, 10),
        }}
      >
        <GlassView
          glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
          style={{
            backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
            borderCurve: "continuous",
            borderRadius: BAR_HEIGHT / 2,
            height: BAR_HEIGHT,
            overflow: "hidden",
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 16,
            paddingRight: 4,
          }}
        >
          <TextInput
            // The composer's ID: the chat's keyboard gesture follows the one field that is shown.
            nativeID="chat-composer-input"
            accessibilityLabel={title}
            placeholder={title}
            placeholderTextColor={String(muted)}
            {...selectionColorProps(foreground)}
            className="min-w-0 flex-1 font-sans text-foreground"
            style={{ fontSize: 16 }}
            secureTextEntry
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType={password ? "default" : "number-pad"}
            autoComplete={password ? "off" : "one-time-code"}
            maxLength={password ? 4096 : digits}
            value={value}
            editable={!pending}
            returnKeyType="send"
            onSubmitEditing={() => {
              if (ready) void send("submit");
            }}
            onChangeText={(text) => setValue(password ? text : text.replace(/[^0-9]/gu, "").slice(0, digits))}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.chat.browserSecret.submit")}
            accessibilityState={{ disabled: !ready, busy: pending }}
            disabled={!ready}
            className="size-10 items-center justify-center rounded-full"
            style={{ backgroundColor: ready ? action : "transparent" }}
            onPress={() => void send("submit")}
          >
            {pending ? (
              <Spinner size="sm" color={String(foreground)} />
            ) : (
              <ArrowUp color={String(ready ? actionForeground : muted)} size={21} strokeWidth={2.2} />
            )}
          </Pressable>
        </GlassView>
      </View>
    </View>
  );
}
