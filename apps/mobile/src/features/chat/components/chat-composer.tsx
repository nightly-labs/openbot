import { MenuView } from "@expo/ui/community/menu";
import { GlassView } from "expo-glass-effect";
import { Image } from "expo-image";
import { useIsFocused } from "expo-router";
import { Button, Spinner, Typography } from "heroui-native";
import { ArrowUp, FileText, Plus, Reply, Square, X } from "lucide-react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
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
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import type { ChatBubbleMessage } from "@/features/chat/context/message-actions-context";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { editMentionDraft, insertMention, mentionDraft, mentionQuery } from "../model/chat-mentions";
import { largePastedText } from "../model/composer-paste";
import { createComposerSendGate } from "../model/composer-send";
import type { ChatAttachments } from "./use-chat-attachments";

// The field grows to this many lines, then keeps its height and scrolls.
const MAX_INPUT_LINES = 5;

interface ChatComposerProps {
  sendLabel?: string;
  action: ViewStyle["backgroundColor"];
  actionForeground: ViewStyle["backgroundColor"];
  agentName: string;
  mentionAgents: MobileAgent[];
  bottomInset: number;
  disabled: boolean;
  draft: string;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  liquidGlassAvailable: boolean;
  muted: ViewStyle["backgroundColor"];
  raised: ViewStyle["backgroundColor"];
  onChangeDraft: (value: string) => void;
  onSend: (text: string) => void;
  /** Present only while a turn is running and the surface can stop it. */
  onStop?: () => void;
  stopping?: boolean;
  attachments: ChatAttachments;
  sending: boolean;
  sendRetryVersion: number;
  replyTarget: ChatBubbleMessage | null;
  replyFocusVersion: number;
  onCancelReply: () => void;
}

export function ChatComposer({
  sendLabel = "Send message",
  action,
  actionForeground,
  agentName,
  mentionAgents,
  bottomInset,
  disabled,
  draft,
  fallbackBackground,
  foreground,
  liquidGlassAvailable,
  muted,
  raised,
  onChangeDraft,
  onSend,
  onStop,
  stopping = false,
  attachments,
  sending,
  sendRetryVersion,
  replyTarget,
  replyFocusVersion,
  onCancelReply,
}: ChatComposerProps) {
  const display = mentionDraft(draft);
  const displayText = display.text;
  const [cursor, setCursor] = useState(0);
  const query = mentionQuery(draft, cursor);
  const suggestions = query
    ? mentionAgents
        .filter((agent) =>
          `${agent.name} ${agent.title} ${agent.description}`.toLocaleLowerCase().includes(query.query.trim()),
        )
        .slice(0, 8)
    : [];
  const hasDraft = Boolean(draft.trim()) || attachments.items.length > 0;
  const inputRef = useRef<TextInput>(null);
  const attachmentButton = useRef<View>(null);
  const isFocused = useIsFocused();
  const focusedReplyVersion = useRef(0);
  useEffect(() => {
    if (isFocused && !disabled && replyTarget && focusedReplyVersion.current !== replyFocusVersion) {
      focusedReplyVersion.current = replyFocusVersion;
      inputRef.current?.focus();
    }
  }, [isFocused, disabled, replyTarget, replyFocusVersion]);
  const pendingCursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCursor.current === null) return;
    const position = Math.min(pendingCursor.current, displayText.length);
    pendingCursor.current = null;
    inputRef.current?.setNativeProps({ selection: { start: position, end: position } });
  }, [displayText]);
  const { fontScale } = useWindowDimensions();
  const minInputHeight = Math.max(48, 22 * fontScale + 26);
  const maxInputHeight = 22 * fontScale * MAX_INPUT_LINES + 26;
  const [inputLines, setInputLines] = useState(1);
  const inputHeight = !draft
    ? minInputHeight
    : Math.min(maxInputHeight, Math.max(minInputHeight, inputLines * 22 * fontScale + 26));
  const [focused, setFocused] = useState(false);
  const latestTextRef = useRef(draft);
  const [sendGate] = useState(createComposerSendGate);

  useLayoutEffect(() => {
    // Selecting a file is a draft edit even when TextInput never receives focus.
    if (attachments.items.length > 0) sendGate.edit();
  }, [attachments.items, sendGate]);

  useLayoutEffect(() => {
    if (sendRetryVersion > 0) sendGate.allowRetry();
  }, [sendGate, sendRetryVersion]);

  useEffect(() => {
    latestTextRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (disabled) {
      sendGate.cancel();
      inputRef.current?.blur();
    }
  }, [disabled, sendGate]);

  const suggestionsVisible = Boolean(focused && query && suggestions.length > 0 && !disabled);
  const announcedSuggestions = useRef("");
  useEffect(() => {
    // The list opens and closes under the keyboard with no focus change, so a
    // screen reader gets no event. Announce the count, once per distinct query.
    const announcement = suggestionsVisible ? `${suggestions.length}:${query?.query ?? ""}` : "";
    if (announcedSuggestions.current === announcement) return;
    announcedSuggestions.current = announcement;
    if (!suggestionsVisible) return;
    AccessibilityInfo.announceForAccessibility(
      suggestions.length === 1 ? "1 teammate suggestion" : `${suggestions.length} teammate suggestions`,
    );
  }, [suggestionsVisible, suggestions.length, query?.query]);

  // The draft clears the moment a send starts, so the control must not read
  // its appearance from the draft alone: it would flip to an empty state
  // under the user's own press.
  const busy = sending || attachments.preparing;
  // A draft still sends while the agent works: the host queues it. So stop only
  // takes the control when there is nothing to send.
  const stopMode = Boolean(onStop) && !hasDraft && !busy;
  const primed = hasDraft || busy || stopMode;
  const canPressSend = !disabled && !busy && hasDraft;
  const stopPending = stopMode && stopping;
  const pressable = stopMode ? !disabled && !stopPending : canPressSend;

  function requestSend(): void {
    if (disabled || sending || attachments.preparing) return;
    const action = sendGate.request();
    if (action === "blur") inputRef.current?.blur();
    else if (action === "send") onSend(latestTextRef.current);
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
      {liquidGlassAvailable ? (
        <SheetScrollEdgeEffect
          edge="bottom"
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            // Keep the original 32 pt fade above the input, independent of the reply preview.
            height: inputHeight + 8 + Math.max(bottomInset, 10) + 32,
          }}
        />
      ) : null}
      {replyTarget ? (
        <View className="flex-row items-center gap-2 pl-6 pr-4">
          <Reply color={String(muted)} size={18} />
          <Typography.Paragraph numberOfLines={1} type="body-sm" className="flex-1 text-text-secondary">
            {mentionDraft(replyTarget.body).text || "Attachment"}
          </Typography.Paragraph>
          <Button isIconOnly variant="ghost" accessibilityLabel="Cancel reply" onPress={onCancelReply}>
            <X color={String(muted)} size={18} />
          </Button>
        </View>
      ) : null}
      {suggestionsVisible && query ? (
        <GlassView
          glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
          style={{
            marginLeft: 72,
            marginRight: 16,
            flexGrow: 0,
            maxHeight: 240,
            borderRadius: 24,
            borderCurve: "continuous",
            overflow: "hidden",
            backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
          }}
        >
          <ScrollView keyboardShouldPersistTaps="always" style={{ flexGrow: 0 }}>
            {suggestions.map((agent) => (
              <Button
                key={agent.id}
                variant="ghost"
                className="min-h-12 flex-row justify-start gap-3 rounded-none px-4"
                accessibilityLabel={`Mention ${agent.name}`}
                onPress={() => {
                  const next = insertMention(latestTextRef.current, query, agent);
                  latestTextRef.current = next;
                  onChangeDraft(next);
                  const position = query.start + agent.name.length + 2;
                  setCursor(position);
                  pendingCursor.current = position;
                  inputRef.current?.focus();
                }}
              >
                <BloubAvatar
                  agentId={agent.id}
                  serverId={agent.serverId}
                  hue={agent.avatarHue}
                  seed={agent.avatarSeed}
                  size={28}
                />
                <Typography.Paragraph numberOfLines={1} className="flex-1">
                  {agent.name}
                </Typography.Paragraph>
              </Button>
            ))}
          </ScrollView>
        </GlassView>
      ) : null}
      {!sending && attachments.items.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        >
          {attachments.items.map((item) => (
            <View key={item.id} className="size-28 overflow-hidden rounded-2xl bg-control p-3">
              {item.mimeType.startsWith("image/") ? (
                <Image
                  source={item.uri ?? `data:${item.mimeType};base64,${item.base64}`}
                  contentFit="contain"
                  accessibilityLabel={item.name}
                  style={{ position: "absolute", inset: 0 }}
                />
              ) : (
                <FileText color={String(foreground)} size={24} />
              )}
              {!item.mimeType.startsWith("image/") ? (
                <Typography.Paragraph numberOfLines={2} type="body-xs" className="mt-auto">
                  {item.name}
                </Typography.Paragraph>
              ) : null}
              <Button
                isIconOnly
                size="sm"
                variant="secondary"
                className="absolute right-0 top-0"
                isDisabled={sending}
                accessibilityLabel={`Remove ${item.name}`}
                onPress={() => attachments.remove(item.id)}
              >
                <X color={String(foreground)} size={16} />
              </Button>
            </View>
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
        <View
          ref={attachmentButton}
          collapsable={false}
          pointerEvents={disabled || sending || attachments.preparing ? "none" : "auto"}
        >
          <MenuView
            style={{ width: 48, height: 48 }}
            actions={[
              { id: "camera", title: "Camera", image: "camera" },
              { id: "photos", title: "Photos", image: "photo" },
              {
                id: "files",
                title: "Files",
                image: "paperclip",
                attributes: { disabled: disabled || sending || attachments.preparing },
              },
            ]}
            onPressAction={({ nativeEvent }) => {
              if (disabled || sending || attachments.preparing) return;
              if (nativeEvent.event === "files") void attachments.chooseFiles();
              if (nativeEvent.event === "photos") void attachments.choosePhotos();
              if (nativeEvent.event === "camera") {
                if (!attachmentButton.current) {
                  void attachments.takePhoto();
                  return;
                }
                attachmentButton.current.measureInWindow((x, y, width, height) => {
                  void attachments.takePhoto(width > 0 && height > 0 ? { x, y, width, height } : undefined);
                });
              }
            }}
          >
            <GlassView
              accessible
              accessibilityRole="button"
              accessibilityLabel="Add attachment"
              accessibilityState={{ disabled: disabled || sending || attachments.preparing }}
              glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
              isInteractive={liquidGlassAvailable && !disabled && !sending}
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                borderCurve: "continuous",
                overflow: "hidden",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
                opacity: disabled || sending || attachments.preparing ? 0.45 : 1,
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
                {`${displayText}\u200b`}
              </NativeText>
              <TextInput
                ref={inputRef}
                nativeID="chat-composer-input"
                accessibilityLabel={`Message ${agentName}`}
                accessibilityState={{ disabled }}
                editable={!disabled}
                showSoftInputOnFocus={!disabled}
                className="min-w-0 flex-1 font-sans text-foreground"
                placeholder={`Ask ${agentName}`}
                autoCorrect
                autoCapitalize="sentences"
                placeholderTextColor={muted}
                multiline
                scrollEnabled={inputLines > MAX_INPUT_LINES}
                returnKeyType="default"
                submitBehavior="newline"
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
                onSelectionChange={({ nativeEvent }) =>
                  setCursor(nativeEvent.selection.start === nativeEvent.selection.end ? nativeEvent.selection.end : -1)
                }
                onFocus={() => {
                  sendGate.focus();
                  setFocused(true);
                }}
                onBlur={() => setFocused(false)}
                onChangeText={(text) => {
                  sendGate.edit();
                  const pasted = !sending ? largePastedText(latestTextRef.current, text) : null;
                  if (pasted) {
                    // Keep the pasted text until its attachment is durable. A failed write must not lose it.
                    latestTextRef.current = text;
                    onChangeDraft(text);
                    void Promise.resolve()
                      .then(() => attachments.paste({ type: "text", text: pasted.text }, () => {}))
                      .then(() => {
                        if (latestTextRef.current !== text) return;
                        latestTextRef.current = pasted.draft;
                        onChangeDraft(pasted.draft);
                      })
                      .catch((error) => {
                        Alert.alert(
                          "Could not attach pasted text",
                          error instanceof Error ? error.message : "Try again.",
                        );
                      });
                    return;
                  }
                  const next = editMentionDraft(latestTextRef.current, text);
                  latestTextRef.current = next;
                  onChangeDraft(next);
                }}
                onSubmitEditing={({ nativeEvent }) => {
                  if (!disabled && !sending && sendGate.submit())
                    onSend(editMentionDraft(latestTextRef.current, nativeEvent.text));
                }}
                onEndEditing={({ nativeEvent: { text } }) => {
                  // Native editing can end before the send button's release event,
                  // while TextInput.isFocused() is still waiting for onBlur.
                  latestTextRef.current = editMentionDraft(latestTextRef.current, text);
                  if (sendGate.commit() && !disabled && !sending) onSend(latestTextRef.current);
                }}
              >
                {/* TextInput requires native text children for editable attributed text. */}
                <NativeText>
                  {display.mentions.map((mention, index) => (
                    <NativeText key={mention.start}>
                      {displayText.slice(index ? display.mentions[index - 1].end : 0, mention.start)}
                      <NativeText style={{ color: action }}>{displayText.slice(mention.start, mention.end)}</NativeText>
                    </NativeText>
                  ))}
                  {displayText.slice(display.mentions.at(-1)?.end ?? 0)}
                </NativeText>
              </TextInput>
            </View>
            <Pressable
              accessibilityLabel={stopMode ? `Stop ${agentName}` : sendLabel}
              accessibilityRole="button"
              accessibilityState={{ disabled: !pressable, busy: busy || stopPending }}
              disabled={!pressable}
              className="mb-1 size-10 items-center justify-center rounded-full"
              style={{
                backgroundColor: primed ? action : raised,
                // The parent dims the whole field when the composer is disabled.
                // Dim only this control for a state the field does not show.
                opacity: disabled || pressable ? 1 : 0.45,
              }}
              onPress={stopMode ? onStop : requestSend}
            >
              {busy || stopPending ? (
                <Spinner size="sm" color={String(actionForeground)} />
              ) : stopMode ? (
                <Square color={String(actionForeground)} fill={String(actionForeground)} size={14} strokeWidth={2} />
              ) : (
                <ArrowUp color={String(primed ? actionForeground : muted)} size={21} strokeWidth={2.2} />
              )}
            </Pressable>
          </GlassView>
        </GestureDetector>
      </View>
    </View>
  );
}
