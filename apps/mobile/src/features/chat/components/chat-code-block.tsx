import type { ShjToken } from "@speed-highlight/core";
import * as Clipboard from "expo-clipboard";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import Copy from "lucide-react-native/icons/copy";
import { memo, useEffect, useRef, useState } from "react";
import { type ColorValue, View } from "react-native";
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
    const delay = last === null ? 0 : Math.max(0, STREAMING_HIGHLIGHT_INTERVAL_MS - (Date.now() - last));
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
          {tokens.map((token) => (
            <Typography.Code
              key={token.offset}
              className="bg-transparent p-0"
              style={{
                color: token.type ? (colors[token.type] ?? foreground) : foreground,
                fontSize: 14,
                lineHeight: 20,
              }}
            >
              {token.text}
            </Typography.Code>
          ))}
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
