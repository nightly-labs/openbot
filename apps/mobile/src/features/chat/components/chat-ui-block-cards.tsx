import type { AgentPromptResolution, ConversationQuestionPrompt } from "@openbot/contracts/ipc";
import {
  type ConversationUiBlock,
  UI_BLOCK_LIMITS,
  UI_BLOCK_SUBMIT_ACTION_ID,
  UI_CHOICE_QUESTION_ID,
  UI_CHOICE_VALUES_KEY,
  UI_CONFIRM_ACTION_QUESTION_ID,
  UI_CONFIRM_EDIT_ACTION_ID,
  type UiAction,
  type UiActionStyle,
  type UiBlockResponse,
  type UiChoiceBlock,
  type UiConfirmBlock,
  type UiConfirmField,
  uiBlockAnswersFromResponse,
  uiConfirmAnswersWithPreview,
  uiConfirmPreviewEditable,
} from "@openbot/contracts/ui-blocks";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import X from "lucide-react-native/icons/x";
import { type ReactNode, useEffect, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useChatCardSurface } from "@/features/chat/components/chat-bubble-fill";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import type { QuestionPromptController } from "@/features/chat/components/use-question-prompt";
import { storeCodePreview } from "@/features/chat/model/code-preview-store";
import { promptAnswerLabel } from "@/features/chat/model/question-prompt";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useSecondsUntil } from "@/shared/lib/countdown";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const DEFAULT_HOLD_MS = 800;
const PREVIEW_MAX_HEIGHT = 240;

const BUTTON_VARIANT = {
  primary: "primary",
  secondary: "tertiary",
  ghost: "ghost",
  danger: "danger",
} as const satisfies Record<UiActionStyle, "primary" | "tertiary" | "ghost" | "danger">;

function countdownClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

function actionStyle(action: UiAction): UiActionStyle {
  return action.style ?? "secondary";
}

export function confirmBlockOf(prompt: ConversationQuestionPrompt, uiBlock: ConversationUiBlock | undefined) {
  const spec = uiBlock?.spec;
  return spec?.type === "confirm" && prompt.questions[0]?.id === UI_CONFIRM_ACTION_QUESTION_ID ? spec : null;
}

export function formTitleOf(uiBlock: ConversationUiBlock | undefined, question: string | undefined): string | null {
  const spec = uiBlock?.spec;
  if (spec?.type !== "form") return null;
  const title = spec.title.trim();
  return title && title !== question?.trim() ? title : null;
}

export function choiceBlockOf(prompt: ConversationQuestionPrompt, uiBlock: ConversationUiBlock | undefined) {
  const spec = uiBlock?.spec;
  const question = prompt.questions[0];
  if (spec?.type !== "choice" || question?.id !== UI_CHOICE_QUESTION_ID) return null;
  return spec.multiple || !question.options?.length ? spec : null;
}

export function QuestionText({ question, variant }: { question: string; variant: "title" | "body" | "secondary" }) {
  const secondaryColor = useCSSVariable("--openbot-text-secondary");
  return (
    <ChatMarkdown
      body={question}
      color={variant === "secondary" ? String(secondaryColor) : undefined}
      compact={variant === "secondary"}
      fontWeight={variant === "title" ? "500" : undefined}
      inline
      finished
      selectable={false}
    />
  );
}

export function QuestionDetail({ detail }: { detail: string }) {
  const secondaryColor = useCSSVariable("--openbot-text-secondary");
  return <ChatMarkdown body={detail} color={String(secondaryColor)} compact finished />;
}

export function PromptStatus({ controller, canSend }: { controller: QuestionPromptController; canSend: boolean }) {
  const { t } = useText();
  const { pending, failedAnswers, disabled, submit } = controller;
  return (
    <>
      {pending ? (
        <Typography type="body-xs" accessibilityLiveRegion="polite">
          {t("mobile.chat.question.sending")}
        </Typography>
      ) : null}
      {!canSend ? (
        <Typography type="body-xs" className="text-text-secondary">
          {t("mobile.chat.question.reconnect")}
        </Typography>
      ) : null}
      {failedAnswers ? (
        <View className="flex-row items-center gap-2">
          <Typography type="body-xs" className="flex-1" accessibilityRole="alert">
            {t("mobile.chat.question.sendFailed")}
          </Typography>
          <Button variant="ghost" size="sm" isDisabled={disabled} onPress={() => void submit(failedAnswers)}>
            <Button.Label>{t("common.retry")}</Button.Label>
          </Button>
        </View>
      ) : null}
    </>
  );
}

const PREVIEW_CLIP = { maxHeight: PREVIEW_MAX_HEIGHT };
const MAX_KNOWN_CUT_OFF = 100;
const knownCutOff = new Map<string, boolean>();

function ConfirmPreview({ markdown, title }: { markdown: string; title: string }) {
  const { t } = useText();
  const [cutOff, setCutOff] = useState(() => knownCutOff.get(markdown) ?? false);
  return (
    <View className="gap-1">
      <View className="overflow-hidden" style={PREVIEW_CLIP} accessibilityLabel={t("mobile.chat.question.preview")}>
        <View
          onLayout={(event) => {
            const cut = event.nativeEvent.layout.height > PREVIEW_MAX_HEIGHT;
            if (knownCutOff.size >= MAX_KNOWN_CUT_OFF) knownCutOff.clear();
            knownCutOff.set(markdown, cut);
            setCutOff(cut);
          }}
        >
          <ChatMarkdown
            body={markdown}
            color={undefined}
            compact
            finished
            animationEnabled={false}
            linkFavicons={false}
          />
        </View>
      </View>
      {cutOff ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start px-0"
          onPress={() => {
            const previewId = storeCodePreview({ kind: "markdown", source: markdown, title });
            router.push({ pathname: "/code-preview/[previewId]", params: { previewId } });
          }}
        >
          <Button.Label>{t("mobile.chat.question.showAllPreview")}</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}

function FieldRow({ index, label, children }: { index: number; label: string; children: ReactNode }) {
  return (
    <View className="flex-row gap-3">
      <View
        className="h-6 w-6 items-center justify-center rounded-full bg-control"
        style={{ borderCurve: "continuous" }}
      >
        <Typography type="body-xs" weight="medium" className="text-text-secondary">
          {String(index + 1)}
        </Typography>
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Typography type="body-xs" weight="medium" className="text-text-secondary">
          {label}
        </Typography>
        {children}
      </View>
    </View>
  );
}

export function ConfirmBody({
  spec,
  compact = false,
  selectValue,
  onSelect,
  disabled = false,
  closed = false,
  previewEditor,
}: {
  spec: UiConfirmBlock;
  compact?: boolean;
  previewEditor?: ReactNode;
  closed?: boolean;
  selectValue: (field: Extract<UiConfirmField, { select: string }>) => string;
  onSelect?: (select: string, option: string) => void;
  disabled?: boolean;
}) {
  return (
    <View className="gap-3">
      <Typography weight="medium" className={spec.danger && !closed ? "text-danger-text" : undefined}>
        {spec.title}
      </Typography>
      {(spec.fields?.length ?? 0) > 0 ? (
        <View className="gap-2.5">
          {spec.fields?.map((field, index) =>
            "select" in field ? (
              <FieldRow key={`select\n${field.select}`} index={index} label={field.label}>
                {onSelect && !compact ? (
                  <View className="flex-row flex-wrap gap-1.5 pt-0.5">
                    {field.options.map((option) => (
                      <Button
                        key={option}
                        size="sm"
                        variant={selectValue(field) === option ? "primary" : "tertiary"}
                        className="rounded-full"
                        isDisabled={disabled}
                        accessibilityState={{ selected: selectValue(field) === option }}
                        onPress={() => {
                          void haptics.selection();
                          onSelect(field.select, option);
                        }}
                      >
                        <Button.Label>{option}</Button.Label>
                      </Button>
                    ))}
                  </View>
                ) : (
                  <Typography type="body-sm" numberOfLines={compact ? 2 : undefined}>
                    {selectValue(field)}
                  </Typography>
                )}
              </FieldRow>
            ) : (
              <FieldRow key={`${field.label}\n${field.value}`} index={index} label={field.label}>
                <Typography type="body-sm" numberOfLines={compact ? 2 : undefined}>
                  {field.value}
                </Typography>
              </FieldRow>
            ),
          )}
        </View>
      ) : null}
      {previewEditor ??
        (spec.preview && !compact ? <ConfirmPreview markdown={spec.preview} title={spec.title} /> : null)}
    </View>
  );
}

export function answeredSelect(
  prompt: ConversationQuestionPrompt,
  resolution: AgentPromptResolution | null,
  t: ReturnType<typeof useText>["t"],
) {
  return (field: Extract<UiConfirmField, { select: string }>) => {
    const question = prompt.questions.find((item) => item.id === field.select);
    if (resolution?.status === "answered" && question) return promptAnswerLabel(question, resolution, t);
    return resolution ? field.options.join(", ") : (field.options[0] ?? "");
  };
}

function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

export function ChatConfirmPrompt({
  spec,
  uiBlock,
  controller,
  canSend,
  canEditPreview = false,
}: {
  spec: UiConfirmBlock;
  uiBlock: ConversationUiBlock | undefined;
  controller: QuestionPromptController;
  canSend: boolean;
  canEditPreview?: boolean;
}) {
  const { t } = useText();
  const card = useChatCardSurface();
  const muted = useThemeColor("muted");
  const { disabled, submit } = controller;
  const autoAnswer = uiBlock?.state.autoAnswer?.done ? undefined : uiBlock?.state.autoAnswer;
  const secondsLeft = useSecondsUntil(autoAnswer?.at ? Date.parse(autoAnswer.at) : 0);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<UiAction>();
  const [draft, setPreviewDraft] = useState<string>();
  const setDraft = (text: string) => {
    setPreviewDraft(text);
    controller.setUnsentPreview(text.trim() && text !== spec.preview ? text : undefined);
  };
  const blankDraft = draft !== undefined && !draft.trim();
  const opensEditor = (action: UiAction) =>
    canEditPreview && uiConfirmPreviewEditable(spec) && action.id === UI_CONFIRM_EDIT_ACTION_ID;
  const screenReader = useScreenReaderEnabled();
  const holdMs = spec.confirmHold ?? DEFAULT_HOLD_MS;
  const holdsPrimary = spec.danger === true || spec.confirmHold !== undefined;
  const isHeld = (action: UiAction) =>
    action.confirm === true || actionStyle(action) === "danger" || (holdsPrimary && actionStyle(action) === "primary");
  const selectValue = (field: Extract<UiConfirmField, { select: string }>) =>
    selected[field.select] ?? field.options[0] ?? "";

  function respond(action: UiAction): void {
    if (disabled || blankDraft) return;
    setConfirming(undefined);
    if (opensEditor(action)) {
      setPreviewDraft(spec.preview);
      return;
    }
    const values: Record<string, string> = {};
    for (const field of spec.fields ?? []) if ("select" in field) values[field.select] = selectValue(field);
    const response: UiBlockResponse = Object.keys(values).length
      ? { actionId: action.id, values }
      : { actionId: action.id };
    void submit(uiConfirmAnswersWithPreview(spec, response, draft));
  }

  return (
    <View className="w-full gap-2.5" accessibilityLabel={t("mobile.chat.question.form")}>
      <View
        className={`w-full max-w-[92%] flex-row items-start gap-2 self-start rounded-[20px] ${card.fillClass} px-4 py-3`}
        style={card.style}
      >
        <View className="min-w-0 flex-1 pt-1">
          <ConfirmBody
            spec={spec}
            selectValue={selectValue}
            disabled={disabled}
            onSelect={(select, option) => setSelected((current) => ({ ...current, [select]: option }))}
            previewEditor={
              draft === undefined ? undefined : (
                <SheetFormField
                  label={t("mobile.chat.question.preview")}
                  hideLabel
                  multiline
                  tall
                  autoFocus
                  editable={!disabled}
                  maxLength={UI_BLOCK_LIMITS.preview}
                  value={draft}
                  onChangeText={setDraft}
                />
              )
            }
          />
        </View>
        {autoAnswer ? null : (
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
        )}
      </View>
      {confirming ? (
        <View className="gap-2">
          <Typography type="body-sm" weight="medium">
            {t("mobile.chat.question.confirmAction", { action: confirming.label })}
          </Typography>
          <View className="flex-row flex-wrap gap-2">
            <Button
              size="sm"
              variant={BUTTON_VARIANT[actionStyle(confirming)]}
              className="rounded-full"
              isDisabled={disabled || blankDraft}
              onPress={() => {
                void haptics.selection();
                respond(confirming);
              }}
            >
              <Button.Label className="font-sans font-semibold">{t("mobile.chat.question.confirmAccept")}</Button.Label>
            </Button>
            <Button size="sm" variant="ghost" className="rounded-full" onPress={() => setConfirming(undefined)}>
              <Button.Label>{t("common.cancel")}</Button.Label>
            </Button>
          </View>
        </View>
      ) : (
        <>
          <View className="flex-row flex-wrap gap-2">
            {spec.actions.map((action) => {
              if (draft !== undefined && opensEditor(action)) return null;
              const held = isHeld(action);
              return (
                <Button
                  key={action.id}
                  size="sm"
                  variant={BUTTON_VARIANT[actionStyle(action)]}
                  className="rounded-full"
                  isDisabled={disabled || blankDraft}
                  accessibilityHint={held && !screenReader ? t("mobile.chat.question.holdHint") : undefined}
                  delayLongPress={held ? holdMs : undefined}
                  onLongPress={
                    held
                      ? () => {
                          void haptics.notification("success");
                          respond(action);
                        }
                      : undefined
                  }
                  onPress={() => {
                    if (held && !screenReader) return void haptics.notification("warning");
                    void haptics.selection();
                    if (held || action.confirm === true) setConfirming(action);
                    else respond(action);
                  }}
                >
                  <Button.Label className="font-sans font-semibold">
                    {autoAnswer?.actionId !== action.id || secondsLeft <= 0
                      ? action.label
                      : secondsLeft < 60
                        ? t("mobile.chat.question.autoAction", { action: action.label, seconds: secondsLeft })
                        : t("mobile.chat.question.autoActionClock", {
                            action: action.label,
                            time: countdownClock(secondsLeft),
                          })}
                  </Button.Label>
                </Button>
              );
            })}
          </View>
          {spec.actions.some(isHeld) && !screenReader ? (
            <Typography type="body-xs" className="text-text-secondary">
              {t("mobile.chat.question.holdHint")}
            </Typography>
          ) : null}
        </>
      )}
      <PromptStatus controller={controller} canSend={canSend} />
    </View>
  );
}

export function ChatChoicePrompt({
  spec,
  controller,
  canSend,
}: {
  spec: UiChoiceBlock;
  controller: QuestionPromptController;
  canSend: boolean;
}) {
  const { t } = useText();
  const card = useChatCardSurface();
  const [muted, accent] = useThemeColor(["muted", "accent"]);
  const { disabled, submit } = controller;
  const [picked, setPicked] = useState<string[]>(() =>
    spec.options.filter((option) => option.selected).map((option) => option.id),
  );

  function toggle(id: string): void {
    void haptics.selection();
    setPicked((current) =>
      spec.multiple ? (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) : [id],
    );
  }

  return (
    <View
      className={`w-full max-w-[92%] self-start gap-1 rounded-[20px] ${card.fillClass} px-4 py-3`}
      style={card.style}
      accessibilityLabel={t("mobile.chat.question.form")}
    >
      <View className="flex-row items-center gap-2">
        <View className="min-w-0 flex-1">
          <QuestionText question={spec.title} variant="title" />
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
      <View>
        {spec.options.map((option) => {
          const checked = picked.includes(option.id);
          return (
            <Button
              key={option.id}
              variant="ghost"
              isDisabled={disabled}
              accessibilityRole={spec.multiple ? "checkbox" : "radio"}
              accessibilityState={{ checked }}
              accessibilityLabel={option.label}
              className="h-auto min-h-12 justify-start rounded-[18px] px-2 py-2"
              onPress={() => toggle(option.id)}
            >
              <View
                className={`h-6 w-6 items-center justify-center ${spec.multiple ? "rounded-md" : "rounded-full"} ${checked ? "bg-accent/15" : "bg-control"}`}
                style={{ borderCurve: "continuous" }}
              >
                {checked ? <Check color={String(accent)} size={16} /> : null}
              </View>
              <View className="min-w-0 flex-1 flex-row items-center gap-2">
                <Typography type="body-sm" weight="medium" className="min-w-0 flex-1">
                  {option.label}
                </Typography>
                {option.meta ? (
                  <Typography type="body-xs" className="text-text-secondary">
                    {option.meta}
                  </Typography>
                ) : null}
              </View>
            </Button>
          );
        })}
      </View>
      <View className="flex-row items-center gap-2">
        <Typography type="body-xs" className="flex-1 text-text-secondary">
          {picked.length === 0
            ? t("mobile.chat.question.noneSelected")
            : spec.multiple
              ? t("mobile.chat.question.selectedCount", { count: picked.length })
              : ""}
        </Typography>
        <Button
          size="sm"
          className="rounded-full"
          isDisabled={disabled || picked.length === 0}
          onPress={() => {
            void haptics.selection();
            const ids = spec.options.filter((option) => picked.includes(option.id)).map((option) => option.id);
            void submit(
              uiBlockAnswersFromResponse(spec, {
                actionId: UI_BLOCK_SUBMIT_ACTION_ID,
                values: { [UI_CHOICE_VALUES_KEY]: ids },
              }),
            );
          }}
        >
          <Button.Label>{spec.submit ?? t("mobile.chat.question.sendChoice")}</Button.Label>
        </Button>
      </View>
      <PromptStatus controller={controller} canSend={canSend} />
    </View>
  );
}
