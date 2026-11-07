import type { ConversationQuestionPrompt } from "@openbot/contracts/ipc";
import { type ConversationUiBlock, UI_CHOICE_QUESTION_ID } from "@openbot/contracts/ui-blocks";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import MessageSquareText from "lucide-react-native/icons/message-square-text";
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
  const [muted, accentForeground] = useThemeColor(["muted", "accent-foreground"]);
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

  return (
    <View
      className="w-full max-w-[92%] self-start gap-1 rounded-[20px] bg-control/60 px-4 py-3"
      style={{ borderCurve: "circular" }}
      accessibilityLabel={t("mobile.chat.question.form")}
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
      <View>
        {question.options?.map((option, optionIndex) => (
          <Button
            key={option.label}
            variant="ghost"
            isDisabled={disabled}
            accessibilityLabel={option.label}
            className="h-auto min-h-12 justify-start rounded-[18px] px-2 py-2"
            onPress={() => {
              void haptics.selection();
              answer([option.label]);
            }}
          >
            <View
              className="w-10 self-stretch items-center justify-center rounded-xl bg-control"
              style={{ borderCurve: "continuous" }}
            >
              <Typography type="body-sm" weight="medium" className="text-text-secondary">
                {String.fromCharCode(65 + optionIndex)}
              </Typography>
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
              <Typography type="body-sm" weight="medium">
                {option.label}
              </Typography>
              {option.description ? (
                <Typography type="body-xs" className="text-text-secondary">
                  {option.description}
                </Typography>
              ) : null}
            </View>
          </Button>
        ))}
        {question.isSecret ? null : (
          // One more answer row, so it reads as a choice like the options above. The composer
          // answers only after this choice, so a message typed meanwhile still goes to the chat,
          // which matters in a channel where others talk too.
          <Button
            variant="ghost"
            isDisabled={disabled}
            accessibilityLabel={t("mobile.chat.question.replyInChat")}
            accessibilityState={{ selected: replyInChat, disabled }}
            className={`h-auto min-h-12 justify-start rounded-[18px] px-2 py-2 ${replyInChat ? "bg-control/60" : ""}`}
            onPress={() => setReplyInChat(!replyInChat)}
          >
            <View
              className={`w-10 self-stretch items-center justify-center rounded-xl ${replyInChat ? "bg-accent" : "bg-control"}`}
              style={{ borderCurve: "continuous" }}
            >
              <MessageSquareText color={String(replyInChat ? accentForeground : muted)} size={18} />
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
              <Typography type="body-sm" weight="medium">
                {t("mobile.chat.question.replyInChat")}
              </Typography>
              <Typography type="body-xs" className="text-text-secondary">
                {replyInChat ? t("mobile.chat.question.replyInChatActive") : t("mobile.chat.question.replyInChatHint")}
              </Typography>
            </View>
          </Button>
        )}
      </View>
      <View className="flex-row items-center justify-between gap-2">
        {question.isSecret ? (
          // The private answer is typed in the masked field that takes the composer's place.
          <Typography type="body-xs" className="flex-1 text-text-secondary">
            {t("mobile.chat.question.secretBelow")}
          </Typography>
        ) : (
          <View className="flex-1" />
        )}
        <Button
          variant="ghost"
          size="sm"
          isDisabled={disabled}
          onPress={() => {
            void haptics.selection();
            answer([]);
          }}
        >
          <Typography type="body-xs" className="text-text-secondary">
            {t("mobile.chat.question.skip")}
          </Typography>
        </Button>
      </View>
      <PromptStatus controller={controller} canSend={canSend} />
    </View>
  );
}
