import { Typography } from "heroui-native";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ScrollView, TextInput, type TextStyle, View } from "react-native";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { type CodeToken, highlightCode } from "../model/code-highlight";
import { useCodeTokenColors } from "./chat-code-block";

const FONT_SIZE = 13;
const LINE_HEIGHT = 20;
/** The monospace font of `Typography.Code` on each platform. */
const CODE_FONT = isIOS ? "Menlo" : "monospace";
/** The width of one digit of the code font, in points, so the gutter fits the last line number. */
const DIGIT_WIDTH = 8;
const GUTTER_GAP = 14;
const SIDE_PADDING = 16;

/**
 * The code of a preview on its own screen, as an editor shows a file: the screen background, a
 * column of line numbers, and the colours of the code block in the chat. The code is one text, so
 * a finger selects any part of it with the system handles and copies it. iOS `Text` copies only
 * the whole text, so on iOS the code is a read-only text field, as Select Text in a message is.
 * Without wrap the lines scroll sideways together and the numbers stay in place. With wrap a
 * line can take several rows, so the numbers would no longer match their lines and are hidden.
 */
export function CodeDocument({
  text,
  language,
  title,
  wrap,
  topInset,
  bottomInset,
}: {
  text: string;
  language?: string;
  title: string;
  wrap: boolean;
  topInset: number;
  bottomInset: number;
}) {
  const { foreground, muted, colors } = useCodeTokenColors();
  const [tokens, setTokens] = useState<CodeToken[] | null>(null);
  useEffect(() => {
    let active = true;
    setTokens(null);
    void highlightCode(text, language)
      .then((highlighted) => {
        if (active) setTokens(highlighted);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [text, language]);
  const lineCount = useMemo(() => text.split("\n").length, [text]);
  const codeStyle: TextStyle = {
    fontFamily: CODE_FONT,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    color: foreground,
  };
  const runs = (tokens ?? [{ text, offset: 0 }]).map((token) => (
    <Typography.Code
      key={token.offset}
      className="bg-transparent p-0"
      style={{ ...codeStyle, color: token.type ? (colors[token.type] ?? foreground) : foreground }}
    >
      {token.text}
    </Typography.Code>
  ));
  const code = <SelectableCode label={title} style={codeStyle} runs={runs} />;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      alwaysBounceVertical={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset + SIDE_PADDING }}
    >
      {wrap ? (
        <View style={{ paddingHorizontal: SIDE_PADDING }}>{code}</View>
      ) : (
        <View className="flex-row" style={{ paddingLeft: SIDE_PADDING }}>
          <Typography.Code
            selectable={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="bg-transparent p-0"
            style={{
              ...codeStyle,
              color: muted,
              opacity: 0.6,
              width: String(lineCount).length * DIGIT_WIDTH,
              textAlign: "right",
            }}
          >
            {Array.from({ length: lineCount }, (_, row) => row + 1).join("\n")}
          </Typography.Code>
          <ScrollView
            horizontal
            alwaysBounceHorizontal={false}
            contentContainerStyle={{ paddingLeft: GUTTER_GAP, paddingRight: SIDE_PADDING }}
          >
            {code}
          </ScrollView>
        </View>
      )}
    </ScrollView>
  );
}

function SelectableCode({ label, style, runs }: { label: string; style: TextStyle; runs: ReactNode }) {
  const { t } = useText();
  if (isIOS)
    return (
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={t("mobile.chat.preview.selectHint")}
        multiline
        editable={false}
        showSoftInputOnFocus={false}
        scrollEnabled={false}
        autoCorrect={false}
        spellCheck={false}
        style={{ ...style, padding: 0, margin: 0 }}
      >
        {runs}
      </TextInput>
    );
  return (
    <Typography.Code selectable className="bg-transparent p-0" style={style}>
      {runs}
    </Typography.Code>
  );
}
