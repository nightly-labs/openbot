import type { ShjToken } from "@speed-highlight/core";
import * as Clipboard from "expo-clipboard";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Check, Copy } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, type ColorValue, ScrollView, useWindowDimensions, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { type CodeToken, codeLanguage, highlightCode } from "../model/code-highlight";

export function ChatCodeBlock({
  text,
  language,
  selectable = true,
}: {
  text: string;
  language?: string;
  selectable?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const [foreground, muted, keyword] = useThemeColor(["foreground", "muted", "link"]);
  const [string, number, error] = useCSSVariable([
    "--openbot-success-text",
    "--openbot-warning-text",
    "--openbot-danger-text",
  ]).map(String);
  const [highlight, setHighlight] = useState<{ text: string; language?: string; tokens: CodeToken[] } | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void highlightCode(text, language)
      .then((tokens) => {
        if (active) setHighlight({ text, language, tokens });
      })
      .catch(() => {
        if (active) setHighlight(null);
      });
    return () => {
      active = false;
    };
  }, [text, language]);
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
  const tokens = highlight?.text === text && highlight.language === language ? highlight.tokens : [{ text, offset: 0 }];
  const copied = copiedText === text;
  async function copy() {
    try {
      await Clipboard.setStringAsync(text);
      setCopiedText(text);
    } catch {
      Alert.alert("Could not copy code", "Please try again.");
    }
  }
  return (
    <View className="overflow-hidden bg-control/50" style={{ borderRadius: 18, borderCurve: "continuous" }}>
      <View className="flex-row items-center justify-between gap-3 pl-3 pr-1 pt-1">
        <Typography.Paragraph type="body-xs" className="shrink text-muted" numberOfLines={1}>
          {codeLanguage(language).label}
        </Typography.Paragraph>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          accessibilityLabel={copied ? "Code copied" : "Copy code"}
          onPress={copy}
        >
          {copied ? <Check size={14} color={String(muted)} /> : <Copy size={14} color={String(muted)} />}
        </Button>
      </View>
      <ScrollView
        horizontal
        bounces={false}
        style={{ flexGrow: 0, flexShrink: 0, height: text.split("\n").length * 20 * fontScale + 20, maxWidth: "100%" }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 14, alignItems: "flex-start" }}
      >
        <Typography.Code
          selectable={selectable}
          className="bg-transparent p-0"
          style={{ color: foreground, fontSize: 14, lineHeight: 20 }}
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
      </ScrollView>
    </View>
  );
}
