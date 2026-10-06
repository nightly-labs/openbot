import {
  type FileReferenceTone,
  fileReferenceBadge,
  fileReferenceName,
  fileReferenceTone,
  isFileReference,
} from "@openbot/brand/file-reference";
import { chatMathStart } from "@openbot/contracts/chat-math";
import { chatPreviewKind } from "@openbot/contracts/chat-preview";
import { chatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import * as Linking from "expo-linking";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { FileText } from "lucide-react-native";
import type { Token, Tokens } from "marked";
import { Fragment, memo, type ReactNode, useMemo } from "react";
import { Alert, type ColorValue, ScrollView, type TextStyle, useWindowDimensions, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { ChatLinkIcon } from "@/features/chat/components/chat-link-icon";
import {
  StreamingBlock,
  StreamingTailText,
  StreamRevealProvider,
} from "@/features/chat/components/streaming-tail-text";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { parseChatMarkdown } from "../model/chat-markdown-parser";
import { plainMentionParts } from "../model/chat-mentions";
import { createReplyReveal } from "../model/reply-reveal";
import { ChatCodeBlock } from "./chat-code-block";
import { ChatCodePreview } from "./chat-code-preview";
import { ChatMath } from "./chat-math";
import { type ReplyPlayback, useReplyPlayback } from "./use-reply-playback";

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
  blockMath: MathToken;
  inlineMath: MathToken;
}

interface MathToken extends Tokens.Generic {
  type: "blockMath" | "inlineMath";
  text: string;
  display: boolean;
}

// Marked's public Token union includes extension tokens; narrow its built-in tokens here.
// Keeps the link icon on the same line as the first word of the link.
const NO_BREAK_SPACE = "\u00a0";

function tokenIs<K extends keyof MarkdownTokenByType>(token: Token, type: K): token is MarkdownTokenByType[K] {
  return token.type === type;
}

interface TextPresentation {
  selectable: boolean;
  type: "body" | "body-sm" | "h4" | "h5";
  style: TextStyle;
  codeColor: ColorValue;
  animateTail: boolean;
  /** The reply still streams, so a preview card shows code until its block is complete. */
  streaming: boolean;
  agents: readonly MobileAgent[];
  mentionOffset: number;
  fontScale: number;
  t: MobileTranslate;
}

/** The HeroUI font size of each text type, in points, which inline math is sized against. */
const TEXT_SIZES: Record<TextPresentation["type"], number> = { body: 16, "body-sm": 14, h4: 20, h5: 18 };

function textSize(presentation: TextPresentation): number {
  return TEXT_SIZES[presentation.type] * presentation.fontScale;
}

// The inline badge is shifted to align its label with native text. Reserve the
// same space in the owning text view so its last line does not clip the capsule.
function textContainerStyle(source: string, presentation: TextPresentation): TextStyle {
  const hasMention =
    chatTagReferences(source).some((reference) => reference.kind === "agent") ||
    plainMentionParts(source, presentation.agents).some((part) => part.agent);
  // Inline math is moved down to the math axis in the same way.
  const hasMath = chatMathStart(source) !== undefined;
  return hasMention || hasMath
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

/** The colour family of each file tone, as the desktop `data-file-tone` rules use them. */
const FILE_TONE_COLORS: Record<FileReferenceTone, [string, string]> = {
  source: ["--openbot-file-blue", "--openbot-file-blue-soft"],
  script: ["--openbot-file-yellow", "--openbot-file-yellow-soft"],
  markup: ["--openbot-file-orange", "--openbot-file-orange-soft"],
  style: ["--openbot-file-teal", "--openbot-file-teal-soft"],
  data: ["--openbot-file-green", "--openbot-file-green-soft"],
  document: ["--openbot-file-red", "--openbot-file-red-soft"],
  media: ["--openbot-file-pink", "--openbot-file-pink-soft"],
  default: ["--openbot-file-default", "--openbot-file-default-soft"],
};

/**
 * Inline code that names a file, drawn as the desktop file reference: a type badge and the name
 * in the colour of its file family. Mobile cannot open workspace files, so it is not a control.
 */
function FileReference({ text, presentation }: { text: string; presentation: TextPresentation }) {
  const name = fileReferenceName(text.trim());
  const badge = fileReferenceBadge(name);
  const [color, soft] = useCSSVariable(FILE_TONE_COLORS[fileReferenceTone(name)]);
  const small = presentation.type === "body-sm";
  return (
    <View collapsable={false} className="max-w-full shrink flex-row items-center gap-1 self-start px-0.5">
      <View
        className="h-4 min-w-4 items-center justify-center rounded px-0.5"
        style={{ backgroundColor: String(soft) }}
      >
        {badge ? (
          <Typography style={{ color: String(color), fontSize: 8, lineHeight: 10, fontWeight: "800" }}>
            {badge}
          </Typography>
        ) : (
          <FileText size={11} color={String(color)} strokeWidth={2} />
        )}
      </View>
      <Typography
        selectable={presentation.selectable}
        numberOfLines={1}
        type={small ? "body-xs" : presentation.type}
        className="shrink"
        style={{ ...presentation.style, color: String(color), fontWeight: "600" }}
      >
        {text.trim()}
      </Typography>
    </View>
  );
}

// A view cannot break across lines, so code is a row of one-line chips that touch. A line can break
// after a space or a separator, and a long run without one breaks after this many characters.
const CODE_PIECE_MAX_LENGTH = 12;

// Hermes may not have Intl.Segmenter. The fallback keeps flags, marks, skin tones and joined emoji whole.
const GRAPHEME_FALLBACK =
  /\p{Regional_Indicator}{2}|\P{M}[\p{M}\p{Emoji_Modifier}]*(?:\u200d\P{M}[\p{M}\p{Emoji_Modifier}]*)*/gu;

function graphemes(text: string): string[] {
  if (Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  }
  return text.match(GRAPHEME_FALLBACK) ?? [];
}

function codePieces(text: string): string[] {
  return (text.match(/[^\s\-/._]*(?:[\s\-/._]+|$)/gu) ?? []).flatMap((piece) => {
    const characters = graphemes(piece);
    if (!characters.length) return [];
    const chunks: string[] = [];
    for (let index = 0; index < characters.length; index += CODE_PIECE_MAX_LENGTH) {
      chunks.push(characters.slice(index, index + CODE_PIECE_MAX_LENGTH).join(""));
    }
    return chunks;
  });
}

function CodeSpan({ text, presentation }: { text: string; presentation: TextPresentation }) {
  if (isFileReference(text.trim())) return <FileReference text={text} presentation={presentation} />;
  const pieces = codePieces(text);
  return sourceEntries(pieces, (piece) => piece).map(({ value: piece, offset }, index) => (
    // Only the ends of the span are rounded, so touching pieces read as one chip.
    <View
      key={offset}
      collapsable={false}
      className={`max-w-full self-start bg-control ${index === 0 ? "rounded-l-xl pl-1" : ""} ${index === pieces.length - 1 ? "rounded-r-xl pr-1" : ""} ${presentation.type === "body-sm" ? "py-px" : "py-0.5"}`}
    >
      <Typography.Code
        selectable={presentation.selectable}
        numberOfLines={1}
        className={presentation.type === "body-sm" ? "bg-transparent p-0 text-xs leading-4" : "bg-transparent p-0"}
        style={{ ...presentation.style, color: presentation.codeColor }}
      >
        {piece}
      </Typography.Code>
    </View>
  ));
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
        agentId={agent.id}
        serverId={agent.serverId}
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
    // The list row draws the task mark, so the checkbox token adds nothing.
    if (token.type === "checkbox") return null;
    if (tokenIs(token, "inlineMath")) {
      return (
        <ChatMath
          key={offset}
          tex={token.text}
          display={token.display}
          block={false}
          textSize={textSize(presentation)}
          color={presentation.style.color}
          fallback={<CodeSpan text={token.raw} presentation={presentation} />}
        />
      );
    }
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
        ? token.text || presentation.t("mobile.chat.markdown.image")
        : inline(token.tokens, { ...presentation, agents: [] });
      if (!url) return <Fragment key={offset}>{label}</Fragment>;
      return (
        <Typography
          key={offset}
          type={presentation.type}
          style={{ ...presentation.style, textDecorationLine: "underline" }}
          accessibilityRole="link"
          accessibilityHint={url}
          onPress={() => {
            void haptics.impact("soft");
            void Linking.openURL(url).catch(() => {
              void haptics.notification("error");
              const { t } = currentText();
              Alert.alert(t("mobile.chat.markdown.linkFailedTitle"), t("mobile.chat.markdown.linkFailedMessage"));
            });
          }}
        >
          {tokenIs(token, "link") ? (
            <>
              <ChatLinkIcon color={presentation.style.color} compact={presentation.type === "body-sm"} />
              {NO_BREAK_SPACE}
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
  let run: Token[] = [];
  let line: Token[][] = [run];
  const lines: Token[][][] = [line];
  for (const token of tokens) {
    if (token.type === "checkbox") continue;
    if (token.type === "br") {
      run = [];
      line = [run];
      lines.push(line);
    } else if (tokenIs(token, "codespan")) {
      run = [];
      line.push([token], run);
    } else if (tokenIs(token, "text") && !token.tokens) {
      // One run per word: the row wraps its items, so a long run would leave the line beside the
      // chip and start below it, instead of continuing after it as text does.
      for (const word of token.text.split(/(?<=\s)/u)) {
        if (run.length) {
          run = [];
          line.push(run);
        }
        run.push({ type: "text", raw: word, text: word, escaped: false });
      }
      run = [];
      line.push(run);
    } else {
      run.push(token);
    }
  }
  const source = (run: Token[]) => run.map((token) => token.raw).join("");
  return (
    <View className="min-w-0 gap-1">
      {sourceEntries(lines, (line) => line.map(source).join("")).map(({ value: line, offset: lineOffset }) => (
        // Multiline chips must participate in flex layout, not sit inside a fixed-height native text line.
        <View key={lineOffset} className="min-w-0 flex-row flex-wrap items-center gap-y-1">
          {sourceEntries(line, source).map(({ value: run, offset }) => {
            const [token] = run;
            if (!token) return null;
            if (tokenIs(token, "codespan")) {
              return <CodeSpan key={offset} text={token.text} presentation={presentation} />;
            }
            return (
              <Typography
                key={offset}
                selectable={presentation.selectable}
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
        // The list row draws the task mark, so the checkbox token adds nothing.
        if (token.type === "space" || token.type === "def" || token.type === "checkbox") return null;
        if (tokenIs(token, "paragraph") || tokenIs(token, "text")) {
          if (inList && token.tokens?.some((child) => tokenIs(child, "codespan"))) {
            return <ListParagraph key={offset} tokens={token.tokens} presentation={presentation} />;
          }
          return (
            <Typography
              key={offset}
              selectable={presentation.selectable}
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
              selectable={presentation.selectable}
              type={heading.type === "h4" ? "h4" : "h5"}
              style={textContainerStyle(token.raw, presentation)}
            >
              {inline(token.tokens, heading)}
            </Typography.Heading>
          );
        }
        if (tokenIs(token, "blockMath") || (tokenIs(token, "code") && token.lang?.trim().toLowerCase() === "math")) {
          return (
            <StreamingBlock key={offset} enabled={presentation.animateTail}>
              <ChatMath
                tex={token.text}
                display
                block
                textSize={textSize(presentation)}
                color={presentation.style.color}
                fallback={<ChatCodeBlock selectable={presentation.selectable} text={token.text} language="latex" />}
              />
            </StreamingBlock>
          );
        }
        if (tokenIs(token, "code")) {
          const preview = chatPreviewKind(token.lang);
          return (
            <StreamingBlock key={offset} enabled={presentation.animateTail}>
              {preview ? (
                <ChatCodePreview
                  kind={preview}
                  text={token.text}
                  language={token.lang}
                  streaming={presentation.streaming}
                />
              ) : (
                <ChatCodeBlock selectable={presentation.selectable} text={token.text} language={token.lang} />
              )}
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
                            selectable={presentation.selectable}
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
          <Typography
            key={offset}
            selectable={presentation.selectable}
            type={presentation.type}
            style={presentation.style}
          >
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
  playback,
  selectable = true,
  agents = [],
}: {
  body: string;
  color: ColorValue | undefined;
  compact?: boolean;
  streaming?: boolean;
  animationEnabled?: boolean;
  playback?: ReplyPlayback;
  selectable?: boolean;
  agents?: readonly MobileAgent[];
}) {
  const reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const tokens = useMemo(() => parseChatMarkdown(body), [body]);
  const reveal = useMemo(() => createReplyReveal(tokens), [tokens]);
  const visibleTokens = useReplyPlayback(reveal, playback);
  const codeColor = useThemeColor("foreground");
  const { t } = useText();
  return (
    <StreamRevealProvider>
      <MarkdownBlocks
        tokens={visibleTokens}
        presentation={{
          selectable,
          type: compact ? "body-sm" : "body",
          style: { color: color ?? codeColor },
          codeColor,
          agents,
          mentionOffset: 4 * fontScale,
          fontScale,
          t,
          streaming,
          animateTail: (streaming || Boolean(playback?.enabled)) && animationEnabled && !reducedMotion,
        }}
      />
    </StreamRevealProvider>
  );
});
