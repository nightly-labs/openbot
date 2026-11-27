import { useRef } from "react";
import { type ColorValue, TextInput, type TextInputInstance } from "react-native";
import { useFontScale } from "@/shared/lib/font-scale";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { fieldDirectionStyle } from "@/shared/lib/text-direction";
import { CHAT_TEXT_STYLES } from "./chat-text-styles";

const FONT_SIZE = CHAT_TEXT_STYLES.body.fontSize;
const LINE_HEIGHT = CHAT_TEXT_STYLES.body.lineHeight;
const FONT_LINE_RATIO = 1.21;
const IOS_BASELINE_SHIFT = (LINE_HEIGHT - FONT_SIZE * FONT_LINE_RATIO) / 2;

export function ChatSelectableText({
  text,
  color,
  onHeight,
  onSelectionChange,
}: {
  text: string;
  color: ColorValue | undefined;
  onHeight: (height: number) => void;
  onSelectionChange: (selected: string) => void;
}) {
  const { t } = useText();
  const fontScale = useFontScale();
  const input = useRef<TextInputInstance>(null);
  const selected = useRef({ layout: false, size: false });
  const selectAll = (step: "layout" | "size") => {
    if (selected.current[step]) return;
    selected.current[step] = true;
    if (input.current?.isFocused()) input.current.blur();
    input.current?.focus();
    input.current?.setSelection(0, text.length);
  };
  return (
    <TextInput
      ref={input}
      selectTextOnFocus
      onLayout={() => selectAll("layout")}
      accessibilityLabel={t("mobile.chat.message.text")}
      value={text}
      multiline
      scrollEnabled={false}
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
        ...fieldDirectionStyle(text),
      }}
    />
  );
}
