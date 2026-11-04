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
import { useThemeColor } from "heroui-native/hooks";
import Blocks from "lucide-react-native/icons/blocks";
import FileText from "lucide-react-native/icons/file-text";
import Sparkles from "lucide-react-native/icons/sparkles";
import type { Token, Tokens } from "marked";
import { Fragment, memo, type ReactNode, useMemo } from "react";
import {
  type ColorValue,
  Platform,
  ScrollView,
  Text,
  type TextStyle,
  useWindowDimensions,
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
import { graphemes } from "@/shared/lib/graphemes";
import { haptics } from "@/shared/lib/haptics";
import { useMotionPreference } from "@/shared/lib/motion";
import { currentText, useText } from "@/shared/lib/text";
import { parseFinishedChatMarkdown, parseStreamingChatMarkdown } from "../model/chat-markdown-parser";
import { plainMentionParts } from "../model/chat-mentions";
import { createReplyReveal, finishedReplyReveal } from "../model/reply-reveal";
import { ChatCodeBlock } from "./chat-code-block";
import { ChatCodePreview } from "./chat-code-preview";
import { ChatMath } from "./chat-math";
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
      (reference) => reference.kind === "agent" || reference.kind === "skill" || reference.kind === "mcp",
    ) || plainMentionParts(source, presentation.agents).some((part) => part.agent);
  // Inline math is moved down to the math axis in the same way.
  const hasMath = chatMathStart(source) !== undefined;
  // Code chips move down as well; see `inlineChipStyle`.
  const hasChip = source.includes("`");
  return hasMention || hasMath || hasChip
    ? { ...presentation.style, paddingBottom: presentation.mentionOffset, overflow: "visible" }
    : presentation.style;
}

/** The height of an inline code chip: its line and one point above and below. */
function codeChipHeight(presentation: TextPresentation): number {
  return CHAT_CODE_STYLES[presentation.type === "body-sm" ? "small" : "body"].lineHeight + 2;
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
 * in the colour of its file family. Mobile cannot open workspace files, so it is not a control.
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
  const small = presentation.type === "body-sm";
  if (Platform.OS === "android") {
    // Android does not move a view that is wider than the rest of the line to the next line, so a long
    // path was cut at the edge of the message. Only the small badge is a view; the name is text of the
    // paragraph and wraps as text does.
    return (
      <>
        <View
          collapsable={false}
          className="pl-0.5 pr-1"
          style={{ transform: [{ translateY: presentation.mentionOffset }] }}
        >
          <FileBadge name={name} color={String(color)} soft={String(soft)} />
        </View>
        <Text style={{ color: String(color), fontWeight: "600", ...(small ? { fontSize: 12 } : null) }}>
          {`${WORD_JOINER}${text.trim()}`}
        </Text>
      </>
    );
  }
  return (
    <View
      collapsable={false}
      className="max-w-full shrink flex-row items-center gap-1 self-start px-0.5"
      style={inlineChipStyle(presentation, small ? 16 : CHAT_TEXT_STYLES[presentation.type].lineHeight, inRow)}
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
    </View>
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
      className={`max-w-full self-start bg-control py-px ${index === 0 ? "rounded-l-xl pl-1" : ""} ${index === pieces.length - 1 ? "rounded-r-xl pr-1" : ""}`}
      style={chipStyle}
    >
      <Text
        selectable={presentation.selectable}
        numberOfLines={1}
        style={[
          presentation.style,
          CHAT_CODE_STYLES[presentation.type === "body-sm" ? "small" : "body"],
          { color: presentation.codeColor },
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
    style: {
      paddingVertical: padding * presentation.fontScale,
      transform: [{ translateY: below * presentation.fontScale }],
      borderCurve: "circular" as const,
    },
  };
}

function AgentMention({ agent, presentation }: { agent: MobileAgent; presentation: TextPresentation }) {
  const chip = mentionChip(presentation);
  return (
    <View
      collapsable={false}
      className="max-w-full flex-row items-center gap-1 rounded-full bg-control/30 pr-1.5 pl-1"
      style={chip.style}
    >
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
    <View
      collapsable={false}
      className="max-w-full flex-row items-center gap-1 rounded-full bg-control/30 pr-1.5 pl-1"
      style={chip.style}
    >
      <Mark
        color={presentation.style.color === undefined ? undefined : String(presentation.style.color)}
        size={chip.mark - 2 * presentation.fontScale}
        strokeWidth={2}
      />
      <Text style={chip.label}>{name}</Text>
    </View>
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
  return (
    <View className="min-w-0 gap-1">
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
        style={[CHAT_TEXT_STYLES[presentation.type], textContainerStyle(token.raw, presentation)]}
      >
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
        style={[CHAT_TEXT_STYLES[level], textContainerStyle(token.raw, presentation)]}
      >
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
          <ChatCodePreview kind={preview} text={token.text} language={token.lang} streaming={presentation.streaming} />
        ) : (
          <ChatCodeBlock
            selectable={presentation.selectable}
            text={token.text}
            language={token.lang}
            finished={presentation.finished}
          />
        )}
      </StreamingBlock>
    );
  }
  if (tokenIs(token, "blockquote")) {
    return (
      <View className="border-l-2 border-separator pl-3">
        <MarkdownBlocks tokens={token.tokens} presentation={presentation} inList={inList} />
      </View>
    );
  }
  if (tokenIs(token, "list")) {
    return (
      <View className="gap-1.5">
        {sourceEntries(token.items, (item) => item.raw).map(({ value: item, offset: itemOffset }, itemIndex) => (
          <View key={itemOffset} className="flex-row items-start gap-2">
            <Text style={[CHAT_TEXT_STYLES[presentation.type], presentation.style]}>
              {item.task ? (item.checked ? "☑" : "☐") : token.ordered ? `${Number(token.start) + itemIndex}.` : "•"}
            </Text>
            <View className="min-w-0 shrink">
              <MarkdownBlocks tokens={item.tokens} inList presentation={presentation} />
            </View>
          </View>
        ))}
      </View>
    );
  }
  if (tokenIs(token, "table")) {
    return (
      <ScrollView horizontal alwaysBounceHorizontal={false} style={{ flexGrow: 0, flexShrink: 0 }}>
        <View>
          {sourceEntries([token.header, ...token.rows], (row) => row.map((cell) => cell.text).join("|")).map(
            ({ value: row, offset: rowOffset }) => (
              <View key={rowOffset} className="flex-row border-b border-separator">
                {sourceEntries(row, (cell) => cell.text).map(({ value: cell, offset: cellOffset }) => (
                  <View key={cellOffset} className="w-44 px-2 py-2">
                    <Text
                      selectable={presentation.selectable}
                      style={[
                        CHAT_TEXT_STYLES[presentation.type],
                        textContainerStyle(cell.text, presentation),
                        { textAlign: cell.align ?? "left", fontWeight: cell.header ? "600" : "400" },
                      ]}
                    >
                      {inline(cell.tokens, presentation)}
                    </Text>
                  </View>
                ))}
              </View>
            ),
          )}
        </View>
      </ScrollView>
    );
  }
  if (token.type === "hr") return <View className="h-px bg-separator" />;
  return (
    <Text selectable={presentation.selectable} style={[CHAT_TEXT_STYLES[presentation.type], presentation.style]}>
      {token.raw}
    </Text>
  );
});

const NO_AGENTS: readonly MobileAgent[] = [];

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
}: {
  body: string;
  color: ColorValue | undefined;
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
  const { fontScale } = useWindowDimensions();
  const tokens = useMemo(
    () => (finished ? parseFinishedChatMarkdown(body) : parseStreamingChatMarkdown(body)),
    [body, finished],
  );
  const reveal = useMemo(
    () => (finished ? finishedReplyReveal(tokens) : createReplyReveal(tokens)),
    [tokens, finished],
  );
  const { tokens: visibleTokens, flushed } = useReplyPlayback(reveal, playback);
  const codeColor = useThemeColor("foreground");
  const { t } = useText();
  const animateTail = (streaming || (Boolean(playback?.enabled) && !flushed)) && animationEnabled && textReveal;
  // One object while its values stay, so each block keeps its memo when the message renders again.
  const presentation = useMemo<TextPresentation>(
    () => ({
      selectable,
      type: compact ? "body-sm" : "body",
      style: { color: color ?? codeColor },
      codeColor,
      agents,
      mentionOffset: 4 * fontScale,
      fontScale,
      t,
      streaming,
      finished,
      animateTail,
      linkFavicons,
    }),
    [linkFavicons, selectable, compact, color, codeColor, agents, fontScale, t, streaming, finished, animateTail],
  );
  return (
    <StreamRevealProvider>
      <MarkdownBlocks tokens={visibleTokens} presentation={presentation} />
    </StreamRevealProvider>
  );
});
