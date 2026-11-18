import { Typography } from "heroui-native";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, type TextStyle, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { CODE_LAYOUT_STYLE, CODE_TEXT_STYLE } from "@/shared/lib/text-direction";
import { type CodeToken, highlightCode } from "../model/code-highlight";
import { codeRuns, useCodeTokenColors } from "./chat-code-block";

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
  firstLine = 1,
}: {
  text: string;
  language?: string;
  title: string;
  wrap: boolean;
  topInset: number;
  bottomInset: number;
  /** The number of the first line, when the text is a later part of a long file. */
  firstLine?: number;
}) {
  const { foreground, muted, colors } = useCodeTokenColors();
  // The code keeps clear of the side insets: the rail of iPhone Duo and the edges in landscape.
  const insets = useSafeAreaInsets();
  const sides = { paddingLeft: insets.left + SIDE_PADDING, paddingRight: insets.right + SIDE_PADDING };
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
    ...CODE_TEXT_STYLE,
    fontFamily: CODE_FONT,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    color: foreground,
  };
  const androidRuns = isIOS ? null : codeRuns(tokens ?? [{ text, offset: 0 }], colors, foreground);
  const runs = androidRuns
    ? // Android: plain native spans in one run for each colour, inside the code style of
      // `SelectableCode`. A file has thousands of tokens, and a text with a span set for each token
      // blocked the main thread. `codeRuns` also limits the coloured runs on Android.
      androidRuns.map((run) =>
        run.color === undefined ? (
          run.text
        ) : (
          <Text key={run.offset} style={{ color: run.color }}>
            {run.text}
          </Text>
        ),
      )
    : (tokens ?? [{ text, offset: 0 }]).map((token) => (
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
        <View style={[CODE_LAYOUT_STYLE, sides]}>{code}</View>
      ) : (
        <View className="flex-row" style={[CODE_LAYOUT_STYLE, { paddingLeft: sides.paddingLeft }]}>
          <Typography.Code
            selectable={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="bg-transparent p-0"
            style={{
              ...codeStyle,
              color: muted,
              opacity: 0.6,
              width: String(firstLine + lineCount - 1).length * DIGIT_WIDTH,
              textAlign: "right",
            }}
          >
            {Array.from({ length: lineCount }, (_, row) => row + firstLine).join("\n")}
          </Typography.Code>
          <ScrollView
            horizontal
            alwaysBounceHorizontal={false}
            contentContainerStyle={{ paddingLeft: GUTTER_GAP, paddingRight: sides.paddingRight }}
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
