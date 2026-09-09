import { MenuView } from "@expo/ui/community/menu";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentPromptQuestion } from "@openbot/contracts/ipc";
import { GlassView } from "expo-glass-effect";
import { Button, Typography } from "heroui-native";
import { ArrowUp, Mic, Plus } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Text as NativeText,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { largePastedText } from "../model/composer-paste";
import type { ChatAttachments } from "./use-chat-attachments";

interface ChatComposerProps {
  action: ViewStyle["backgroundColor"];
  actionForeground: ViewStyle["backgroundColor"];
  agentName: string;
  bottomInset: number;
  disabled: boolean;
  draft: string;
  answerQuestion?: AgentPromptQuestion;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  liquidGlassAvailable: boolean;
  muted: ViewStyle["backgroundColor"];
  raised: ViewStyle["backgroundColor"];
  onChangeDraft: (value: string) => void;
  onSend: (text: string) => void;
  attachments: ChatAttachments;
  sending: boolean;
}

export function ChatComposer({
  action,
  actionForeground,
  agentName,
  bottomInset,
  disabled,
  draft,
  answerQuestion,
  fallbackBackground,
  foreground,
  liquidGlassAvailable,
  muted,
  raised,
  onChangeDraft,
  onSend,
  attachments,
  sending,
}: ChatComposerProps) {
  const hasDraft = Boolean(draft.trim()) || attachments.items.length > 0;
  const inputRef = useRef<TextInput>(null);
  const { fontScale } = useWindowDimensions();
  const minInputHeight = Math.max(48, 22 * fontScale + 26);
  const maxInputHeight = 22 * fontScale * 5 + 26;
  const [inputLines, setInputLines] = useState(1);
  const inputHeight =
    !draft || answerQuestion?.isSecret
      ? minInputHeight
      : Math.min(maxInputHeight, Math.max(minInputHeight, inputLines * 22 * fontScale + 26));
  const [focused, setFocused] = useState(false);
  const latestTextRef = useRef(draft);

  useEffect(() => {
    latestTextRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (disabled) {
      inputRef.current?.blur();
    }
  }, [disabled]);

  function requestSend(): void {
    if (!disabled && !sending) onSend(latestTextRef.current);
  }

  const focusInput = useCallback(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && !focused)
        .activeOffsetY(-16)
        .failOffsetY(16)
        .failOffsetX([-24, 24])
        .onEnd((event) => {
          if (event.translationY < -24 || event.velocityY < -250) scheduleOnRN(focusInput);
        }),
    [disabled, focused, focusInput],
  );

  return (
    <View>
      {attachments.items.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        >
          {attachments.items.map((item) => (
            <Button
              key={item.id}
              variant="secondary"
              isDisabled={sending}
              accessibilityLabel={`Remove ${item.name}`}
              onPress={() => attachments.remove(item.id)}
            >
              <Typography.Paragraph type="body-xs">{item.name} ×</Typography.Paragraph>
            </Button>
          ))}
        </ScrollView>
      ) : null}
      <View
        pointerEvents="box-none"
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: Math.max(bottomInset, 10),
        }}
      >
        <View pointerEvents={disabled || sending || answerQuestion ? "none" : "auto"}>
          <MenuView
            style={{ width: 48, height: 48 }}
            actions={[
              {
                id: "files",
                title: "Files",
                image: "paperclip",
                attributes: { disabled: disabled || sending || Boolean(answerQuestion) },
              },
            ]}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === "files" && !disabled && !sending && !answerQuestion) attachments.chooseFiles();
            }}
          >
            <GlassView
              accessible
              accessibilityRole="button"
              accessibilityLabel="Add attachment"
              accessibilityState={{ disabled: disabled || sending || Boolean(answerQuestion) }}
              glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
              isInteractive={liquidGlassAvailable && !disabled && !sending && !answerQuestion}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                borderCurve: "continuous",
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
                opacity: disabled || sending || answerQuestion ? 0.45 : 1,
              }}
            >
              <Plus color={String(foreground)} size={25} strokeWidth={1.8} />
            </GlassView>
          </MenuView>
        </View>
        <GestureDetector gesture={pan}>
          <GlassView
            glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
            style={{
              alignItems: "flex-end",
              backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
              borderCurve: "continuous",
              borderRadius: 24,
              flex: 1,
              flexDirection: "row",
              height: inputHeight,
              overflow: "hidden",
              opacity: disabled ? 0.45 : 1,
              paddingLeft: 16,
              paddingRight: 5,
            }}
          >
            <View style={{ flex: 1, minWidth: 0, height: inputHeight }}>
              {/* Measure wrapping independently of UITextView's constrained contentSize. */}
              {!answerQuestion?.isSecret ? (
                <NativeText
                  accessible={false}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  pointerEvents="none"
                  className="font-sans"
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    opacity: 0,
                    fontSize: 16,
                    lineHeight: 22,
                    paddingVertical: 13,
                  }}
                  onTextLayout={(event) => setInputLines(Math.max(1, event.nativeEvent.lines.length))}
                >
                  {`${draft}\u200b`}
                </NativeText>
              ) : null}
              <TextInput
                ref={inputRef}
                nativeID="chat-composer-input"
                accessibilityLabel={answerQuestion?.question ?? `Message ${agentName}`}
                accessibilityState={{ disabled }}
                editable={!disabled}
                showSoftInputOnFocus={!disabled}
                className="min-w-0 flex-1 font-sans text-foreground"
                placeholder={
                  answerQuestion
                    ? answerQuestion.isSecret
                      ? "Enter a private answer"
                      : "Type your answer"
                    : `Ask ${agentName}`
                }
                secureTextEntry={answerQuestion?.isSecret ?? false}
                autoCorrect={!answerQuestion?.isSecret}
                autoCapitalize={answerQuestion?.isSecret ? "none" : "sentences"}
                maxLength={answerQuestion ? INPUT_LIMITS.promptAnswerText : undefined}
                placeholderTextColor={muted}
                multiline={!answerQuestion?.isSecret}
                scrollEnabled={!answerQuestion?.isSecret && inputLines > 5}
                returnKeyType={answerQuestion?.isSecret ? "send" : "default"}
                submitBehavior={answerQuestion?.isSecret ? "submit" : "newline"}
                selectionColor={foreground}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 16,
                  lineHeight: 22,
                  height: inputHeight,
                  paddingBottom: 13,
                  paddingTop: 13,
                  textAlignVertical: "top",
                }}
                value={draft}
                onFocus={() => {
                  setFocused(true);
                }}
                onBlur={() => setFocused(false)}
                onChangeText={(text) => {
                  const pasted = !answerQuestion && !sending ? largePastedText(latestTextRef.current, text) : null;
                  if (pasted) {
                    try {
                      attachments.paste({ type: "text", text: pasted.text }, () => {});
                      latestTextRef.current = pasted.draft;
                      onChangeDraft(pasted.draft);
                      return;
                    } catch (error) {
                      Alert.alert(
                        "Could not attach pasted text",
                        error instanceof Error ? error.message : "Try again.",
                      );
                    }
                  }
                  latestTextRef.current = text;
                  onChangeDraft(text);
                }}
                onSubmitEditing={({ nativeEvent }) => {
                  if (!disabled && !sending) onSend(nativeEvent.text);
                }}
                onEndEditing={({ nativeEvent: { text } }) => {
                  // Native editing can end before the send button's release event,
                  // while TextInput.isFocused() is still waiting for onBlur.
                  latestTextRef.current = text;
                }}
              />
            </View>
            <Pressable
              accessibilityLabel={hasDraft ? (answerQuestion ? "Send answer" : "Send message") : "Start voice message"}
              accessibilityRole="button"
              accessibilityState={{ disabled: disabled || sending }}
              disabled={disabled || sending}
              className="mb-1 size-10 items-center justify-center rounded-full"
              style={{ backgroundColor: hasDraft ? action : raised }}
              onPress={() =>
                hasDraft
                  ? requestSend()
                  : Alert.alert("Voice messages", "Voice input will be connected with the conversation API.")
              }
            >
              {hasDraft ? (
                <ArrowUp color={String(actionForeground)} size={21} strokeWidth={2.2} />
              ) : (
                <Mic color={String(muted)} size={21} strokeWidth={2} />
              )}
            </Pressable>
          </GlassView>
        </GestureDetector>
      </View>
    </View>
  );
}
