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
import { markdownInlinePlainText } from "@openbot/contracts/markdown-preview-text";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Blocks from "lucide-react-native/icons/blocks";
import Check from "lucide-react-native/icons/check";
import Copy from "lucide-react-native/icons/copy";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Sparkles from "lucide-react-native/icons/sparkles";
import type { Token, Tokens } from "marked";
import { Fragment, memo, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  type ColorValue,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { useCSSVariable } from "uniwind";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { ChatLinkIcon } from "@/features/chat/components/chat-link-icon";
import {
  StreamingBlock,
  StreamingTailText,
  StreamRevealProvider,
} from "@/features/chat/components/streaming-tail-text";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useFontScale } from "@/shared/lib/font-scale";
import { graphemes } from "@/shared/lib/graphemes";
import { haptics } from "@/shared/lib/haptics";
import { useMotionPreference } from "@/shared/lib/motion";
import { currentText, useText } from "@/shared/lib/text";
import {
  type DirectionMark,
  directionMark,
  layoutDirection,
  type TextDirection,
  textDirection,
  textDirectionStyle,
} from "@/shared/lib/text-direction";
import type { BubbleTone } from "../model/bubble-tone";
import {
  parseFinishedChatMarkdown,
  parseInlineChatMarkdown,
  parseStreamingChatMarkdown,
} from "../model/chat-markdown-parser";
import { plainMentionParts } from "../model/chat-mentions";
import { createReplyReveal, finishedReplyReveal } from "../model/reply-reveal";
import { tableCsv } from "../model/table-copy";
import { ChatCodeBlock } from "./chat-code-block";
import { ChatCodePreview } from "./chat-code-preview";
import { useOpenMessageFile } from "./chat-file-actions";
import { ChatMath } from "./chat-math";
import { useOpenTaggedTab } from "./chat-tag-actions";
import { CHAT_CODE_STYLES, CHAT_HEADING_RAMP, CHAT_TEXT_STYLES, type ChatTextType } from "./chat-text-styles";
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
  type: ChatTextType;
  style: TextStyle;
  codeColor: ColorValue;
  animateTail: boolean;
  /** The reply still streams, so a preview card shows code until its block is complete. */
  streaming: boolean;
  /** The text will not change, so a code block can keep its highlight for the app run. */
  finished: boolean;
  agents: readonly MobileAgent[];
  mentionOffset: number;
  fontScale: number;
  t: MobileTranslate;
  linkFavicons: boolean;
  /** The layout direction of the view that holds the block. A list item or a quote can change it. */
  direction: TextDirection;
  /** The colors of code in a bubble with a message color. */
  tone: BubbleTone | undefined;
  /**
   * The background of a mention chip: the chip color of a message color, or else a clear layer of
   * the text color, which shows on the screen and on an agent's bubble. The grey of a control was the
   * color of the agent's bubble.
   */
  chipBackground: string;
  /** A table at the top level stands out of the bubble, so its card takes the color of a bubble. */
  outside: boolean;
  /** Lays the card of a table out of the bubble on the color of the bubble. The copy actions stay under it. */
  tableFrame: ((card: ReactNode) => ReactNode) | undefined;
  /** The side of the message: the copy actions of a table go to it. */
  align: "start" | "end";
}

/** Each block reads in the direction of its own first letter, in an app of either direction. */
function blockDirectionStyle(source: string, presentation: TextPresentation): TextStyle {
  return textDirectionStyle(textDirection(source, presentation.direction), presentation.direction);
}

/** The mark that gives an Android block the direction of `blockDirectionStyle`. */
function blockDirectionMark(source: string, presentation: TextPresentation): DirectionMark {
  return directionMark(source, textDirection(source, presentation.direction));
}

/**
 * The `textAlign` of a table cell in a view of the table's direction. Markdown left and right are
 * sides of the screen, but React Native swaps them in a right-to-left view. A column with no
 * alignment starts at the start of the table, so all its cells line up.
 */
function cellAlignment(
  align: "left" | "center" | "right" | null | undefined,
  table: TextDirection,
): TextStyle["textAlign"] {
  if (align === "center") return "center";
  if (!align) return "left";
  return (align === "left") === (table === "ltr") ? "left" : "right";
}

/** The presentation of the blocks in a list item or a quote that has its own direction. */
function withDirection(presentation: TextPresentation, direction: TextDirection): TextPresentation {
  return direction === presentation.direction ? presentation : { ...presentation, direction };
}

/** The font size of a text type, in points, which inline math is sized against. */
function textSize(presentation: TextPresentation): number {
  return CHAT_TEXT_STYLES[presentation.type].fontSize * presentation.fontScale;
}

// The inline badge is shifted to align its label with native text. Reserve the
// same space in the owning text view so its last line does not clip the capsule.
function textContainerStyle(source: string, presentation: TextPresentation): TextStyle {
  const hasMention =
    chatTagReferences(source).some(
      (reference) =>
        reference.kind === "agent" ||
        reference.kind === "skill" ||
        reference.kind === "mcp" ||
        reference.kind === "tab",
    ) || plainMentionParts(source, presentation.agents).some((part) => part.agent);
  // Inline math is moved down to the math axis in the same way.
  const hasMath = chatMathStart(source) !== undefined;
  // Code chips move down as well; see `inlineChipStyle`.
  const hasChip = source.includes("`");
  return hasMention || hasMath || hasChip
    ? { ...presentation.style, paddingBottom: presentation.mentionOffset, overflow: "visible" }
    : presentation.style;
}

/**
 * The line of an inline code chip: as tall as its letters, not as the line of code, so the chip does
 * not touch the chips on the lines above and below it. A mention chip has the same rule.
 */
function codeChipLineHeight(presentation: TextPresentation): number {
  return Math.round(CHAT_CODE_STYLES[presentation.type === "body-sm" ? "small" : "body"].fontSize * 1.2);
}

/** The height of an inline code chip: its line and one point above and below. */
function codeChipHeight(presentation: TextPresentation): number {
  return codeChipLineHeight(presentation) + 2;
}

/**
 * A view inside text sits with its bottom edge on the text baseline, so a chip sits too high. It
 * moves down until its middle is on the middle of the letters around it, as a mention does. A chip
 * in a wrapping row is centred by the row and does not move.
 */
function inlineChipStyle(presentation: TextPresentation, height: number, inRow: boolean): ViewStyle | undefined {
  if (inRow) return undefined;
  return {
    transform: [
      { translateY: (height / 2 - CHAT_TEXT_STYLES[presentation.type].fontSize * 0.45) * presentation.fontScale },
    ],
  };
}

/** Joins the type badge of a file to the first characters of its name, so a line never ends between them. */
const WORD_JOINER = "\u2060";

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
 * in the colour of its file family. In a chat message, a tap opens the file, as on desktop.
 */
function FileReference({
  text,
  presentation,
  inRow,
}: {
  text: string;
  presentation: TextPresentation;
  inRow: boolean;
}) {
  const name = fileReferenceName(text.trim());
  const [color, soft] = useCSSVariable(FILE_TONE_COLORS[fileReferenceTone(name)]);
  const open = useOpenMessageFile()?.(text);
  const small = presentation.type === "body-sm";
  // A chip that opens nothing stays a view, so it does not take the touch from the message.
  const Chip = open ? Pressable : View;
  const control = open
    ? {
        accessibilityRole: "button" as const,
        accessibilityLabel: presentation.t("mobile.chat.markdown.openFile", { name }),
        onPress: open,
      }
    : null;
  if (Platform.OS === "android") {
    // Android does not move a view that is wider than the rest of the line to the next line, so a long
    // path was cut at the edge of the message. Only the small badge is a view; the name is text of the
    // paragraph and wraps as text does.
    return (
      <>
        {/* The name is the one button that a screen reader finds; the badge only takes the tap. */}
        <Chip
          collapsable={false}
          className="pl-0.5 pr-1"
          style={{ transform: [{ translateY: presentation.mentionOffset }] }}
          accessible={false}
          {...(control ? { onPress: control.onPress } : null)}
        >
          <FileBadge name={name} color={String(color)} soft={String(soft)} />
        </Chip>
        <Text style={{ color: String(color), fontWeight: "600", ...(small ? { fontSize: 12 } : null) }} {...control}>
          {`${WORD_JOINER}${text.trim()}`}
        </Text>
      </>
    );
  }
  return (
    <Chip
      collapsable={false}
      className="max-w-full shrink flex-row items-center gap-1 self-start px-0.5"
      style={inlineChipStyle(presentation, small ? 16 : CHAT_TEXT_STYLES[presentation.type].lineHeight, inRow)}
      {...control}
    >
      <FileBadge name={name} color={String(color)} soft={String(soft)} />
      <Text
        selectable={presentation.selectable}
        numberOfLines={1}
        style={[
          CHAT_TEXT_STYLES[presentation.type],
          small ? { fontSize: 12, lineHeight: 16 } : null,
          presentation.style,
          { flexShrink: 1, color: String(color), fontWeight: "600" },
        ]}
      >
        {text.trim()}
      </Text>
    </Chip>
  );
}

/** The type of a file, as two or three letters or a document icon, on the soft colour of its family. */
function FileBadge({ name, color, soft }: { name: string; color: string; soft: string }) {
  const badge = fileReferenceBadge(name);
  return (
    <View className="h-4 min-w-4 items-center justify-center rounded px-0.5" style={{ backgroundColor: soft }}>
      {badge ? (
        <Text style={[CHAT_TEXT_STYLES["body-sm"], { color, fontSize: 8, lineHeight: 10, fontWeight: "800" }]}>
          {badge}
        </Text>
      ) : (
        <FileText size={11} color={color} strokeWidth={2} />
      )}
    </View>
  );
}

// A view cannot break across lines, so code is a row of one-line chips that touch. A line can break
// after a space or a separator, and a long run without one breaks after this many characters.
const CODE_PIECE_MAX_LENGTH = 12;

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

function CodeSpan({
  text,
  presentation,
  inRow = false,
}: {
  text: string;
  presentation: TextPresentation;
  /** The chip is an item of a wrapping row, not a view inside text. */
  inRow?: boolean;
}) {
  if (isFileReference(text.trim())) return <FileReference text={text} presentation={presentation} inRow={inRow} />;
  const pieces = codePieces(text);
  const chipStyle = inlineChipStyle(presentation, codeChipHeight(presentation), inRow);
  return sourceEntries(pieces, (piece) => piece).map(({ value: piece, offset }, index) => (
    // Only the ends of the span are rounded, so touching pieces read as one chip.
    <View
      key={offset}
      collapsable={false}
      className={`max-w-full self-start py-px ${presentation.tone ? "" : "bg-control"} ${index === 0 ? "rounded-l-xl pl-1" : ""} ${index === pieces.length - 1 ? "rounded-r-xl pr-1" : ""}`}
      style={[chipStyle, presentation.tone ? { backgroundColor: presentation.tone.panel } : undefined]}
    >
      <Text
        selectable={presentation.selectable}
        numberOfLines={1}
        style={[
          presentation.style,
          CHAT_CODE_STYLES[presentation.type === "body-sm" ? "small" : "body"],
          { color: presentation.codeColor, lineHeight: codeChipLineHeight(presentation) },
        ]}
      >
        {piece}
      </Text>
    </View>
  ));
}

/**
 * The size of a mention chip: as tall as its letters, not as the line, so it does not push the line
 * apart. The label is one point smaller than the text. Native inline views sit on the baseline with
 * their bottom edge, so the chip moves down until it is centred on the letters around it.
 */
function mentionChip(presentation: TextPresentation) {
  const size = CHAT_TEXT_STYLES[presentation.type].fontSize - 1;
  const lineHeight = Math.round(size * 1.25);
  const padding = 1;
  // The chip's middle goes on the middle of the letters around it, a little under half the text size
  // above their baseline (set on a device); the chip's bottom edge starts on that baseline.
  const below = (lineHeight + padding * 2) / 2 - CHAT_TEXT_STYLES[presentation.type].fontSize * 0.45;
  return {
    label: [CHAT_TEXT_STYLES[presentation.type], presentation.style, { fontSize: size, lineHeight, flexShrink: 1 }],
    mark: (size + 1) * presentation.fontScale,
    className: "max-w-full flex-row items-center gap-1 rounded-full pr-1.5 pl-1",
    style: {
      paddingVertical: padding * presentation.fontScale,
      transform: [{ translateY: below * presentation.fontScale }],
      borderCurve: "circular" as const,
      backgroundColor: presentation.chipBackground,
    },
  };
}

function AgentMention({ agent, presentation }: { agent: MobileAgent; presentation: TextPresentation }) {
  const chip = mentionChip(presentation);
  return (
    <View collapsable={false} className={chip.className} style={chip.style}>
      <BloubAvatarThumbnail
        agentId={agent.id}
        serverId={agent.serverId}
        hue={agent.avatarHue}
        color={agent.avatarColor}
        seed={agent.avatarSeed}
        size={chip.mark}
      />
      <Text style={chip.label}>{agent.name}</Text>
    </View>
  );
}

/**
 * A skill or an app that a message names: the same chip as an agent mention, with the skill or app mark
 * for the avatar, as the desktop chip has.
 */
function SkillMention({ name, app, presentation }: { name: string; app: boolean; presentation: TextPresentation }) {
  const Mark = app ? Blocks : Sparkles;
  const chip = mentionChip(presentation);
  return (
    <View collapsable={false} className={chip.className} style={chip.style}>
      <Mark
        color={presentation.style.color === undefined ? undefined : String(presentation.style.color)}
        size={chip.mark - 2 * presentation.fontScale}
        strokeWidth={2}
      />
      <Text style={chip.label}>{name}</Text>
    </View>
  );
}

/**
 * A browser tab that a message tags: the same chip as a skill, with the globe mark. Where the phone
 * can show the host's browser, a tap opens the tab, as a click on the desktop chip does.
 */
function TabMention({ id, name, presentation }: { id: string; name: string; presentation: TextPresentation }) {
  const openTab = useOpenTaggedTab();
  const chip = mentionChip(presentation);
  const content = (
    <>
      <Globe
        color={presentation.style.color === undefined ? undefined : String(presentation.style.color)}
        size={chip.mark - 2 * presentation.fontScale}
        strokeWidth={2}
      />
      <Text style={chip.label}>{name}</Text>
    </>
  );
  const { className } = chip;
  if (!openTab)
    return (
      <View collapsable={false} className={className} style={chip.style}>
        {content}
      </View>
    );
  return (
    <Pressable
      collapsable={false}
      className={className}
      style={chip.style}
      accessibilityRole="button"
      accessibilityLabel={presentation.t("mobile.chat.markdown.openBrowserTab", { name })}
      onPress={() => openTab(id)}
    >
      {content}
    </Pressable>
  );
}

function openMessageLink(url: string): void {
  void haptics.impact("soft");
  void Linking.openURL(url).catch((error: unknown) => {
    void haptics.notification("error");
    const { t } = currentText();
    showFailureAlert(
      error,
      "browser",
      t("mobile.chat.markdown.linkFailedTitle"),
      t("mobile.chat.markdown.linkFailedMessage"),
    );
  });
}

/**
 * The inline tokens of a block, always drawn inside the block's text. A nested text takes the size,
 * line height and font of the text around it, so a span needs only what it changes. It is a plain
 * native text span, not a HeroUI `Typography`: a long reply has hundreds of spans, and each
 * `Typography` adds four components and its class names to every row the chat mounts.
 */
function inline(tokens: Token[], parentPresentation: TextPresentation): ReactNode {
  return sourceEntries(tokens, (token) => token.raw).map(({ value: token, offset }) => {
    const presentation = { ...parentPresentation, animateTail: parentPresentation.animateTail };
    if (token.type === "agentMention") {
      const reference = chatTagReferences(token.raw)[0];
      const agent = presentation.agents.find((candidate) => candidate.id === reference?.id);
      if (!agent) return <Text key={offset} style={presentation.style}>{`@${reference?.name ?? "Agent"}`}</Text>;
      return <AgentMention key={offset} agent={agent} presentation={presentation} />;
    }
    if (token.type === "skillMention") {
      const reference = chatTagReferences(token.raw)[0];
      return (
        <SkillMention
          key={offset}
          name={reference?.name ?? ""}
          app={reference?.kind === "mcp"}
          presentation={presentation}
        />
      );
    }
    if (token.type === "tabMention") {
      const reference = chatTagReferences(token.raw)[0];
      return (
        <TabMention key={offset} id={reference?.id ?? ""} name={reference?.name ?? ""} presentation={presentation} />
      );
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
              ) : presentation.animateTail ? (
                <StreamingTailText
                  key={partOffset}
                  body={part.text}
                  enabled
                  type={presentation.type}
                  style={presentation.style}
                />
              ) : (
                // Text that does not animate is a plain string of the block's text.
                part.text
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
        <Text key={offset} style={style}>
          {inline(token.tokens, { ...presentation, style })}
        </Text>
      );
    }
    if (tokenIs(token, "link") || tokenIs(token, "image")) {
      const url = webLink(token.href);
      const label = tokenIs(token, "image")
        ? token.text || presentation.t("mobile.chat.markdown.image")
        : inline(token.tokens, { ...presentation, agents: [] });
      if (!url) return <Fragment key={offset}>{label}</Fragment>;
      const open = () => openMessageLink(url);
      return (
        <Text key={offset} style={presentation.style} accessibilityRole="link" accessibilityHint={url} onPress={open}>
          {tokenIs(token, "link") ? (
            <>
              <ChatLinkIcon
                url={url}
                favicon={presentation.linkFavicons}
                color={presentation.style.color}
                compact={presentation.type === "body-sm"}
              />
              {NO_BREAK_SPACE}
            </>
          ) : null}
          <Text style={{ ...presentation.style, textDecorationLine: "underline" }} onPress={open}>
            {label}
          </Text>
        </Text>
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
  // The words are items of a wrapping row, so the row runs in the direction of the paragraph.
  const direction = textDirection(source(tokens), presentation.direction);
  return (
    <View className="min-w-0 gap-1" style={{ direction }}>
      {sourceEntries(lines, (line) => line.map(source).join("")).map(({ value: line, offset: lineOffset }) => (
        // Multiline chips must participate in flex layout, not sit inside a fixed-height native text line.
        <View key={lineOffset} className="min-w-0 flex-row flex-wrap items-center gap-y-1">
          {sourceEntries(line, source).map(({ value: run, offset }) => {
            const [token] = run;
            if (!token) return null;
            if (tokenIs(token, "codespan")) {
              return <CodeSpan key={offset} text={token.text} presentation={presentation} inRow />;
            }
            return (
              <Text
                key={offset}
                selectable={presentation.selectable}
                style={[
                  CHAT_TEXT_STYLES[presentation.type],
                  textContainerStyle(source(run), presentation),
                  // The space after a word stays on the side of the next word.
                  textDirectionStyle(direction, direction),
                  { maxWidth: "100%" },
                ]}
              >
                {inline(run, {
                  ...presentation,
                  animateTail: presentation.animateTail,
                })}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/**
 * The narrowest and the widest column. A column is as wide as its longest text in these limits, so
 * a column of marks stays narrow and a long note wraps. The columns of a narrow table grow to fill
 * the card; a wide table scrolls sideways.
 */
const TABLE_COLUMN_MIN_WIDTH = 56;
const TABLE_COLUMN_MAX_WIDTH = 240;
/** The horizontal padding of a cell, both sides. */
const TABLE_CELL_PADDING = 24;
/** The mean width of a character, as a part of the font size. */
const TABLE_CHARACTER_WIDTH = 0.55;
/** The space between the edge of the table card and its panel of rows. */
const TABLE_INSET = 3;

/** A colour with the alpha of an `#rrggbb` suffix. Other colour forms stay as they are. */
function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/iu.test(color) ? `${color}${alpha}` : color;
}

/**
 * A table as the desktop data table: a card with the header row on it in muted text, and the rows on
 * an inset panel with a line between them. In a bubble with a message color, the text keeps the
 * bubble's colors.
 */
function MarkdownTable({ token, presentation }: { token: Tokens.Table; presentation: TextPresentation }) {
  const [canvas, textColor = "", control = "", headerText, text] = useCSSVariable([
    "--openbot-bg-native-canvas",
    "--openbot-text-primary",
    "--openbot-bg-control",
    "--openbot-data-table-header-text",
    "--openbot-data-table-text",
  ]).map((value) => (value === undefined ? "" : String(value)));
  const { tone } = presentation;
  // The card has the background of a code block, and the lines between the rows have its color.
  // The rows are on the darker canvas. A message color gives its own surfaces; see `BubbleTone`.
  // Out of a bubble, the card is the bubble: the message color under it shows through, or else it has
  // the grey of a bubble.
  const card = presentation.outside
    ? tone
      ? "transparent"
      : withAlpha(control, "99")
    : (tone?.panel ?? withAlpha(textColor, "0f"));
  const rowsBackground = tone?.deep ?? canvas;
  const rowLine = tone?.line ?? card;
  const [frameWidth, setFrameWidth] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const characterWidth = CHAT_TEXT_STYLES[presentation.type].fontSize * presentation.fontScale * TABLE_CHARACTER_WIDTH;
  const contentWidths = useMemo(
    () =>
      token.header.map((_, column) => {
        const longest = Math.max(
          ...[token.header, ...token.rows].map((row) => graphemes(row[column]?.text ?? "").length),
        );
        return Math.min(
          TABLE_COLUMN_MAX_WIDTH,
          Math.max(TABLE_COLUMN_MIN_WIDTH, longest * characterWidth + TABLE_CELL_PADDING),
        );
      }),
    [token, characterWidth],
  );
  // The rows are inset by `TABLE_INSET` on each side.
  const contentTotal = contentWidths.reduce((total, width) => total + width, 0);
  const grow = Math.max(1, (frameWidth - TABLE_INSET * 2) / Math.max(1, contentTotal));
  // The columns run in the direction of the header, so an English table in an Arabic chat keeps
  // its first column at the left. Each cell reads in the direction of its own text.
  const tableDirection = textDirection(token.header.map((cell) => cell.text).join(" "), presentation.direction);
  const cellPresentation = withDirection(presentation, tableDirection);
  const header = { ...cellPresentation, style: { ...cellPresentation.style, color: tone?.muted ?? headerText } };
  const body = { ...cellPresentation, style: { ...cellPresentation.style, color: tone?.foreground ?? text } };
  const cell = (item: Tokens.TableCell, offset: number, column: number, rowPresentation: TextPresentation) => (
    <View
      key={offset}
      className={rowPresentation === header ? "px-3 py-2" : "px-3 py-3"}
      style={{ width: (contentWidths[column] ?? TABLE_COLUMN_MIN_WIDTH) * grow }}
    >
      <Text
        selectable={presentation.selectable}
        style={[
          CHAT_TEXT_STYLES[presentation.type],
          textContainerStyle(item.text, rowPresentation),
          {
            writingDirection: textDirection(item.text, tableDirection),
            textAlign: cellAlignment(item.align, tableDirection),
          },
          { fontWeight: rowPresentation === header ? "500" : "400" },
        ]}
      >
        {blockDirectionMark(item.text, rowPresentation)}
        {inline(item.tokens, rowPresentation)}
      </Text>
    </View>
  );
  const tableCard = (
    <View
      onLayout={(event) => setFrameWidth(Math.floor(event.nativeEvent.layout.width))}
      style={{
        borderRadius: 16,
        borderCurve: "continuous",
        overflow: "hidden",
        backgroundColor: card,
      }}
    >
      {/* The panel of the rows stays in place under the content that scrolls, so the card always shows
          its four sides and the table does not look cut at the edge. */}
      {token.rows.length ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: headerHeight,
            start: TABLE_INSET,
            end: TABLE_INSET,
            bottom: TABLE_INSET,
            borderRadius: 13,
            borderCurve: "continuous",
            overflow: "hidden",
            // On a message color out of the bubble, the card has no layer, so the rows take both: they
            // have the color of the code panel of a code block.
            backgroundColor: presentation.outside && tone ? tone.panel : undefined,
          }}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: rowsBackground }]} />
        </View>
      ) : null}
      <ScrollView
        horizontal
        alwaysBounceHorizontal={false}
        style={{
          flexGrow: 0,
          flexShrink: 0,
          marginHorizontal: TABLE_INSET,
          marginBottom: token.rows.length ? TABLE_INSET : 0,
        }}
      >
        <View style={{ direction: tableDirection }}>
          <View className="flex-row" onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>
            {sourceEntries(token.header, (item) => item.text).map(({ value: item, offset }, column) =>
              cell(item, offset, column, header),
            )}
          </View>
          {sourceEntries(token.rows, (row) => row.map((item) => item.text).join("|")).map(
            ({ value: row, offset: rowOffset }, rowIndex) => (
              <View
                key={rowOffset}
                className="flex-row"
                style={{
                  borderBottomWidth: rowIndex < token.rows.length - 1 ? 1 : 0,
                  borderColor: rowLine,
                }}
              >
                {sourceEntries(row, (item) => item.text).map(({ value: item, offset }, column) =>
                  cell(item, offset, column, body),
                )}
              </View>
            ),
          )}
        </View>
      </ScrollView>
    </View>
  );
  return (
    <View>
      {presentation.tableFrame ? presentation.tableFrame(tableCard) : tableCard}
      <TableCopyActions
        token={token}
        color={presentation.outside ? undefined : tone?.muted}
        align={presentation.align}
      />
    </View>
  );
}

type TableCopyFormat = "markdown" | "csv";

/**
 * The copy actions under a table, as on desktop. Markdown keeps the source of the table; CSV is for a
 * spreadsheet, so it takes the text of each cell as it shows.
 */
function TableCopyActions({
  token,
  color,
  align,
}: {
  token: Tokens.Table;
  color: string | undefined;
  align: "start" | "end";
}) {
  const { t } = useText();
  const themeMuted = useThemeColor("muted");
  const iconColor = color ?? String(themeMuted);
  const [copied, setCopied] = useState<TableCopyFormat | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy(format: TableCopyFormat) {
    const text =
      format === "markdown"
        ? token.raw.trim()
        : tableCsv([token.header, ...token.rows].map((row) => row.map((cell) => markdownInlinePlainText(cell.text))));
    try {
      await Clipboard.setStringAsync(text);
      setCopied(format);
      void haptics.notification("success");
    } catch (error) {
      void haptics.notification("error");
      showFailureAlert(error, "turn", t("mobile.chat.table.copyFailed"), t("mobile.chat.copyFailedMessage"));
    }
  }
  const action = (format: TableCopyFormat, label: string) => {
    const Icon = copied === format ? Check : Copy;
    return (
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => void copy(format)}
        className="flex-row items-center gap-1"
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      >
        <Icon size={12} color={iconColor} />
        <Typography.Paragraph type="body-xs" className="text-muted" style={color ? { color } : undefined}>
          {copied === format ? t("common.copied") : label}
        </Typography.Paragraph>
      </Pressable>
    );
  };
  return (
    <View className={`flex-row flex-wrap gap-4 px-1 pt-1.5 ${align === "end" ? "justify-end" : "justify-start"}`}>
      {action("markdown", t("mobile.chat.table.copyMarkdown"))}
      {action("csv", t("mobile.chat.table.copyCsv"))}
    </View>
  );
}

function MarkdownBlocks({
  tokens,
  presentation,
  inList = false,
}: {
  tokens: Token[];
  presentation: TextPresentation;
  inList?: boolean;
}) {
  return (
    <View className={inList ? "min-w-0 gap-1.5" : "min-w-0 gap-2.5"}>
      {sourceEntries(tokens, (token) => token.raw).map(({ value: token, offset }) => (
        <MarkdownBlock key={offset} token={token} presentation={presentation} inList={inList} />
      ))}
    </View>
  );
}

const MarkdownBlock = memo(function MarkdownBlock({
  token,
  presentation,
  inList,
}: {
  token: Token;
  presentation: TextPresentation;
  inList: boolean;
}) {
  // The list row draws the task mark, so the checkbox token adds nothing.
  if (token.type === "space" || token.type === "def" || token.type === "checkbox") return null;
  if (tokenIs(token, "paragraph") || tokenIs(token, "text")) {
    // Android keeps code chips inside the paragraph's one text view. The wrapping row draws a
    // native text view for each word, which made long replies slow to scroll on Android.
    if (inList && Platform.OS !== "android" && token.tokens?.some((child) => tokenIs(child, "codespan"))) {
      return <ListParagraph tokens={token.tokens} presentation={presentation} />;
    }
    return (
      <Text
        selectable={presentation.selectable}
        style={[
          CHAT_TEXT_STYLES[presentation.type],
          textContainerStyle(token.raw, presentation),
          blockDirectionStyle(token.raw, presentation),
        ]}
      >
        {blockDirectionMark(token.raw, presentation)}
        {token.tokens ? inline(token.tokens, presentation) : token.text}
      </Text>
    );
  }
  if (tokenIs(token, "heading")) {
    const heading: TextPresentation = { ...presentation, type: token.depth <= 2 ? "h4" : "h5" };
    const level = heading.type === "h4" ? "h4" : "h5";
    return (
      <Text
        selectable={presentation.selectable}
        accessibilityRole="header"
        dynamicTypeRamp={CHAT_HEADING_RAMP[level]}
        style={[
          CHAT_TEXT_STYLES[level],
          textContainerStyle(token.raw, presentation),
          blockDirectionStyle(token.text, presentation),
        ]}
      >
        {blockDirectionMark(token.text, presentation)}
        {inline(token.tokens, heading)}
      </Text>
    );
  }
  if (tokenIs(token, "blockMath") || (tokenIs(token, "code") && token.lang?.trim().toLowerCase() === "math")) {
    return (
      <StreamingBlock enabled={presentation.animateTail}>
        <ChatMath
          tex={token.text}
          display
          block
          textSize={textSize(presentation)}
          color={presentation.style.color}
          fallback={
            <ChatCodeBlock
              selectable={presentation.selectable}
              text={token.text}
              language="latex"
              finished={presentation.finished}
              tone={presentation.tone}
            />
          }
        />
      </StreamingBlock>
    );
  }
  if (tokenIs(token, "code")) {
    const preview = chatPreviewKind(token.lang);
    return (
      <StreamingBlock enabled={presentation.animateTail}>
        {preview ? (
          <ChatCodePreview
            kind={preview}
            text={token.text}
            language={token.lang}
            streaming={presentation.streaming}
            tone={presentation.tone}
          />
        ) : (
          <ChatCodeBlock
            selectable={presentation.selectable}
            text={token.text}
            language={token.lang}
            finished={presentation.finished}
            tone={presentation.tone}
          />
        )}
      </StreamingBlock>
    );
  }
  if (tokenIs(token, "blockquote")) {
    // The line is at the start of the quote, so it moves to the right of a right-to-left quote. A
    // quote with no letter keeps the direction of the text around it.
    const direction = textDirection(token.text, presentation.direction);
    return (
      <View className="border-separator" style={{ direction, borderStartWidth: 2, paddingStart: 12 }}>
        <MarkdownBlocks tokens={token.tokens} presentation={withDirection(presentation, direction)} inList={inList} />
      </View>
    );
  }
  if (tokenIs(token, "list")) {
    // An item with no letter, such as a number, keeps the direction of the list, so its mark stays
    // on the side of the other marks.
    const listDirection = textDirection(token.raw, presentation.direction);
    return (
      <View className="gap-1.5">
        {sourceEntries(token.items, (item) => item.raw).map(({ value: item, offset: itemOffset }, itemIndex) => {
          // The mark is at the start of the item, so it moves to the right of a right-to-left item.
          const direction = textDirection(item.text, listDirection);
          return (
            <View key={itemOffset} className="flex-row items-start gap-2" style={{ direction }}>
              <Text
                style={[
                  CHAT_TEXT_STYLES[presentation.type],
                  presentation.style,
                  textDirectionStyle(direction, direction),
                ]}
              >
                {item.task ? (item.checked ? "☑" : "☐") : token.ordered ? `${Number(token.start) + itemIndex}.` : "•"}
              </Text>
              <View className="min-w-0 shrink">
                <MarkdownBlocks tokens={item.tokens} inList presentation={withDirection(presentation, direction)} />
              </View>
            </View>
          );
        })}
      </View>
    );
  }
  if (tokenIs(token, "table")) return <MarkdownTable token={token} presentation={presentation} />;
  if (token.type === "hr") return <View className="h-px bg-separator" />;
  return (
    <Text
      selectable={presentation.selectable}
      style={[CHAT_TEXT_STYLES[presentation.type], presentation.style, blockDirectionStyle(token.raw, presentation)]}
    >
      {blockDirectionMark(token.raw, presentation)}
      {token.raw}
    </Text>
  );
});

const NO_AGENTS: readonly MobileAgent[] = [];

/** True when a message body has a table at its top level, which `ChatMarkdown` can draw out of the bubble. */
export function chatMarkdownHasTable(body: string, finished: boolean): boolean {
  if (!body.includes("|")) return false;
  return (finished ? parseFinishedChatMarkdown(body) : parseStreamingChatMarkdown(body)).some(
    (token) => token.type === "table",
  );
}

/** A run of blocks that is not a table, or one table, in the order of the message. */
interface BlockGroup {
  table: boolean;
  tokens: Token[];
  offset: number;
}

function blockGroups(tokens: Token[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  for (const { value: token, offset } of sourceEntries(tokens, (entry) => entry.raw)) {
    const last = groups.at(-1);
    if (token.type === "table") groups.push({ table: true, tokens: [token], offset });
    else if (last && !last.table) last.tokens.push(token);
    else groups.push({ table: false, tokens: [token], offset });
  }
  // A space between two tables would be an empty bubble.
  return groups.filter((group) => group.table || group.tokens.some((token) => token.type !== "space"));
}

export const ChatMarkdown = memo(function ChatMarkdown({
  body,
  color,
  compact = false,
  streaming = false,
  animationEnabled = true,
  playback,
  selectable = true,
  agents = NO_AGENTS,
  finished = false,
  linkFavicons = true,
  fontWeight,
  inline: inlineOnly = false,
  tone,
  renderText,
  renderTable,
  tableFrame,
  align = "start",
}: {
  body: string;
  color: ColorValue | undefined;
  /** The colors of code in a bubble with a message color. */
  tone?: BubbleTone;
  /**
   * Draws each run of blocks that is not a table in a bubble. A table at the top level then stands
   * between the bubbles, on the screen, in the colors of the theme. Unset, all blocks are one view.
   */
  renderText?: (children: ReactNode, key: string) => ReactNode;
  /**
   * Places a table out of the bubble, such as at the width and the side of the bubbles. With `tone`,
   * the table keeps the colors of the bubble, so the caller lays it on the bubble color. Unset, the
   * table is as wide as the message, on the screen, in the colors of the theme.
   */
  renderTable?: (table: ReactNode, key: string) => ReactNode;
  /** Lays the card of a table out of the bubble on the color of the bubble, with `tone`. */
  tableFrame?: (card: ReactNode) => ReactNode;
  /** The side of the message, for the copy actions of a table. */
  align?: "start" | "end";
  /** The weight of the text, such as the medium title of a question card. Bold text stays bold. */
  fontWeight?: TextStyle["fontWeight"];
  /** Only inline Markdown, in one paragraph: a line that starts with `1.` or `#` stays text. */
  inline?: boolean;
  compact?: boolean;
  streaming?: boolean;
  /** The text will not change, so its parse is shared across mounts. */
  finished?: boolean;
  animationEnabled?: boolean;
  playback?: ReplyPlayback;
  selectable?: boolean;
  agents?: readonly MobileAgent[];
  /**
   * False shows only the link symbol, so that no linked site is asked for its favicon. Use it for
   * text that another person wrote, such as the instructions of a marketplace skill.
   */
  linkFavicons?: boolean;
}) {
  const textReveal = useMotionPreference("textReveal");
  const fontScale = useFontScale();
  const tokens = useMemo(
    () =>
      inlineOnly
        ? parseInlineChatMarkdown(body)
        : finished
          ? parseFinishedChatMarkdown(body)
          : parseStreamingChatMarkdown(body),
    [body, finished, inlineOnly],
  );
  const reveal = useMemo(
    () => (finished ? finishedReplyReveal(tokens) : createReplyReveal(tokens)),
    [tokens, finished],
  );
  const { tokens: visibleTokens, flushed } = useReplyPlayback(reveal, playback);
  const themeForeground = useThemeColor("foreground");
  const textColor = String(useCSSVariable("--openbot-text-primary"));
  const chipBackground = tone?.chip ?? withAlpha(textColor, "14");
  const codeColor = tone?.foreground ?? themeForeground;
  const { t } = useText();
  const animateTail = (streaming || (Boolean(playback?.enabled) && !flushed)) && animationEnabled && textReveal;
  // One object while its values stay, so each block keeps its memo when the message renders again.
  const presentation = useMemo<TextPresentation>(
    () => ({
      selectable,
      type: compact ? "body-sm" : "body",
      style: fontWeight ? { color: color ?? codeColor, fontWeight } : { color: color ?? codeColor },
      codeColor,
      agents,
      mentionOffset: 4 * fontScale,
      fontScale,
      t,
      streaming,
      finished,
      animateTail,
      linkFavicons,
      direction: layoutDirection(),
      tone,
      chipBackground,
      outside: false,
      tableFrame: undefined,
      align,
    }),
    [
      linkFavicons,
      selectable,
      compact,
      color,
      fontWeight,
      codeColor,
      agents,
      fontScale,
      t,
      streaming,
      finished,
      animateTail,
      tone,
      chipBackground,
      align,
    ],
  );
  // A table out of the bubble is on the screen, so it takes the colors of the theme.
  const screenPresentation = useMemo<TextPresentation>(
    () => ({
      ...presentation,
      style: fontWeight ? { color: themeForeground, fontWeight } : { color: themeForeground },
      codeColor: themeForeground,
      tone: undefined,
      chipBackground: withAlpha(textColor, "14"),
      outside: true,
    }),
    [presentation, fontWeight, themeForeground, textColor],
  );
  const outsidePresentation = useMemo(
    () => ({ ...presentation, outside: true, tableFrame }),
    [presentation, tableFrame],
  );
  const groups = useMemo(() => (renderText ? blockGroups(visibleTokens) : []), [renderText, visibleTokens]);
  if (!renderText) {
    return (
      <StreamRevealProvider>
        <MarkdownBlocks tokens={visibleTokens} presentation={presentation} />
      </StreamRevealProvider>
    );
  }
  return (
    <StreamRevealProvider>
      {groups.map((group) =>
        group.table ? (
          renderTable ? (
            renderTable(
              group.tokens.map((token) => (
                <MarkdownBlock
                  key={group.offset}
                  token={token}
                  presentation={tone ? outsidePresentation : screenPresentation}
                  inList={false}
                />
              )),
              `table-${group.offset}`,
            )
          ) : (
            <View key={`table-${group.offset}`} className="self-stretch">
              {group.tokens.map((token) => (
                <MarkdownBlock key={group.offset} token={token} presentation={screenPresentation} inList={false} />
              ))}
            </View>
          )
        ) : (
          renderText(<MarkdownBlocks tokens={group.tokens} presentation={presentation} />, `text-${group.offset}`)
        ),
      )}
    </StreamRevealProvider>
  );
});
