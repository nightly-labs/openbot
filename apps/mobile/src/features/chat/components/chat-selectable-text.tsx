import { useRef } from "react";
import { type ColorValue, TextInput, type TextInputInstance } from "react-native";
import { useFontScale } from "@/shared/lib/font-scale";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { fieldDirectionStyle } from "@/shared/lib/text-direction";
import { CHAT_TEXT_STYLES } from "./chat-text-styles";

/** The body text of a message. */
const FONT_SIZE = CHAT_TEXT_STYLES.body.fontSize;
const LINE_HEIGHT = CHAT_TEXT_STYLES.body.lineHeight;
/** The natural line height of Inter, as a multiple of its size: (1984 + 494) / 2048. */
const FONT_LINE_RATIO = 1.21;
/**
 * iOS `Text` centres each line in its line height, but a text field puts the extra space above the
 * letters. The field moves up by half of that space, so its words cover the words of the message.
 */
const IOS_BASELINE_SHIFT = (LINE_HEIGHT - FONT_SIZE * FONT_LINE_RATIO) / 2;

/**
 * The text of a message while the reader selects part of it in the bubble.
 *
 * iOS `Text` copies only a whole message, and `Text` on either platform does not report the
 * selected range, so a read-only text field covers the message text. It has the size and line
 * height of the body text, so the words stay where they are. It opens with all text selected;
 * the platform handles change the range, and the system menu has Copy and Select All.
 */
export function ChatSelectableText({
  text,
  color,
  onHeight,
  onSelectionChange,
}: {
  text: string;
  color: ColorValue | undefined;
  /** The height of the text, so the bubble grows when the plain text is longer than the message. */
  onHeight: (height: number) => void;
  /** The selected part of `text`. Empty when the selection is only a cursor. */
  onSelectionChange: (selected: string) => void;
}) {
  const { t } = useText();
  const fontScale = useFontScale();
  const input = useRef<TextInputInstance>(null);
  // The field selects all of its text at its first layout and again when it first reports the size
  // of its text. The first time a message selects, its text is not laid out yet at the first layout.
  const selected = useRef({ layout: false, size: false });
  const selectAll = (step: "layout" | "size") => {
    if (selected.current[step]) return;
    selected.current[step] = true;
    // Select All runs on focus only, so a field that already has focus takes it again.
    if (input.current?.isFocused()) input.current.blur();
    input.current?.focus();
    input.current?.setSelection(0, text.length);
  };
  return (
    <TextInput
      ref={input}
      // On iOS the range set from JS did not show; the native Select All on focus selects the text.
      selectTextOnFocus
      onLayout={() => selectAll("layout")}
      accessibilityLabel={t("mobile.chat.message.text")}
      value={text}
      multiline
      scrollEnabled={false}
      // Android disables a field that cannot be edited, and a disabled field selects nothing. There
      // the field stays editable with no keyboard, and `value` puts back any change.
      editable={!isIOS}
      showSoftInputOnFocus={false}
      caretHidden
      onContentSizeChange={({ nativeEvent }) => {
        onHeight(nativeEvent.contentSize.height);
        if (nativeEvent.contentSize.height > 0) selectAll("size");
      }}
      onSelectionChange={({ nativeEvent }) =>
        onSelectionChange(text.slice(nativeEvent.selection.start, nativeEvent.selection.end))
      }
      className="absolute left-0 right-0 top-0 bg-transparent p-0 font-sans"
      style={{
        color,
        fontSize: FONT_SIZE,
        lineHeight: LINE_HEIGHT,
        transform: isIOS ? [{ translateY: -IOS_BASELINE_SHIFT * fontScale }] : undefined,
        // An Android field finds the direction of each paragraph from its text. An iOS field
        // takes it from the first paragraph, as the message text does in most messages. Text with
        // no letter keeps the layout direction, as the message text does.
        ...fieldDirectionStyle(text),
      }}
    />
  );
}
