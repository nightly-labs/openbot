import type { ShjToken } from "@speed-highlight/core";
import * as Clipboard from "expo-clipboard";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import Copy from "lucide-react-native/icons/copy";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { type ColorValue, Text, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { CODE_LAYOUT_STYLE, CODE_TEXT_STYLE } from "@/shared/lib/text-direction";
import type { BubbleTone } from "../model/bubble-tone";
import { type CodeToken, cachedHighlight, codeLanguageLabel, highlightCode } from "../model/code-highlight";
import { useListSettled } from "./use-list-settled";

/** A streaming block grows each frame. Highlight it at most this often; the new tail stays plain until then. */
const STREAMING_HIGHLIGHT_INTERVAL_MS = 250;
/**
 * Each highlight reads the whole block again, so a long block waits longer for the next one: the time
 * that the highlight takes stays a small part of the time between two of them.
 */
const STREAMING_HIGHLIGHT_CHARACTERS_PER_MS = 40;

function streamingHighlightInterval(length: number): number {
  return Math.max(STREAMING_HIGHLIGHT_INTERVAL_MS, Math.round(length / STREAMING_HIGHLIGHT_CHARACTERS_PER_MS));
}

/** A run of code in one colour. `color` is unset for code in the colour of the block. */
interface CodeRun {
  offset: number;
  text: string;
  color: ColorValue | undefined;
}

/**
 * The tokens as runs of one colour. Many token types share a colour, and most tokens have the colour
 * of the block, so a block has far fewer runs than tokens. The list draws a block again each time
 * its row scrolls into view, and each run that has a colour is a text span to make.
 */
function codeRuns(
  tokens: readonly CodeToken[],
  colors: Partial<Record<ShjToken, ColorValue>>,
  foreground: ColorValue,
): CodeRun[] {
  const runs: CodeRun[] = [];
  let last: CodeRun | undefined;
  for (const token of tokens) {
    const tokenColor = token.type ? colors[token.type] : undefined;
    const color = tokenColor === undefined || tokenColor === foreground ? undefined : tokenColor;
    if (last && last.color === color) {
      last.text += token.text;
      continue;
    }
    last = { offset: token.offset, text: token.text, color };
    runs.push(last);
  }
  return runs;
}

interface ChatCodeBlockProps {
  text: string;
  language?: string;
  selectable?: boolean;
  /** The text will not change, so its highlight is kept for the app run. */
  finished?: boolean;
  /**
   * The colors of a bubble with a message color. The code is in the bubble's text color: the theme
   * colors of highlighted code do not read on every message color.
   */
  tone?: BubbleTone;
}

export const ChatCodeBlock = memo(function ChatCodeBlock(props: ChatCodeBlockProps) {
  // A block that mounts during a fast fling of the chat colours its code when the list slows down.
  const settled = useListSettled();
  return <CodeBlockBody {...props} highlight={settled} />;
});

const CodeBlockBody = memo(function CodeBlockBody({
  text,
  language,
  selectable = true,
  finished = false,
  tone,
  highlight: highlightAllowed,
}: ChatCodeBlockProps & { highlight: boolean }) {
  const { t } = useText();
  const theme = useCodeTokenColors();
  const muted = tone?.muted ?? theme.muted;
  // The block is drawn as a table: the language and the copy button on a card, and the code on an
  // inset panel of the canvas. The card is a clear layer of the text color, so it shows on every
  // surface: the screen, an agent's bubble or a card. A message color gives its own surfaces.
  const [textColor, canvas] = useCSSVariable(["--openbot-text-primary", "--openbot-bg-native-canvas"]).map(String);
  const card = tone?.panel ?? `${textColor}0f`;
  const panel = tone?.deep ?? canvas;
  const foreground = tone?.foreground ?? theme.foreground;
  const colors: Partial<Record<ShjToken, ColorValue>> = tone ? { cmnt: tone.muted } : theme.colors;
  const [highlight, setHighlight] = useState<{ text: string; language?: string; tokens: CodeToken[] } | null>(() => {
    const tokens = cachedHighlight(text, language);
    return tokens ? { text, language, tokens } : null;
  });
  const [copiedText, setCopiedText] = useState<string | null>(null);
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
    // The text of a finished block does not change again: it gets its colours at once.
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
  const copied = copiedText === text;
  async function copy() {
    try {
      await Clipboard.setStringAsync(text);
      setCopiedText(text);
      void haptics.notification("success");
    } catch (error) {
      void haptics.notification("error");
      showFailureAlert(error, "turn", t("mobile.chat.code.copyFailed"), t("mobile.chat.copyFailedMessage"));
    }
  }
  return (
    <View className="overflow-hidden" style={{ borderRadius: 16, borderCurve: "continuous", backgroundColor: card }}>
      {/* The label lines up with the code on the inset panel, as a table header does with its rows. */}
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
            paddingHorizontal: 12,
            paddingVertical: 12,
          },
        ]}
      >
        <Typography.Code
          selectable={selectable}
          className="bg-transparent p-0"
          style={[CODE_TEXT_STYLE, { color: foreground, fontSize: 14, lineHeight: 20 }]}
        >
          {runs.map((run) =>
            run.color === undefined ? (
              run.text
            ) : (
              // A plain native span in the font of the block around it, not a `Typography`: a long
              // block has hundreds of runs, and each `Typography` adds four components to the row.
              <Text key={run.offset} style={{ color: run.color }}>
                {run.text}
              </Text>
            ),
          )}
        </Typography.Code>
      </View>
    </View>
  );
});

/** The colours of highlighted code, shared by the code block in a message and the code view of a preview. */
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
