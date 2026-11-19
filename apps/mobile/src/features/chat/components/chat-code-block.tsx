import { LegendList } from "@legendapp/list/react-native";
import type { ShjToken } from "@speed-highlight/core";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import Copy from "lucide-react-native/icons/copy";
import { memo, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type ColorValue, Text, View, type ViewStyle } from "react-native";
import { useCSSVariable } from "uniwind";
import { useFontScale } from "@/shared/lib/font-scale";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { CODE_LAYOUT_STYLE, CODE_TEXT_STYLE } from "@/shared/lib/text-direction";
import type { BubbleTone } from "../model/bubble-tone";
import { type CodeToken, cachedHighlight, codeLanguageLabel, highlightCode } from "../model/code-highlight";
import { SCROLLING_CODE_LINES } from "../model/markdown-preview-parts";
import { copyToClipboard } from "./use-copy-message";
import { useListSettled } from "./use-list-settled";

const STREAMING_HIGHLIGHT_INTERVAL_MS = 250;
const STREAMING_HIGHLIGHT_CHARACTERS_PER_MS = 40;

function streamingHighlightInterval(length: number): number {
  return Math.max(STREAMING_HIGHLIGHT_INTERVAL_MS, Math.round(length / STREAMING_HIGHLIGHT_CHARACTERS_PER_MS));
}

const ANDROID_MAX_COLORED_RUNS = 300;

export interface CodeRun {
  offset: number;
  text: string;
  color: ColorValue | undefined;
}

export function codeRuns(
  tokens: readonly CodeToken[],
  colors: Partial<Record<ShjToken, ColorValue>>,
  foreground: ColorValue,
): CodeRun[] {
  const runs: CodeRun[] = [];
  let last: CodeRun | undefined;
  let colored = 0;
  for (const token of tokens) {
    const tokenColor = token.type ? colors[token.type] : undefined;
    const color = tokenColor === undefined || tokenColor === foreground ? undefined : tokenColor;
    if (last && last.color === color) {
      last.text += token.text;
      continue;
    }
    if (color !== undefined) colored += 1;
    last = { offset: token.offset, text: token.text, color };
    runs.push(last);
  }
  if (isAndroid && colored > ANDROID_MAX_COLORED_RUNS) {
    return [{ offset: 0, text: tokens.map((token) => token.text).join(""), color: undefined }];
  }
  return runs;
}

interface ChatCodeBlockProps {
  text: string;
  language?: string;
  selectable?: boolean;
  finished?: boolean;
  tone?: BubbleTone;
}

export const ChatCodeBlock = memo(function ChatCodeBlock(props: ChatCodeBlockProps) {
  const settled = useListSettled();
  return <CodeBlockBody {...props} highlight={settled} />;
});

const CodeBlockBody = memo(function CodeBlockBody({
  text,
  language,
  selectable = true,
  finished = false,
  tone,
  highlight,
}: ChatCodeBlockProps & { highlight: boolean }) {
  const { runs, foreground } = useCodeRuns(text, language, finished, highlight, tone);
  return (
    <CodeBlockFrame language={language} copyText={text} tone={tone} panelStyle={{ padding: 12 }}>
      <CodeText runs={runs} foreground={foreground} selectable={selectable} />
    </CodeBlockFrame>
  );
});

const CODE_LINE_HEIGHT = 20;

export const ScrollingCodeBlock = memo(function ScrollingCodeBlock({
  text,
  pieces,
  language,
}: {
  text: string;
  pieces: readonly string[];
  language?: string;
}) {
  const fontScale = useFontScale();
  return (
    <CodeBlockFrame
      language={language}
      copyText={text}
      panelStyle={{ height: (SCROLLING_CODE_LINES * CODE_LINE_HEIGHT + 24) * fontScale, overflow: "hidden" }}
    >
      <LegendList
        data={pieces}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item }) => <CodePiece text={item} language={language} />}
        estimatedItemSize={CODE_LINE_HEIGHT * 40}
        recycleItems={false}
        nestedScrollEnabled
        style={{ flex: 1 }}
        ListHeaderComponent={<View style={{ height: 12 }} />}
        ListFooterComponent={<View style={{ height: 12 }} />}
      />
    </CodeBlockFrame>
  );
});

function CodePiece({ text, language }: { text: string; language?: string }) {
  const { runs, foreground } = useCodeRuns(text, language, true, true, undefined);
  return (
    <View style={{ paddingHorizontal: 12 }}>
      <CodeText runs={runs} foreground={foreground} selectable />
    </View>
  );
}

function CodeBlockFrame({
  language,
  copyText,
  tone,
  panelStyle,
  children,
}: {
  language: string | undefined;
  copyText: string;
  tone?: BubbleTone;
  panelStyle: ViewStyle;
  children: ReactNode;
}) {
  const { t } = useText();
  const theme = useCodeTokenColors();
  const muted = tone?.muted ?? theme.muted;
  const [textColor, canvas] = useCSSVariable(["--openbot-text-primary", "--openbot-bg-native-canvas"]).map(String);
  const card = tone?.panel ?? `${textColor}0f`;
  const panel = tone?.deep ?? canvas;
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const copied = copiedText === copyText;
  async function copy() {
    if (await copyToClipboard(copyText, "mobile.chat.code.copyFailed", t)) setCopiedText(copyText);
  }
  return (
    <View className="overflow-hidden" style={{ borderRadius: 16, borderCurve: "continuous", backgroundColor: card }}>
      <View className="flex-row items-center justify-between gap-3" style={{ paddingStart: 15, paddingEnd: 4 }}>
        <Typography.Paragraph
          type="body-xs"
          className="shrink text-muted"
          numberOfLines={1}
          style={tone ? { color: tone.muted } : undefined}
        >
          {codeLanguageLabel(language, t)}
        </Typography.Paragraph>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          accessibilityLabel={copied ? t("mobile.chat.code.copied") : t("mobile.chat.code.copy")}
          onPress={copy}
        >
          {copied ? <Check size={14} color={String(muted)} /> : <Copy size={14} color={String(muted)} />}
        </Button>
      </View>
      <View
        style={[
          CODE_LAYOUT_STYLE,
          {
            marginHorizontal: 3,
            marginBottom: 3,
            borderRadius: 13,
            borderCurve: "continuous",
            backgroundColor: panel,
          },
          panelStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function useCodeRuns(
  text: string,
  language: string | undefined,
  finished: boolean,
  highlightAllowed: boolean,
  tone: BubbleTone | undefined,
) {
  const theme = useCodeTokenColors();
  const foreground = tone?.foreground ?? theme.foreground;
  const colors: Partial<Record<ShjToken, ColorValue>> = tone ? { cmnt: tone.muted } : theme.colors;
  const [highlight, setHighlight] = useState<{ text: string; language?: string; tokens: CodeToken[] } | null>(() => {
    const tokens = cachedHighlight(text, language);
    return tokens ? { text, language, tokens } : null;
  });
  const lastHighlight = useRef<number | null>(null);
  useEffect(() => {
    const cached = cachedHighlight(text, language);
    if (cached) {
      setHighlight((current) =>
        current?.text === text && current.language === language ? current : { text, language, tokens: cached },
      );
      return;
    }
    if (!highlightAllowed) return;
    let active = true;
    const run = () => {
      lastHighlight.current = Date.now();
      void highlightCode(text, language, finished)
        .then((tokens) => {
          if (active) setHighlight({ text, language, tokens });
        })
        .catch(() => {
          if (active) setHighlight(null);
        });
    };
    const last = lastHighlight.current;
    const interval = finished ? STREAMING_HIGHLIGHT_INTERVAL_MS : streamingHighlightInterval(text.length);
    const delay = last === null ? 0 : Math.max(0, interval - (Date.now() - last));
    const timer = delay === 0 ? null : setTimeout(run, delay);
    if (timer === null) run();
    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [text, language, finished, highlightAllowed]);
  const tokens =
    !highlight || highlight.language !== language || !text.startsWith(highlight.text)
      ? [{ text, offset: 0 }]
      : highlight.text === text
        ? highlight.tokens
        : [...highlight.tokens, { text: text.slice(highlight.text.length), offset: highlight.text.length }];
  const runs = useMemo(() => codeRuns(tokens, colors, foreground), [tokens, colors, foreground]);
  return { runs, foreground };
}

function CodeText({ runs, foreground, selectable }: { runs: CodeRun[]; foreground: ColorValue; selectable: boolean }) {
  return (
    <Typography.Code
      selectable={selectable}
      className="bg-transparent p-0"
      style={[CODE_TEXT_STYLE, { color: foreground, fontSize: 14, lineHeight: CODE_LINE_HEIGHT }]}
    >
      {runs.map((run) =>
        run.color === undefined ? (
          run.text
        ) : (
          <Text key={run.offset} style={{ color: run.color }}>
            {run.text}
          </Text>
        ),
      )}
    </Typography.Code>
  );
}

export function useCodeTokenColors() {
  const [foreground, muted, keyword] = useThemeColor(["foreground", "muted", "link"]);
  const [string, number, error] = useCSSVariable([
    "--openbot-success-text",
    "--openbot-warning-text",
    "--openbot-danger-text",
  ]).map(String);
  const colors: Partial<Record<ShjToken, ColorValue>> = {
    kwd: keyword,
    type: keyword,
    class: keyword,
    func: keyword,
    str: string,
    insert: string,
    num: number,
    bool: number,
    esc: number,
    cmnt: muted,
    deleted: error,
    err: error,
  };
  return { foreground, muted, colors };
}
