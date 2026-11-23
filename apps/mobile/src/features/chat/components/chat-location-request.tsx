import type { ConversationQuestionPrompt } from "@openbot/contracts/ipc";
import { encodeSharedLocationAnswer } from "@openbot/contracts/team-protocol/ui-block-location-v1";
import { type ConversationUiBlock, UI_LOCATION_FIELD_ID } from "@openbot/contracts/ui-blocks";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import MapPin from "lucide-react-native/icons/map-pin";
import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, View } from "react-native";
import { useChatCardSurface } from "@/features/chat/components/chat-bubble-fill";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import { setLocationAlwaysAllowed, useLocationAlwaysAllowed } from "@/features/chat/model/location-always-allowed";
import { readCurrentLocation } from "@/features/chat/model/location-request";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

type ShareMode = "once" | "always" | "automatic";

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => subscription.remove();
  }, []);
  return active;
}

export function ChatLocationRequest({
  serverId,
  prompt,
  uiBlock,
  controller,
  canSend,
  onActivate,
}: {
  serverId: string;
  prompt: ConversationQuestionPrompt;
  uiBlock: ConversationUiBlock;
  controller?: QuestionPromptController | undefined;
  canSend: boolean;
  onActivate?: (() => void) | undefined;
}) {
  const { t } = useText();
  const card = useChatCardSurface();
  const muted = useThemeColor("muted");
  const agentId = controller?.agentId;
  const alwaysAllowed = useLocationAlwaysAllowed(serverId, agentId);
  const appActive = useAppActive();
  const [locating, setLocating] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const automaticTried = useRef(false);
  const resolution =
    prompt.resolution ?? controller?.resolution ?? (controller || onActivate ? null : { status: "expired" as const });
  const open = !resolution && Boolean(controller?.question);
  const busy = locating || Boolean(controller?.disabled);
  const detail = resolution
    ? resolution.status === "answered"
      ? t("mobile.chat.locationRequest.shared")
      : resolution.status === "cancelled"
        ? t("mobile.chat.locationRequest.declined")
        : t("mobile.chat.question.formExpired")
    : locating
      ? t("mobile.chat.locationRequest.locating")
      : t("mobile.chat.locationRequest.private");

  async function share(mode: ShareMode): Promise<void> {
    if (!controller || !agentId || locating || controller.disabled) return;
    if (mode !== "automatic") void haptics.selection();
    setUnavailable(false);
    setLocating(true);
    const reading = await readCurrentLocation().catch(() => ({ status: "unavailable" as const }));
    setLocating(false);
    if (reading.status === "found") {
      if (mode === "always") setLocationAlwaysAllowed(serverId, agentId, true);
      await controller.submit({ [UI_LOCATION_FIELD_ID]: [encodeSharedLocationAnswer(reading.location)] });
      return;
    }
    if (mode !== "automatic") void haptics.notification("warning");
    if (reading.status === "unavailable") {
      setUnavailable(true);
      return;
    }
    if (reading.status === "blocked" && mode !== "automatic")
      Alert.alert(t("mobile.chat.locationRequest.deniedTitle"), t("mobile.chat.locationRequest.denied"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("mobile.chat.locationRequest.openSettings"), onPress: () => void Linking.openSettings() },
      ]);
  }

  const shareRef = useRef(share);
  shareRef.current = share;
  const canShareAutomatically = open && alwaysAllowed && appActive && canSend && !controller?.disabled;
  useEffect(() => {
    if (!canShareAutomatically || automaticTried.current) return;
    automaticTried.current = true;
    void shareRef.current("automatic");
  }, [canShareAutomatically]);

  return (
    <View className="w-full gap-2.5" accessibilityLabel={t("mobile.chat.question.form")}>
      <View
        className={`max-w-[92%] flex-row items-center gap-3 self-start rounded-[20px] ${card.fillClass} px-4 py-3`}
        style={card.style}
      >
        <View
          className="h-10 w-10 items-center justify-center rounded-xl bg-control"
          style={{ borderCurve: "continuous" }}
        >
          {resolution?.status === "answered" ? (
            <Check color={String(muted)} size={18} />
          ) : (
            <MapPin color={String(muted)} size={18} />
          )}
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Typography weight="medium" numberOfLines={3}>
            {uiBlock.spec.title ?? ""}
          </Typography>
          <Typography type="body-xs" className="text-text-secondary" accessibilityLiveRegion="polite">
            {detail}
          </Typography>
        </View>
      </View>
      {open && controller ? (
        <View className="flex-row flex-wrap gap-2">
          <Button size="sm" className="rounded-full" isDisabled={busy} onPress={() => void share("once")}>
            <Button.Label className="font-sans font-semibold">{t("mobile.chat.locationRequest.share")}</Button.Label>
          </Button>
          {agentId ? (
            <Button
              size="sm"
              variant="tertiary"
              className="rounded-full"
              isDisabled={busy}
              onPress={() => void share("always")}
            >
              <Button.Label className="font-sans font-semibold">
                {t("mobile.chat.locationRequest.alwaysAllow")}
              </Button.Label>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="tertiary"
            className="rounded-full"
            isDisabled={busy}
            onPress={() => void controller.submit({})}
          >
            <Button.Label className="font-sans font-semibold">{t("mobile.chat.locationRequest.decline")}</Button.Label>
          </Button>
        </View>
      ) : !resolution && onActivate ? (
        <View className="flex-row">
          <Button size="sm" variant="ghost" className="rounded-full" onPress={onActivate}>
            <Button.Label>{t("mobile.chat.question.answerForm")}</Button.Label>
          </Button>
        </View>
      ) : null}
      {alwaysAllowed && agentId && controller?.resolution ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <Typography type="body-xs" className="text-text-secondary">
            {t("mobile.chat.locationRequest.alwaysAllowed")}
          </Typography>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full"
            onPress={() => {
              void haptics.selection();
              setLocationAlwaysAllowed(serverId, agentId, false);
            }}
          >
            <Button.Label>{t("mobile.chat.locationRequest.askEveryTime")}</Button.Label>
          </Button>
        </View>
      ) : null}
      {open && unavailable ? (
        <Typography type="body-xs" accessibilityRole="alert">
          {t("mobile.chat.locationRequest.unavailable")}
        </Typography>
      ) : null}
      {open && controller?.pending ? (
        <Typography type="body-xs" accessibilityLiveRegion="polite">
          {t("mobile.chat.question.sending")}
        </Typography>
      ) : null}
      {open && !canSend ? (
        <Typography type="body-xs" className="text-text-secondary">
          {t("mobile.chat.question.reconnect")}
        </Typography>
      ) : null}
      {open && controller?.failedAnswers ? (
        <Typography type="body-xs" accessibilityRole="alert">
          {t("mobile.chat.question.sendFailed")}
        </Typography>
      ) : null}
    </View>
  );
}
