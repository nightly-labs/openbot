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
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import type { ChatBubbleMessage } from "@/features/chat/context/message-actions-context";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { editMentionDraft, insertMention, mentionDraft, mentionQuery } from "../model/chat-mentions";
import { largePastedText } from "../model/composer-paste";
import { createComposerSendGate } from "../model/composer-send";
import type { ChatAttachments } from "./use-chat-attachments";

// The field grows to this many lines, then keeps its height and scrolls.
const MAX_INPUT_LINES = 5;
// Width the controls take from the single row, the card's own text inset, and
// the gap between the card and the screen edge.
const ROW_CONTROL_INSET = 48;
const FIELD_INSET = 16;
const BAR_INSET = 16;
// The controls are 40 pt with a 4 pt inset, and one text line sits in the same
// box: a line plus 13 pt above and below. One formula then covers both shapes.
const TOOLBAR_HEIGHT = 48;
const FIELD_VERTICAL_PADDING = 26;
// A 112 pt tile plus its 8 pt inset. Known, so the block can open and close.
const ATTACHMENT_BLOCK_HEIGHT = 120;
// Typing is what drives this, and the user is looking straight at the line they
// just wrote. An ease-in-out spends its first half barely moving, which reads as
// the card answering late, so hold the shape open with a strong ease-out instead.
const SHAPE_DURATION = 120;
const SHAPE_EASING = cubicBezier(0.23, 1, 0.32, 1);

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
  const { fontScale, width: windowWidth } = useWindowDimensions();
  const lineHeight = 22 * fontScale;
  const rowTextWidth = windowWidth - BAR_INSET * 2 - ROW_CONTROL_INSET * 2;
  // One reading drives both the shape and the height. Measuring the two widths
  // separately gave the card two targets in two frames, so it animated twice.
  const [wrap, setWrap] = useState({ lines: 1, width: 0 });
  // The bar stays a single row while the text fits beside the controls, then
  // becomes a card with the field on its own line.
  const stacked = wrap.lines > 1 || wrap.width > rowTextWidth;
  const fieldHeight = Math.max(
    TOOLBAR_HEIGHT,
    Math.min(MAX_INPUT_LINES, wrap.lines) * lineHeight + FIELD_VERTICAL_PADDING,
  );
  const attachmentsOpen = !sending && attachments.items.length > 0;
  const shapeDuration = useReducedMotion() ? 0 : SHAPE_DURATION;
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
      {suggestionsVisible && query ? (
        <GlassView
          glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
          style={{
            marginHorizontal: 16,
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
      <View
        pointerEvents="box-none"
        style={{ paddingHorizontal: BAR_INSET, paddingTop: 8, paddingBottom: Math.max(bottomInset, 10) }}
      >
        <GestureDetector gesture={pan}>
          <GlassView
            glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
            style={{
              backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
              borderCurve: "continuous",
              borderRadius: 24,
              overflow: "hidden",
              opacity: disabled ? 0.45 : 1,
            }}
          >
            {/* Measure wrapping independently of UITextView's constrained contentSize.
                This node keeps the field's width whatever shape the card is in, so
                its line count gives the height and its widest line says whether the
                text would still fit beside the controls. */}
            <NativeText
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              className="font-sans"
              style={{
                position: "absolute",
                left: FIELD_INSET,
                right: FIELD_INSET,
                top: 0,
                opacity: 0,
                fontSize: 16,
                lineHeight: 22,
              }}
              onTextLayout={({ nativeEvent }) => {
                const lines = Math.max(1, nativeEvent.lines.length);
                const width = nativeEvent.lines.reduce((widest, line) => Math.max(widest, line.width), 0);
                setWrap((current) => (current.lines === lines && current.width === width ? current : { lines, width }));
              }}
            >
              {`${displayText}​`}
            </NativeText>
            {replyTarget ? (
              <View className="flex-row items-center gap-2 pt-2 pl-4 pr-2">
                <Reply color={String(muted)} size={16} />
                <Typography.Paragraph numberOfLines={1} type="body-sm" className="flex-1 text-text-secondary">
                  {mentionDraft(replyTarget.body).text || "Attachment"}
                </Typography.Paragraph>
                <Button isIconOnly size="sm" variant="ghost" accessibilityLabel="Cancel reply" onPress={onCancelReply}>
                  <X color={String(muted)} size={16} />
                </Button>
              </View>
            ) : null}
            <Animated.View
              style={{
                height: attachmentsOpen ? ATTACHMENT_BLOCK_HEIGHT : 0,
                overflow: "hidden",
                transitionProperty: "height",
                transitionDuration: shapeDuration,
                transitionTimingFunction: SHAPE_EASING,
              }}
            >
              {attachmentsOpen ? (
                <ScrollView
                  horizontal
                  keyboardShouldPersistTaps="handled"
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, paddingHorizontal: 8, paddingTop: 8 }}
                >
                  {attachments.items.map((item) => (
                    <View key={item.id} className="size-28 overflow-hidden rounded-2xl bg-control p-3">
                      {item.mimeType.startsWith("image/") ? (
                        <Image
                          source={item.uri ?? `data:${item.mimeType};base64,${item.base64}`}
                          contentFit="cover"
                          accessibilityLabel={item.name}
                          style={{ position: "absolute", inset: 0 }}
                        />
                      ) : (
                        <>
                          <FileText color={String(foreground)} size={22} />
                          <Typography.Paragraph numberOfLines={2} type="body-xs" className="mt-auto pr-6">
                            {item.name}
                          </Typography.Paragraph>
                        </>
                      )}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.name}`}
                        accessibilityState={{ disabled: sending }}
                        disabled={sending}
                        hitSlop={8}
                        // A HeroUI icon button fills a quarter of the tile here. The
                        // badge has to read as an overlay on the file, not a control
                        // beside it, so it keeps its 44 pt target through hitSlop.
                        className="absolute right-1.5 top-1.5 size-7 items-center justify-center rounded-full"
                        style={{ backgroundColor: raised }}
                        onPress={() => attachments.remove(item.id)}
                      >
                        <X color={String(foreground)} size={15} strokeWidth={2.4} />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
            </Animated.View>
            <View>
              <Animated.View
                style={{
                  height: fieldHeight,
                  // The controls hold the bottom of the card. In a single row they
                  // overlay the field, so the text clears their width instead.
                  marginBottom: stacked ? TOOLBAR_HEIGHT : 0,
                  // The field keeps one layout width and slides. Animating the
                  // inset would re-wrap the text on every frame of the
                  // transition, which reads as the text shaking. A single row is
                  // only ever used while the text fits the narrower measure, so
                  // the slid text still stops short of the controls.
                  paddingLeft: FIELD_INSET,
                  paddingRight: FIELD_INSET,
                  transform: [{ translateX: stacked ? 0 : ROW_CONTROL_INSET - FIELD_INSET }],
                  transitionProperty: ["height", "marginBottom", "transform"],
                  transitionDuration: shapeDuration,
                  transitionTimingFunction: SHAPE_EASING,
                }}
              >
                <TextInput
                  ref={inputRef}
                  nativeID="chat-composer-input"
                  accessibilityLabel={`Message ${agentName}`}
                  accessibilityState={{ disabled }}
                  editable={!disabled}
                  showSoftInputOnFocus={!disabled}
                  className="min-w-0 font-sans text-foreground"
                  placeholder={`Ask ${agentName}`}
                  autoCorrect
                  autoCapitalize="sentences"
                  placeholderTextColor={muted}
                  multiline
                  scrollEnabled={wrap.lines > MAX_INPUT_LINES}
                  returnKeyType="default"
                  submitBehavior="newline"
                  selectionColor={foreground}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 16,
                    lineHeight: 22,
                    paddingVertical: FIELD_VERTICAL_PADDING / 2,
                    textAlignVertical: "top",
                  }}
                  onSelectionChange={({ nativeEvent }) =>
                    setCursor(
                      nativeEvent.selection.start === nativeEvent.selection.end ? nativeEvent.selection.end : -1,
                    )
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
                        <NativeText style={{ color: action }}>
                          {displayText.slice(mention.start, mention.end)}
                        </NativeText>
                      </NativeText>
                    ))}
                    {displayText.slice(display.mentions.at(-1)?.end ?? 0)}
                  </NativeText>
                </TextInput>
              </Animated.View>
              <View
                pointerEvents="box-none"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: TOOLBAR_HEIGHT,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingHorizontal: 8,
                }}
              >
                <Pressable
                  accessibilityLabel={stopMode ? `Stop ${agentName}` : sendLabel}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !pressable, busy: busy || stopPending }}
                  disabled={!pressable}
                  className="size-10 items-center justify-center rounded-full"
                  style={{
                    // Nothing to send reads as a bare glyph on the card, not as a
                    // filled control the user could press.
                    backgroundColor: primed ? action : "transparent",
                    // The card dims as a whole when the composer is disabled.
                    // Dim only this control for a state the card does not show.
                    opacity: disabled || pressable ? 1 : 0.45,
                  }}
                  onPress={stopMode ? onStop : requestSend}
                >
                  {busy || stopPending ? (
                    <Spinner size="sm" color={String(actionForeground)} />
                  ) : stopMode ? (
                    <Square
                      color={String(actionForeground)}
                      fill={String(actionForeground)}
                      size={14}
                      strokeWidth={2}
                    />
                  ) : (
                    <ArrowUp color={String(primed ? actionForeground : muted)} size={21} strokeWidth={2.2} />
                  )}
                </Pressable>
              </View>
            </View>
          </GlassView>
        </GestureDetector>
        {/* Outside the glass container on purpose. A SwiftUI Menu anchored
            inside one makes iOS morph that container into the menu, which ate
            the whole composer whenever the card was no taller than the row. */}
        <View
          pointerEvents="box-none"
          // Absolute insets here are measured from the bar's outer edge, so they
          // have to carry the bar's own padding to land on the card.
          style={{ position: "absolute", left: BAR_INSET + 8, bottom: Math.max(bottomInset, 10) + 4 }}
        >
          <View
            ref={attachmentButton}
            collapsable={false}
            pointerEvents={disabled || sending || attachments.preparing ? "none" : "auto"}
            // SwiftUI's Menu owns the tap and @expo/ui documents onOpenMenu as
            // never firing on iOS, so answer the press itself. pointerEvents
            // already blocks this while the button cannot act.
            onTouchStart={() => void haptics.selection()}
          >
            <MenuView
              style={{ width: 40, height: 40 }}
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
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel="Add attachment"
                accessibilityState={{ disabled: disabled || sending || attachments.preparing }}
                className="size-10 items-center justify-center rounded-full"
                style={{ opacity: disabled || sending || attachments.preparing ? 0.45 : 1 }}
              >
                <Plus color={String(foreground)} size={24} strokeWidth={1.8} />
              </View>
            </MenuView>
          </View>
        </View>
      </View>
    </View>
  );
}
