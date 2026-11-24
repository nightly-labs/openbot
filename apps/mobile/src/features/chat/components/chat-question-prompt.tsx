import type { ConversationQuestionPrompt } from "@openbot/contracts/ipc";
import { type ConversationUiBlock, UI_CHOICE_QUESTION_ID } from "@openbot/contracts/ui-blocks";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import X from "lucide-react-native/icons/x";
import { View } from "react-native";
import { useChatCardSurface } from "@/features/chat/components/chat-bubble-fill";
import { ChatLocationRequest } from "@/features/chat/components/chat-location-request";
import {
  answeredSelect,
  ChatChoicePrompt,
  ChatConfirmPrompt,
  ConfirmBody,
  choiceBlockOf,
  confirmBlockOf,
  formTitleOf,
  PromptStatus,
  QuestionText,
} from "@/features/chat/components/chat-ui-block-cards";
import { ChatVaultRequest } from "@/features/chat/components/chat-vault-request";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import { isLocationRequest } from "@/features/chat/model/location-request";
import { promptAnswerLabel } from "@/features/chat/model/question-prompt";
import { vaultRequestOf } from "@/features/chat/model/vault-request";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

export function ChatQuestionPrompt({
  serverId,
  prompt,
  uiBlock,
  controller,
  canSend,
  onActivate,
}: {
  serverId: string;
  prompt: ConversationQuestionPrompt;
  uiBlock?: ConversationUiBlock | undefined;
  controller?: QuestionPromptController;
  canSend: boolean;
  onActivate?: () => void;
}) {
  const { t } = useText();
  const card = useChatCardSurface();
  const muted = useThemeColor("muted");
  const canEditPreview = useMobileWorkspaceSelector((workspace) => workspace.canEditUiBlockPreview(serverId));
  const vaultRequest = vaultRequestOf(uiBlock);
  if (vaultRequest && uiBlock)
    return (
      <ChatVaultRequest
        serverId={serverId}
        prompt={prompt}
        uiBlock={uiBlock}
        request={vaultRequest}
        controller={controller}
        canSend={canSend}
        onActivate={onActivate}
      />
    );
  if (uiBlock && isLocationRequest(uiBlock))
    return (
      <ChatLocationRequest
        serverId={serverId}
        prompt={prompt}
        uiBlock={uiBlock}
        controller={controller}
        canSend={canSend}
        onActivate={onActivate}
      />
    );
  const confirm = confirmBlockOf(prompt, uiBlock);
  const choice = choiceBlockOf(prompt, uiBlock);
  const formTitle = formTitleOf(uiBlock, prompt.questions[0]?.question);
  if (!prompt.resolution && !controller && onActivate) {
    return (
      <View className={`max-w-[92%] self-start gap-2 rounded-[20px] ${card.fillClass} px-4 py-3`} style={card.style}>
        {confirm ? (
          <ConfirmBody spec={confirm} compact selectValue={answeredSelect(prompt, null, t)} />
        ) : (
          <QuestionText question={formTitle ?? prompt.questions[0]?.question ?? ""} variant="body" />
        )}
        <Button variant="ghost" onPress={onActivate}>
          <Button.Label>{t("mobile.chat.question.answerForm")}</Button.Label>
        </Button>
      </View>
    );
  }
  const resolution =
    prompt.resolution ?? controller?.resolution ?? (controller ? null : { status: "expired" as const });
  if (resolution) {
    return (
      <View className={`max-w-[92%] self-start gap-2 rounded-[20px] ${card.fillClass} px-4 py-3`} style={card.style}>
        <View className="flex-row items-center gap-2">
          {resolution.status === "answered" ? <Check color={String(muted)} size={18} /> : null}
          <Typography type="body-sm" className="text-text-secondary">
            {resolution.status === "answered"
              ? confirm && prompt.questions[0]
                ? uiBlock?.state.autoAnswer?.done
                  ? t("mobile.chat.question.autoAnswered", {
                      outcome: promptAnswerLabel(prompt.questions[0], resolution, t),
                    })
                  : promptAnswerLabel(prompt.questions[0], resolution, t)
                : t("mobile.chat.question.answersSent")
              : resolution.status === "cancelled"
                ? t("mobile.chat.question.formCancelled")
                : t("mobile.chat.question.formExpired")}
          </Typography>
        </View>
        {formTitle ? <QuestionText question={formTitle} variant="body" /> : null}
        {confirm ? (
          <ConfirmBody spec={confirm} closed selectValue={answeredSelect(prompt, resolution, t)} />
        ) : (
          prompt.questions.map((item) => (
            <View key={item.id} className="gap-1">
              <QuestionText question={item.question} variant="secondary" />
              {resolution.status === "answered" ? (
                <Typography>
                  {item.id === UI_CHOICE_QUESTION_ID
                    ? promptAnswerLabel(item, resolution, t).split("\n").filter(Boolean).join(", ")
                    : promptAnswerLabel(item, resolution, t)}
                </Typography>
              ) : item.options?.length ? (
                <Typography type="body-sm">{item.options.map((option) => option.label).join(", ")}</Typography>
              ) : null}
            </View>
          ))
        )}
      </View>
    );
  }

  if (!controller?.question) return null;
  if (confirm)
    return (
      <ChatConfirmPrompt
        spec={confirm}
        uiBlock={uiBlock}
        controller={controller}
        canSend={canSend}
        canEditPreview={canEditPreview}
      />
    );
  if (choice) return <ChatChoicePrompt spec={choice} controller={controller} canSend={canSend} />;
  const { question, index, disabled, setIndex, answer, submit, replyInChat, setReplyInChat, picked, togglePick } =
    controller;

  const described = question.options?.filter((option) => option.description) ?? [];
  const pageTitle = formTitleOf(uiBlock, question.question);

  return (
    <View className="w-full gap-2.5" accessibilityLabel={t("mobile.chat.question.form")}>
      <View className={`max-w-[92%] self-start gap-1 rounded-[20px] ${card.fillClass} px-4 py-3`} style={card.style}>
        {pageTitle ? <QuestionText question={pageTitle} variant="title" /> : null}
        <QuestionText question={question.question} variant={pageTitle ? "body" : "title"} />
        {question.detail ? <QuestionText question={question.detail} variant="secondary" /> : null}
        {described.length ? (
          <View className="gap-2 pt-1">
            {described.map((option) => (
              <View key={option.label}>
                <Typography type="body-sm" weight="medium">
                  {option.label}
                </Typography>
                <Typography type="body-sm" className="text-text-secondary">
                  {option.description}
                </Typography>
              </View>
            ))}
          </View>
        ) : null}
        {question.isSecret ? (
          <Typography type="body-xs" className="text-text-secondary">
            {t("mobile.chat.question.secretBelow")}
          </Typography>
        ) : null}
        <View className="flex-row items-center gap-1 pt-1">
          {prompt.questions.length > 1 ? (
            <Typography type="body-xs" className="min-w-0 shrink text-text-secondary">
              {t("mobile.chat.question.position", { current: index + 1, total: prompt.questions.length })}
            </Typography>
          ) : null}
          <View className="ms-auto flex-row items-center">
            {prompt.questions.length > 1 ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  accessibilityLabel={t("mobile.chat.question.previous")}
                  isDisabled={disabled || index === 0}
                  onPress={() => setIndex(index - 1)}
                >
                  <ChevronLeft color={String(muted)} size={18} style={MIRROR_IN_RTL} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  accessibilityLabel={t("mobile.chat.question.next")}
                  isDisabled={disabled || index === prompt.questions.length - 1}
                  onPress={() => setIndex(index + 1)}
                >
                  <ChevronRight color={String(muted)} size={18} style={MIRROR_IN_RTL} />
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              accessibilityLabel={t("mobile.chat.question.cancelForm")}
              isDisabled={disabled}
              onPress={() => void submit({})}
            >
              <X color={String(muted)} size={18} />
            </Button>
          </View>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {question.options?.map((option) => {
          const checked = picked.includes(option.label);
          return (
            <Button
              key={option.label}
              size="sm"
              variant={checked ? "primary" : "tertiary"}
              className="h-auto min-h-10 max-w-full rounded-full py-2"
              isDisabled={disabled}
              accessibilityRole={question.multiSelect ? "checkbox" : "button"}
              accessibilityLabel={option.label}
              accessibilityHint={option.description}
              accessibilityState={question.multiSelect ? { checked, disabled } : { disabled }}
              onPress={() => {
                if (question.multiSelect) return togglePick(option.label);
                void haptics.selection();
                answer([option.label]);
              }}
            >
              <Button.Label className="shrink text-center font-sans font-semibold">{option.label}</Button.Label>
            </Button>
          );
        })}
        {question.isSecret ? null : (
          <Button
            size="sm"
            variant={replyInChat ? "primary" : "tertiary"}
            className="rounded-full"
            isDisabled={disabled}
            accessibilityLabel={t("mobile.chat.question.replyInChat")}
            accessibilityHint={t("mobile.chat.question.replyInChatHint")}
            accessibilityState={{ selected: replyInChat, disabled }}
            onPress={() => setReplyInChat(!replyInChat)}
          >
            <Button.Label className="font-sans font-semibold">{t("mobile.chat.question.replyInChat")}</Button.Label>
          </Button>
        )}
        <Button
          size="sm"
          variant="tertiary"
          className="rounded-full"
          isDisabled={disabled}
          onPress={() => {
            void haptics.selection();
            answer([]);
          }}
        >
          <Button.Label className="font-sans font-semibold">{t("mobile.chat.question.skip")}</Button.Label>
        </Button>
        {question.multiSelect ? (
          <Button
            size="sm"
            variant="primary"
            className="rounded-full"
            isDisabled={disabled || picked.length === 0}
            onPress={() => {
              void haptics.selection();
              answer(picked);
            }}
          >
            <Button.Label className="font-sans font-semibold">{t("common.done")}</Button.Label>
          </Button>
        ) : null}
      </View>
      {replyInChat ? (
        <Typography type="body-xs" className="text-text-secondary">
          {t("mobile.chat.question.replyInChatActive")}
        </Typography>
      ) : null}
      <PromptStatus controller={controller} canSend={canSend} />
    </View>
  );
}
