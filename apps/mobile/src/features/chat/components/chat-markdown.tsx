import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import * as Linking from "expo-linking";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import type { Token, Tokens } from "marked";
import { Fragment, memo, type ReactNode, useMemo } from "react";
import { Alert, type ColorValue, ScrollView, type TextStyle, useWindowDimensions, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { ChatLinkIcon } from "@/features/chat/components/chat-link-icon";
import {
  StreamingBlock,
  StreamingTailText,
  StreamRevealProvider,
} from "@/features/chat/components/streaming-tail-text";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { parseChatMarkdown } from "../model/chat-markdown-parser";
import { plainMentionParts } from "../model/chat-mentions";
import { ChatCodeBlock } from "./chat-code-block";

interface MarkdownTokenByType {
  paragraph: Tokens.Paragraph;
  heading: Tokens.Heading;
  blockquote: Tokens.Blockquote;
  list: Tokens.List;
  code: Tokens.Code;
  table: Tokens.Table;
  text: Tokens.Text;
  escape: Tokens.Escape;
  strong: Tokens.Strong;
  em: Tokens.Em;
  del: Tokens.Del;
  codespan: Tokens.Codespan;
  link: Tokens.Link;
  image: Tokens.Image;
}

// Marked's public Token union includes extension tokens; narrow its built-in tokens here.
function tokenIs<K extends keyof MarkdownTokenByType>(token: Token, type: K): token is MarkdownTokenByType[K] {
  return token.type === type;
}

interface TextPresentation {
  type: "body" | "body-sm" | "h4" | "h5";
  style: TextStyle;
  codeColor: ColorValue;
  animateTail: boolean;
  agents: readonly MobileAgent[];
  mentionOffset: number;
}

// The inline badge is shifted to align its label with native text. Reserve the
// same space in the owning text view so its last line does not clip the capsule.
function textContainerStyle(source: string, presentation: TextPresentation): TextStyle {
  const hasMention =
    chatTagReferences(source).some((reference) => reference.kind === "agent") ||
    plainMentionParts(source, presentation.agents).some((part) => part.agent);
  return hasMention
    ? { ...presentation.style, paddingBottom: presentation.mentionOffset, overflow: "visible" }
    : presentation.style;
}

function webLink(href: string): string | null {
  try {
    const url = new URL(href);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// Source positions remain stable as the last token grows during streaming.
function sourceEntries<T>(values: T[], source: (value: T) => string) {
  let offset = 0;
  return values.map((value) => {
    const entry = { value, offset };
    offset += source(value).length + 1;
    return entry;
  });
}

function CodeSpan({ text, presentation }: { text: string; presentation: TextPresentation }) {
  return (
    <View
      collapsable={false}
      className={`max-w-full self-start rounded-xl bg-control px-1 ${presentation.type === "body-sm" ? "py-px" : "py-0.5"}`}
    >
      <Typography.Code
        selectable
        className={presentation.type === "body-sm" ? "bg-transparent p-0 text-xs leading-4" : "bg-transparent p-0"}
        style={{ ...presentation.style, color: presentation.codeColor }}
      >
        {text}
      </Typography.Code>
    </View>
  );
}

function AgentMention({ agent, presentation }: { agent: MobileAgent; presentation: TextPresentation }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View
      collapsable={false}
      className="max-w-full flex-row items-center gap-1 rounded-full bg-control/30 px-1.5"
      // Native inline views sit on the text baseline. Offset the text descender
      // so the name aligns with the surrounding text instead of sitting above it.
      style={{ transform: [{ translateY: presentation.mentionOffset }], borderCurve: "circular" }}
    >
      <BloubAvatarThumbnail
        hue={agent.avatarHue}
        seed={agent.avatarSeed}
        size={(presentation.type === "body-sm" ? 16 : 18) * fontScale}
      />
      <Typography type={presentation.type} style={presentation.style} className="shrink">
        {agent.name}
      </Typography>
    </View>
  );
}

function inline(tokens: Token[], parentPresentation: TextPresentation): ReactNode {
  return sourceEntries(tokens, (token) => token.raw).map(({ value: token, offset }) => {
    const presentation = { ...parentPresentation, animateTail: parentPresentation.animateTail };
    if (token.type === "agentMention") {
      const reference = chatTagReferences(token.raw)[0];
      const agent = presentation.agents.find((candidate) => candidate.id === reference?.id);
      if (!agent)
        return (
          <Typography
            key={offset}
            type={presentation.type}
            style={presentation.style}
          >{`@${reference?.name ?? "Agent"}`}</Typography>
        );
      return <AgentMention key={offset} agent={agent} presentation={presentation} />;
    }
    if (token.type === "br") return "\n";
    if (tokenIs(token, "text")) {
      if (token.tokens) return inline(token.tokens, presentation);
      return (
        <Fragment key={offset}>
          {sourceEntries(plainMentionParts(token.text, presentation.agents), (part) => part.text).map(
            ({ value: part, offset: partOffset }) =>
              part.agent ? (
                <AgentMention key={partOffset} agent={part.agent} presentation={presentation} />
              ) : (
                <StreamingTailText
                  key={partOffset}
                  body={part.text}
                  enabled={presentation.animateTail}
                  type={presentation.type}
                  style={presentation.style}
                />
              ),
          )}
        </Fragment>
      );
    }
    if (tokenIs(token, "escape")) return token.text;
    if (tokenIs(token, "codespan")) {
      return <CodeSpan key={offset} text={token.text} presentation={presentation} />;
    }
    if (tokenIs(token, "strong") || tokenIs(token, "em") || tokenIs(token, "del")) {
      const style: TextStyle = {
        ...presentation.style,
        ...(token.type === "strong"
          ? { fontWeight: "700" }
          : token.type === "em"
            ? { fontStyle: "italic" }
            : { textDecorationLine: "line-through" }),
      };
      return (
        <Typography key={offset} type={presentation.type} style={style}>
          {inline(token.tokens, { ...presentation, style })}
        </Typography>
      );
    }
    if (tokenIs(token, "link") || tokenIs(token, "image")) {
      const url = webLink(token.href);
      const label = tokenIs(token, "image")
        ? token.text || "Image"
        : inline(token.tokens, { ...presentation, agents: [] });
      if (!url) return <Fragment key={offset}>{label}</Fragment>;
      return (
        <Typography
          key={offset}
          type={presentation.type}
          style={{ ...presentation.style, textDecorationLine: "underline" }}
          accessibilityRole="link"
          accessibilityHint={url}
          onPress={() =>
            void Linking.openURL(url).catch(() =>
              Alert.alert("Couldn’t open link", "You can select and copy the link instead."),
            )
          }
        >
          {tokenIs(token, "link") ? (
            <>
              <ChatLinkIcon color={presentation.style.color} compact={presentation.type === "body-sm"} />
              {"\u00a0"}
            </>
          ) : null}
          {label}
        </Typography>
      );
    }
    // HTML remains inert text; Markdown images are opened only after an explicit tap.
    return token.raw;
  });
}

function ListParagraph({ tokens, presentation }: { tokens: Token[]; presentation: TextPresentation }) {
  const lines: Token[][][] = [[[]]];
  for (const token of tokens) {
    const line = lines[lines.length - 1];
    if (token.type === "br") {
      lines.push([[]]);
    } else if (tokenIs(token, "codespan")) {
      line.push([token], []);
    } else {
      line[line.length - 1].push(token);
    }
  }
  const source = (run: Token[]) => run.map((token) => token.raw).join("");
  return (
    <View className="min-w-0 gap-1">
      {sourceEntries(lines, (line) => line.map(source).join("")).map(({ value: line, offset: lineOffset }) => (
        // Multiline chips must participate in flex layout, not sit inside a fixed-height native text line.
        <View key={lineOffset} className="min-w-0 flex-row flex-wrap items-center gap-y-1">
          {sourceEntries(line, source).map(({ value: run, offset }) => {
            if (!run.length) return null;
            const token = run[0];
            if (tokenIs(token, "codespan")) {
              return <CodeSpan key={offset} text={token.text} presentation={presentation} />;
            }
            return (
              <Typography
                key={offset}
                selectable
                className="max-w-full"
                type={presentation.type}
                style={textContainerStyle(source(run), presentation)}
              >
                {inline(run, {
                  ...presentation,
                  animateTail: presentation.animateTail,
                })}
              </Typography>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function MarkdownBlocks({
  tokens,
  presentation: parentPresentation,
  inList = false,
}: {
  tokens: Token[];
  presentation: TextPresentation;
  inList?: boolean;
}) {
  return (
    <View className="min-w-0 gap-3">
      {sourceEntries(tokens, (token) => token.raw).map(({ value: token, offset }) => {
        const presentation = {
          ...parentPresentation,
          animateTail: parentPresentation.animateTail,
        };
        if (token.type === "space" || token.type === "def") return null;
        if (tokenIs(token, "paragraph") || tokenIs(token, "text")) {
          if (inList && token.tokens?.some((child) => tokenIs(child, "codespan"))) {
            return <ListParagraph key={offset} tokens={token.tokens} presentation={presentation} />;
          }
          return (
            <Typography
              key={offset}
              selectable
              type={presentation.type}
              style={textContainerStyle(token.raw, presentation)}
            >
              {token.tokens ? inline(token.tokens, presentation) : token.text}
            </Typography>
          );
        }
        if (tokenIs(token, "heading")) {
          const heading: TextPresentation = { ...presentation, type: token.depth <= 2 ? "h4" : "h5" };
          return (
            <Typography.Heading
              key={offset}
              selectable
              type={heading.type === "h4" ? "h4" : "h5"}
              style={textContainerStyle(token.raw, presentation)}
            >
              {inline(token.tokens, heading)}
            </Typography.Heading>
          );
        }
        if (tokenIs(token, "code")) {
          return (
            <StreamingBlock key={offset} enabled={presentation.animateTail}>
              <ChatCodeBlock text={token.text} language={token.lang} />
            </StreamingBlock>
          );
        }
        if (tokenIs(token, "blockquote")) {
          return (
            <View key={offset} className="border-l-2 border-separator pl-3">
              <MarkdownBlocks tokens={token.tokens} presentation={presentation} inList={inList} />
            </View>
          );
        }
        if (tokenIs(token, "list")) {
          return (
            <View key={offset} className="gap-2">
              {sourceEntries(token.items, (item) => item.raw).map(({ value: item, offset: itemOffset }, itemIndex) => (
                <View key={itemOffset} className="flex-row items-start gap-2">
                  <Typography type={presentation.type} style={presentation.style}>
                    {item.task
                      ? item.checked
                        ? "☑"
                        : "☐"
                      : token.ordered
                        ? `${Number(token.start) + itemIndex}.`
                        : "•"}
                  </Typography>
                  <View className="min-w-0 shrink">
                    <MarkdownBlocks
                      tokens={item.tokens}
                      inList
                      presentation={{
                        ...presentation,
                        animateTail: presentation.animateTail,
                      }}
                    />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        if (tokenIs(token, "table")) {
          return (
            <ScrollView key={offset} horizontal alwaysBounceHorizontal={false} style={{ flexGrow: 0, flexShrink: 0 }}>
              <View>
                {sourceEntries([token.header, ...token.rows], (row) => row.map((cell) => cell.text).join("|")).map(
                  ({ value: row, offset: rowOffset }) => (
                    <View key={rowOffset} className="flex-row border-b border-separator">
                      {sourceEntries(row, (cell) => cell.text).map(({ value: cell, offset: cellOffset }) => (
                        <View key={cellOffset} className="w-44 px-2 py-2">
                          <Typography
                            selectable
                            type={presentation.type}
                            style={{
                              ...textContainerStyle(cell.text, presentation),
                              textAlign: cell.align ?? "left",
                              fontWeight: cell.header ? "600" : "400",
                            }}
                          >
                            {inline(cell.tokens, {
                              ...presentation,
                              animateTail: presentation.animateTail,
                            })}
                          </Typography>
                        </View>
                      ))}
                    </View>
                  ),
                )}
              </View>
            </ScrollView>
          );
        }
        if (token.type === "hr") return <View key={offset} className="h-px bg-separator" />;
        return (
          <Typography key={offset} selectable type={presentation.type} style={presentation.style}>
            {token.raw}
          </Typography>
        );
      })}
    </View>
  );
}

export const ChatMarkdown = memo(function ChatMarkdown({
  body,
  color,
  compact = false,
  streaming = false,
  animationEnabled = true,
  agents = [],
}: {
  body: string;
  color: ColorValue | undefined;
  compact?: boolean;
  streaming?: boolean;
  animationEnabled?: boolean;
  agents?: readonly MobileAgent[];
}) {
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const tokens = useMemo(() => parseChatMarkdown(body), [body]);
  const codeColor = useThemeColor("foreground");
  return (
    <StreamRevealProvider>
      <MarkdownBlocks
        tokens={tokens}
        presentation={{
          type: compact ? "body-sm" : "body",
          style: { color: color ?? codeColor },
          codeColor,
          agents,
          mentionOffset: 4 * fontScale,
          animateTail: streaming && animationEnabled && !reducedMotion,
        }}
      />
    </StreamRevealProvider>
  );
});
