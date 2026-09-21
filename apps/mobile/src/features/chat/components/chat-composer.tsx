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
import Animated, {
  cubicBezier,
  Easing,
  interpolate,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
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
// A control's own box, matching the `size-10` the two of them are drawn in,
// and the room the toolbar holds around them.
const CONTROL_SIZE = 40;
const TOOLBAR_PADDING = 8;
// At rest the composer is the same bar, smaller: it hugs its placeholder with
// only this gap to each control, and gives up this much height. The height is
// taken off the single line the field would otherwise be, so it follows the
// text size instead of clipping the placeholder at a large one.
const REST_TEXT_GAP = 10;
const REST_HEIGHT_LOSS = 8;
// The controls keep their layout box, so the touch target never shrinks with
// the bar: only the drawing scales, and it then slides out to the bar's edge.
const REST_CONTROL_SCALE = 0.8;

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);
const SHAPE_EASING = cubicBezier(0.23, 1, 0.32, 1);
// The same curve for worklet-driven values, which take Reanimated's own Easing.
const SHAPE_EASING_FN = Easing.bezier(0.23, 1, 0.32, 1);

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
  /** 0 with the keyboard down, 1 with it up, and every value a swipe passes through. */
  keyboardProgress: SharedValue<number>;
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
  keyboardProgress,
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
  const reducedMotion = useReducedMotion();
  const shapeDuration = reducedMotion ? 0 : SHAPE_DURATION;

  // At rest the composer is a smaller bar: narrower, shorter, with the plus on
  // the left, the placeholder centred and send on the right. It opens into the
  // full field as the keyboard rises, so an interactive dismissal closes it
  // frame by frame instead of snapping when the keyboard finally commits.
  const [placeholderWidth, setPlaceholderWidth] = useState(0);
  const cardWidth = windowWidth - BAR_INSET * 2;
  const restHeight = Math.max(TOOLBAR_HEIGHT, lineHeight + FIELD_VERTICAL_PADDING) - REST_HEIGHT_LOSS;
  // The toolbar keeps its height and the control rides down into the smaller
  // bar, so the box fills that bar's height.
  const restControlOffset = (TOOLBAR_HEIGHT - restHeight) / 2;
  // A smaller control leaves its box wider than it draws. Slide it out by that
  // slack plus the toolbar's own padding, so the gap it keeps from the bar's
  // side is the same one it keeps from the bar's bottom.
  const restControlShift = TOOLBAR_PADDING + (CONTROL_SIZE - restHeight) / 2;
  const restControlDrawn = CONTROL_SIZE * REST_CONTROL_SCALE;
  const restTextInset = (restHeight - restControlDrawn) / 2 + restControlDrawn + REST_TEXT_GAP;
  // Sized from the placeholder, so the bar carries no empty space. Full width
  // until the measurement lands: a bar that starts narrow would jump open.
  const restWidth = placeholderWidth > 0 ? Math.min(cardWidth, placeholderWidth + restTextInset * 2) : cardWidth;
  // Content outlives the keyboard: a draft or an attachment has to stay
  // readable after a dismissal, so it holds the composer open on its own.
  const held = useSharedValue(hasDraft ? 1 : 0);
  useEffect(() => {
    held.set(
      withTiming(hasDraft ? 1 : 0, {
        duration: reducedMotion ? 0 : SHAPE_DURATION,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [hasDraft, held, reducedMotion]);
  const expansion = useDerivedValue(() => Math.max(Math.min(1, keyboardProgress.get()), held.get()));
  const cardStyle = useAnimatedStyle(() => ({
    width: interpolate(expansion.get(), [0, 1], [restWidth, cardWidth]),
  }));
  // Both controls stay visible and pressable in the smaller bar, so the shape
  // change owes them only a position and the size they are drawn at. Both are
  // transforms: neither control re-lays-out on a single frame of the change.
  const controlStyle = useAnimatedStyle(() => {
    const progress = expansion.get();
    return {
      transform: [
        { translateX: interpolate(progress, [0, 1], [restControlShift, 0]) },
        { translateY: interpolate(progress, [0, 1], [restControlOffset, 0]) },
        { scale: interpolate(progress, [0, 1], [REST_CONTROL_SCALE, 1]) },
      ],
    };
  });
  const plusStyle = useAnimatedStyle(() => {
    const progress = expansion.get();
    const width = interpolate(progress, [0, 1], [restWidth, cardWidth]);
    return {
      transform: [
        // The card centres while it is narrow, so follow its left edge in, and
        // out to it by the same slack the control on the far side takes.
        { translateX: (cardWidth - width) / 2 - interpolate(progress, [0, 1], [restControlShift, 0]) },
        { translateY: interpolate(progress, [0, 1], [restControlOffset, 0]) },
        { scale: interpolate(progress, [0, 1], [REST_CONTROL_SCALE, 1]) },
      ],
    };
  });
  // The card shape drives the same slide, so it has to tween too. Reading
  // `stacked` straight from React would snap the text sideways.
  const stackedValue = useSharedValue(stacked ? 1 : 0);
  useEffect(() => {
    stackedValue.set(
      withTiming(stacked ? 1 : 0, {
        duration: reducedMotion ? 0 : SHAPE_DURATION,
        easing: SHAPE_EASING_FN,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [stacked, stackedValue, reducedMotion]);
  // The field's own height tweens on the UI thread, so the resting shape can
  // interpolate against it. A React-side transition would jump whenever a line
  // arrived in the middle of a keyboard dismissal.
  const fieldHeightValue = useSharedValue(fieldHeight);
  useEffect(() => {
    fieldHeightValue.set(
      withTiming(fieldHeight, {
        duration: shapeDuration,
        easing: SHAPE_EASING_FN,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [fieldHeight, fieldHeightValue, shapeDuration]);
  const fieldBoxStyle = useAnimatedStyle(() => ({
    height: interpolate(expansion.get(), [0, 1], [restHeight, fieldHeightValue.get()]),
    // The controls hold the bottom of the card. In a single row they overlay
    // the field, so the text clears their width instead.
    marginBottom: interpolate(stackedValue.get(), [0, 1], [0, TOOLBAR_HEIGHT]),
  }));
  // Centred at rest, and never further left than the plus: a placeholder wider
  // than the smaller bar, or one not measured yet, keeps the open position and
  // truncates instead of starting under a control.
  const openTextOffset = ROW_CONTROL_INSET - FIELD_INSET;
  const restTextOffset = placeholderWidth > 0 ? restTextInset - FIELD_INSET : openTextOffset;
  const fieldSlideStyle = useAnimatedStyle(() => ({
    height: fieldHeightValue.get(),
    transform: [
      {
        translateX: interpolate(
          expansion.get(),
          [0, 1],
          [restTextOffset, interpolate(stackedValue.get(), [0, 1], [openTextOffset, 0])],
        ),
      },
    ],
  }));
  // The placeholder rides the same slide on its own node: it has to leave the
  // centre in step with the text that replaces it.
  const placeholderStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          expansion.get(),
          [0, 1],
          [restTextOffset, interpolate(stackedValue.get(), [0, 1], [openTextOffset, 0])],
        ),
      },
    ],
  }));
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
        style={{
          alignItems: "center",
          paddingHorizontal: BAR_INSET,
          paddingTop: 8,
          paddingBottom: Math.max(bottomInset, 10),
        }}
      >
        {/* Measured in the bar, not the card: inside, the card's animating width
            would clamp the reading and feed an ever narrower pill back into it. */}
        <NativeText
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          numberOfLines={1}
          className="font-sans"
          style={{ position: "absolute", left: 0, top: 0, opacity: 0, fontSize: 16, lineHeight: 22 }}
          onLayout={({ nativeEvent }) =>
            setPlaceholderWidth((current) =>
              Math.abs(current - nativeEvent.layout.width) < 1 ? current : nativeEvent.layout.width,
            )
          }
        >
          {`Ask ${agentName}`}
        </NativeText>
        <GestureDetector gesture={pan}>
          <AnimatedGlassView
            glassEffectStyle={liquidGlassAvailable ? "regular" : "none"}
            style={[
              {
                backgroundColor: liquidGlassAvailable ? "transparent" : fallbackBackground,
                borderCurve: "continuous",
                borderRadius: 24,
                overflow: "hidden",
                opacity: disabled ? 0.45 : 1,
              },
              cardStyle,
            ]}
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
              <Animated.View style={[{ overflow: "hidden" }, fieldBoxStyle]}>
                {/* The field keeps its own height while the box closes over it:
                    re-laying the input out every frame would reflow its text.
                    The box is only ever shorter than the field while the field
                    is empty, so nothing readable is ever clipped.
                    The field also keeps one layout width and slides. Animating
                    the inset would re-wrap the text on every frame, which reads
                    as the text shaking. A single row is only ever used while the
                    text fits the narrower measure, so the slid text still stops
                    short of the controls. */}
                <Animated.View
                  style={[{ position: "absolute", left: FIELD_INSET, right: FIELD_INSET, bottom: 0 }, fieldSlideStyle]}
                >
                  <TextInput
                    ref={inputRef}
                    nativeID="chat-composer-input"
                    accessibilityLabel={`Message ${agentName}`}
                    accessibilityState={{ disabled }}
                    editable={!disabled}
                    showSoftInputOnFocus={!disabled}
                    className="min-w-0 font-sans text-foreground"
                    autoCorrect
                    autoCapitalize="sentences"
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
                {displayText ? null : (
                  <Animated.View
                    accessible={false}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    pointerEvents="none"
                    // Own placeholder, not TextInput's: only a separate node can
                    // leave the centre of the resting bar for the field's inset.
                    // It renders through the native text primitive, like the
                    // measuring node, so its metrics match the field it covers.
                    style={[
                      {
                        position: "absolute",
                        left: FIELD_INSET,
                        right: ROW_CONTROL_INSET,
                        top: 0,
                        bottom: 0,
                        justifyContent: "center",
                        alignItems: "flex-start",
                      },
                      placeholderStyle,
                    ]}
                  >
                    <NativeText
                      numberOfLines={1}
                      className="font-sans"
                      style={{ color: String(muted), fontSize: 16, lineHeight: 22 }}
                    >
                      {`Ask ${agentName}`}
                    </NativeText>
                  </Animated.View>
                )}
              </Animated.View>
              <View
                pointerEvents="box-none"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  // Constant: the smaller bar moves the control down instead of
                  // resizing this row under it, so the row never re-lays-out.
                  height: TOOLBAR_HEIGHT,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingHorizontal: TOOLBAR_PADDING,
                }}
              >
                <Animated.View style={controlStyle}>
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
                </Animated.View>
              </View>
            </View>
          </AnimatedGlassView>
        </GestureDetector>
        {/* Outside the glass container on purpose. A SwiftUI Menu anchored
            inside one makes iOS morph that container into the menu, which ate
            the whole composer whenever the card was no taller than the row. */}
        <Animated.View
          pointerEvents="box-none"
          // Absolute insets here are measured from the bar's outer edge, so they
          // have to carry the bar's own padding to land on the card.
          style={[{ position: "absolute", left: BAR_INSET + 8, bottom: Math.max(bottomInset, 10) + 4 }, plusStyle]}
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
              style={{ width: CONTROL_SIZE, height: CONTROL_SIZE }}
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
        </Animated.View>
      </View>
    </View>
  );
}
