import type { ConversationQuestionPrompt } from "@openbot/contracts/ipc";
import type { ConversationUiBlock, UiBlockVaultRequest, UiVaultRequestKind } from "@openbot/contracts/ui-blocks";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import CreditCard from "lucide-react-native/icons/credit-card";
import KeyRound from "lucide-react-native/icons/key-round";
import UserRound from "lucide-react-native/icons/user-round";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import { setVaultRequestHandoff, vaultRequestAnswers, vaultRequestPrefill } from "@/features/chat/model/vault-request";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const ADD_LABEL = {
  login: "mobile.chat.vaultRequest.addLogin",
  card: "mobile.chat.vaultRequest.addCard",
  contact: "mobile.chat.vaultRequest.addContact",
} as const satisfies Record<UiVaultRequestKind, MobileTextKey>;

const KIND_ICON = { login: KeyRound, card: CreditCard, contact: UserRound } as const;

/**
 * The card of an agent's `request_vault_item`, as on desktop: what the item is for, and a button that
 * opens the Vault item form with the fields that the agent filled in. The user types the secrets in
 * the form; the host saves the item and gives the agent its name only. Once saved, the card names the
 * item. Only a host with `ui-block-vault-v1` marks the block; another host's form shows as questions.
 */
export function ChatVaultRequest({
  serverId,
  prompt,
  uiBlock,
  request,
  controller,
  canSend,
  onActivate,
}: {
  serverId: string;
  prompt: ConversationQuestionPrompt;
  uiBlock: ConversationUiBlock;
  request: UiBlockVaultRequest;
  controller?: QuestionPromptController | undefined;
  canSend: boolean;
  onActivate?: (() => void) | undefined;
}) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const resolution =
    prompt.resolution ?? controller?.resolution ?? (controller || onActivate ? null : { status: "expired" as const });
  const open = !resolution && Boolean(controller?.question);
  // The form sends through the controller of the moment, not the one of the render that opened it.
  const send = useRef(controller?.send);
  send.current = controller?.send;
  const title = uiBlock.spec.title ?? "";
  const handoffId = `${serverId}\n${prompt.requestId}`;
  useEffect(() => {
    if (!open) return;
    return setVaultRequestHandoff(handoffId, {
      serverId,
      kind: request.kind,
      title,
      prefill: vaultRequestPrefill(uiBlock.spec),
      save: async (input) => {
        const answer = send.current;
        if (!answer) throw new Error(t("mobile.chat.question.sendFailed"));
        await answer(vaultRequestAnswers(uiBlock.spec, input));
      },
    });
  }, [open, handoffId, serverId, request.kind, title, uiBlock.spec, t]);

  const saved = request.saved;
  const Icon = KIND_ICON[request.kind];
  const detail = resolution
    ? resolution.status === "answered"
      ? saved?.last4
        ? `${t("mobile.server.vault.cardEnding", { last4: saved.last4 })} · ${t("mobile.chat.vaultRequest.saved")}`
        : t("mobile.chat.vaultRequest.saved")
      : resolution.status === "cancelled"
        ? t("mobile.chat.vaultRequest.skipped")
        : t("mobile.chat.question.formExpired")
    : t("mobile.chat.vaultRequest.private");

  return (
    <View
      className="w-full max-w-[92%] self-start gap-3 rounded-[20px] bg-control/60 px-4 py-3"
      style={{ borderCurve: "circular" }}
      accessibilityLabel={t("mobile.chat.question.form")}
    >
      <View className="flex-row items-center gap-3">
        <View
          className="h-10 w-10 items-center justify-center rounded-xl bg-control"
          style={{ borderCurve: "continuous" }}
        >
          {resolution?.status === "answered" ? (
            <Check color={String(muted)} size={18} />
          ) : (
            <Icon color={String(muted)} size={18} />
          )}
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Typography weight="medium" numberOfLines={2}>
            {saved?.name || title}
          </Typography>
          <Typography type="body-xs" className="text-text-secondary">
            {detail}
          </Typography>
        </View>
      </View>
      {open && controller ? (
        <View className="flex-row flex-wrap gap-2">
          <Button
            size="sm"
            className="rounded-full"
            isDisabled={controller.disabled}
            onPress={() => {
              void haptics.selection();
              router.push({ pathname: "/vault-request", params: { requestId: handoffId } });
            }}
          >
            <Button.Label className="font-sans font-semibold">{t(ADD_LABEL[request.kind])}</Button.Label>
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            className="rounded-full"
            isDisabled={controller.disabled}
            onPress={() => void controller.submit({})}
          >
            <Button.Label className="font-sans font-semibold">{t("mobile.chat.vaultRequest.notNow")}</Button.Label>
          </Button>
        </View>
      ) : !resolution && onActivate ? (
        <Button variant="ghost" onPress={onActivate}>
          <Button.Label>{t("mobile.chat.question.answerForm")}</Button.Label>
        </Button>
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
