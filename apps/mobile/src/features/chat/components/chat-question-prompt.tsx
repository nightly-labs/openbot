import type { ConversationQuestionPrompt } from "@openbot/contracts/ipc";
import { type ConversationUiBlock, UI_CHOICE_QUESTION_ID } from "@openbot/contracts/ui-blocks";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import X from "lucide-react-native/icons/x";
import { View } from "react-native";
import {
  answeredSelect,
  ChatChoicePrompt,
  ChatConfirmPrompt,
  ConfirmBody,
  choiceBlockOf,
  confirmBlockOf,
  PromptStatus,
  QuestionText,
} from "@/features/chat/components/chat-ui-block-cards";
import { ChatVaultRequest } from "@/features/chat/components/chat-vault-request";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import { promptAnswerLabel } from "@/features/chat/model/question-prompt";
import { vaultRequestOf } from "@/features/chat/model/vault-request";
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
  const muted = useThemeColor("muted");
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
  const confirm = confirmBlockOf(prompt, uiBlock);
  const choice = choiceBlockOf(prompt, uiBlock);
  if (!prompt.resolution && !controller && onActivate) {
    return (
      <View className="max-w-[92%] self-start gap-2 rounded-[20px] bg-control/60 px-4 py-3">
        {confirm ? (
          <ConfirmBody spec={confirm} compact selectValue={answeredSelect(prompt, null, t)} />
        ) : (
          <QuestionText question={prompt.questions[0]?.question ?? ""} variant="body" />
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
      <View
        className="max-w-[92%] self-start gap-2 rounded-[20px] bg-control/60 px-4 py-3"
        style={{ borderCurve: "circular" }}
      >
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
        {/* A closed form keeps what it asked, as on desktop, so the person can still read the draft. */}
        {confirm ? (
          <ConfirmBody spec={confirm} closed selectValue={answeredSelect(prompt, resolution, t)} />
        ) : (
          prompt.questions.map((item) => (
            <View key={item.id} className="gap-1">
              <QuestionText question={item.question} variant="secondary" />
              {resolution.status === "answered" ? (
                <Typography>
                  {/* The options of a choice with more than one answer come as lines; show them as a list. */}
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
  if (confirm) return <ChatConfirmPrompt spec={confirm} uiBlock={uiBlock} controller={controller} canSend={canSend} />;
  if (choice) return <ChatChoicePrompt spec={choice} controller={controller} canSend={canSend} />;
  const { question, index, disabled, setIndex, answer, submit, replyInChat, setReplyInChat } = controller;

  const described = question.options?.filter((option) => option.description) ?? [];

  return (
    <View className="w-full gap-2.5" accessibilityLabel={t("mobile.chat.question.form")}>
      <View
        className="max-w-[92%] self-start gap-1 rounded-[20px] bg-control/60 px-4 py-3"
        style={{ borderCurve: "circular" }}
      >
        <View className="flex-row items-center gap-2">
          <View className="min-w-0 flex-1">
            <QuestionText question={question.question} variant="title" />
          </View>
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
        {prompt.questions.length > 1 ? (
          <View className="flex-row items-center justify-between">
            <Typography type="body-xs" className="flex-1 text-text-secondary">
              {t("mobile.chat.question.position", { current: index + 1, total: prompt.questions.length })}
            </Typography>
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
          </View>
        ) : null}
        {/* A pill holds only its label, so the bubble keeps what each option means. */}
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
          // The private answer is typed in the masked field that takes the composer's place.
          <Typography type="body-xs" className="text-text-secondary">
            {t("mobile.chat.question.secretBelow")}
          </Typography>
        ) : null}
      </View>

      {/* Answer pills under the bubble, as the quick replies of the chat design. */}
      <View className="flex-row flex-wrap gap-2">
        {question.options?.map((option) => (
          <Button
            key={option.label}
            size="sm"
            variant="tertiary"
            // An agent can write a long label: the pill grows to more lines, not past the screen.
            className="h-auto min-h-10 max-w-full rounded-full py-2"
            isDisabled={disabled}
            accessibilityLabel={option.label}
            accessibilityHint={option.description}
            onPress={() => {
              void haptics.selection();
              answer([option.label]);
            }}
          >
            <Button.Label className="shrink text-center font-sans font-semibold">{option.label}</Button.Label>
          </Button>
        ))}
        {question.isSecret ? null : (
          // The composer answers only after this choice, so a message typed meanwhile still goes
          // to the chat, which matters in a channel where others talk too.
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
