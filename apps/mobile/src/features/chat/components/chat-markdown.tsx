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
import { isWordStarEmphasis, markdownInlinePlainText } from "@openbot/contracts/markdown-preview-text";
import type { MobileTranslate } from "@openbot/i18n/mobile";
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
import { ChatHorizontalScrollView } from "@/features/chat/components/chat-swipe-gesture";
import {
  StreamingBlock,
  StreamingTailText,
  StreamRevealProvider,
} from "@/features/chat/components/streaming-tail-text";
import { PLAIN_BUBBLE_SHARE } from "@/features/settings/model/message-color";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useFontScale } from "@/shared/lib/font-scale";
import { graphemes } from "@/shared/lib/graphemes";
import { haptics } from "@/shared/lib/haptics";
import { useMotionPreference } from "@/shared/lib/motion";
import { currentText, useText } from "@/shared/lib/text";
import {
  CODE_LAYOUT_STYLE,
  CODE_TEXT_STYLE,
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
import { isMessageFileLink, messageLinkFilePath, webLink } from "../model/message-file-target";
import { createReplyReveal, finishedReplyReveal } from "../model/reply-reveal";
import { tableCsv } from "../model/table-copy";
import { useSolidChatFill } from "./chat-bubble-fill";
import { ChatCodeBlock } from "./chat-code-block";
import { ChatCodePreview } from "./chat-code-preview";
import { useOpenMessageFile } from "./chat-file-actions";
import { ChatMath } from "./chat-math";
import { useOpenTaggedTab } from "./chat-tag-actions";
import { CHAT_CODE_STYLES, CHAT_HEADING_RAMP, CHAT_TEXT_STYLES, type ChatTextType } from "./chat-text-styles";
import { copyToClipboard } from "./use-copy-message";
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
  streaming: boolean;
  finished: boolean;
  agents: readonly MobileAgent[];
  mentionOffset: number;
  fontScale: number;
  t: MobileTranslate;
  linkFavicons: boolean;
  remoteContent: boolean;
  direction: TextDirection;
  tone: BubbleTone | undefined;
  chipBackground: string;
  outside: boolean;
  tableFrame: ((card: ReactNode) => ReactNode) | undefined;
  align: "start" | "end";
  literalWordStars: boolean;
}

function blockDirectionStyle(source: string, presentation: TextPresentation): TextStyle {
  return textDirectionStyle(textDirection(source, presentation.direction), presentation.direction);
}

function blockDirectionMark(source: string, presentation: TextPresentation): DirectionMark {
  return directionMark(source, textDirection(source, presentation.direction));
}

function cellAlignment(
  align: "left" | "center" | "right" | null | undefined,
  table: TextDirection,
): TextStyle["textAlign"] {
  if (align === "center") return "center";
  if (!align) return "left";
  return (align === "left") === (table === "ltr") ? "left" : "right";
}

function withDirection(presentation: TextPresentation, direction: TextDirection): TextPresentation {
  return direction === presentation.direction ? presentation : { ...presentation, direction };
}

function textSize(presentation: TextPresentation): number {
  return CHAT_TEXT_STYLES[presentation.type].fontSize * presentation.fontScale;
}

function textContainerStyle(source: string, presentation: TextPresentation): TextStyle {
  const hasMention =
    chatTagReferences(source).some(
      (reference) =>
        reference.kind === "agent" ||
        reference.kind === "skill" ||
        reference.kind === "mcp" ||
        reference.kind === "tab",
    ) || plainMentionParts(source, presentation.agents).some((part) => part.agent);
  const hasMath = chatMathStart(source) !== undefined;
  const hasChip = source.includes("`");
  return hasMention || hasMath || hasChip
    ? { ...presentation.style, paddingBottom: presentation.mentionOffset, overflow: "visible" }
    : presentation.style;
}

function codeChipLineHeight(presentation: TextPresentation): number {
  return Math.round(CHAT_CODE_STYLES[presentation.type === "body-sm" ? "small" : "body"].fontSize * 1.2);
}

function codeChipHeight(presentation: TextPresentation): number {
  return codeChipLineHeight(presentation) + 2;
}

function inlineChipStyle(presentation: TextPresentation, height: number, inRow: boolean): ViewStyle | undefined {
  if (inRow) return undefined;
  return {
    transform: [
      { translateY: (height / 2 - CHAT_TEXT_STYLES[presentation.type].fontSize * 0.45) * presentation.fontScale },
    ],
  };
}

const WORD_JOINER = "\u2060";
const LEFT_TO_RIGHT_ISOLATE = "\u2066";
const POP_DIRECTIONAL_ISOLATE = "\u2069";

function sourceEntries<T>(values: T[], source: (value: T) => string) {
  let offset = 0;
  return values.map((value) => {
    const entry = { value, offset };
    offset += source(value).length + 1;
    return entry;
  });
}

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

function CodeFileReference({
  text,
  presentation,
  inRow,
}: {
  text: string;
  presentation: TextPresentation;
  inRow: boolean;
}) {
  const label = text.trim();
  const open = useOpenMessageFile()?.code(text) ?? null;
  return (
    <FileReference
      name={fileReferenceName(label)}
      label={label}
      open={open}
      presentation={presentation}
      inRow={inRow}
    />
  );
}

function LinkFileReference({
  href,
  token,
  presentation,
  inRow = false,
}: {
  href: string;
  token: Tokens.Link;
  presentation: TextPresentation;
  inRow?: boolean;
}) {
  const open = useOpenMessageFile()?.link(href) ?? null;
  if (!open) {
    const text = inline(token.tokens, { ...presentation, agents: [] });
    return inRow ? (
      <Text selectable={presentation.selectable} style={[CHAT_TEXT_STYLES[presentation.type], presentation.style]}>
        {text}
      </Text>
    ) : (
      text
    );
  }
  const label = markdownInlinePlainText(token.text) || token.href;
  return (
    <FileReference
      name={fileReferenceName(messageLinkFilePath(href))}
      label={label}
      open={open}
      presentation={presentation}
      inRow={inRow}
    />
  );
}

function FileReference({
  name,
  label,
  open,
  presentation,
  inRow,
}: {
  name: string;
  label: string;
  open: (() => void) | null;
  presentation: TextPresentation;
  inRow: boolean;
}) {
  const [color, soft] = useCSSVariable(FILE_TONE_COLORS[fileReferenceTone(name)]);
  const small = presentation.type === "body-sm";
  const Chip = open ? Pressable : View;
  const control = open
    ? {
        accessibilityRole: "button" as const,
        accessibilityLabel: presentation.t("mobile.chat.markdown.openFile", { name }),
        onPress: open,
      }
    : null;
  if (Platform.OS === "android") {
    return (
      <>
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
          {`${WORD_JOINER}${label}`}
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
        {label}
      </Text>
    </Chip>
  );
}

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

function CodeSpan({ text, presentation, row }: { text: string; presentation: TextPresentation; row?: TextDirection }) {
  const inRow = row !== undefined;
  if (isFileReference(text.trim())) return <CodeFileReference text={text} presentation={presentation} inRow={inRow} />;
  const pieces = codePieces(text);
  const chipStyle = inlineChipStyle(presentation, codeChipHeight(presentation), inRow);
  const chips = sourceEntries(pieces, (piece) => piece).map(({ value: piece, offset }, index) => (
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
          CODE_TEXT_STYLE,
          { color: presentation.codeColor, lineHeight: codeChipLineHeight(presentation) },
        ]}
      >
        {directionMark(piece, "ltr")}
        {piece}
      </Text>
    </View>
  ));
  if (!inRow) {
    return (
      <>
        {LEFT_TO_RIGHT_ISOLATE}
        {chips}
        {POP_DIRECTIONAL_ISOLATE}
      </>
    );
  }
  if (row === "rtl") {
    return (
      <View className="min-w-0 max-w-full flex-row flex-wrap items-center gap-y-1" style={CODE_LAYOUT_STYLE}>
        {chips}
      </View>
    );
  }
  return chips;
}

function mentionChip(presentation: TextPresentation) {
  const size = CHAT_TEXT_STYLES[presentation.type].fontSize - 1;
  const lineHeight = Math.round(size * 1.25);
  const padding = 1;
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

const WORD_STAR: Tokens.Text = { type: "text", raw: "*", text: "*", escaped: false };

function withLiteralWordStars(tokens: Token[]): Token[] {
  return tokens.flatMap((token, index) =>
    tokenIs(token, "em") && isWordStarEmphasis(token, tokens[index - 1]?.raw ?? "", tokens[index + 1]?.raw ?? "")
      ? [WORD_STAR, ...token.tokens, WORD_STAR]
      : [token],
  );
}

function shownTokens(tokens: Token[], presentation: TextPresentation): Token[] {
  return presentation.literalWordStars ? withLiteralWordStars(tokens) : tokens;
}

function inline(tokens: Token[], parentPresentation: TextPresentation): ReactNode {
  const shown = shownTokens(tokens, parentPresentation);
  return sourceEntries(shown, (token) => token.raw).map(({ value: token, offset }) => {
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
      if (!url) {
        if (isFileLink(token))
          return <LinkFileReference key={offset} href={token.href} token={token} presentation={presentation} />;
        return <Fragment key={offset}>{label}</Fragment>;
      }
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
    return token.raw;
  });
}

function isFileLink(token: Token): token is Tokens.Link {
  return tokenIs(token, "link") && isMessageFileLink(token.href);
}

function ListParagraph({ tokens, presentation }: { tokens: Token[]; presentation: TextPresentation }) {
  let run: Token[] = [];
  let line: Token[][] = [run];
  const lines: Token[][][] = [line];
  for (const token of shownTokens(tokens, presentation)) {
    if (token.type === "checkbox") continue;
    if (token.type === "br") {
      run = [];
      line = [run];
      lines.push(line);
    } else if (tokenIs(token, "codespan") || isFileLink(token)) {
      run = [];
      line.push([token], run);
    } else if (tokenIs(token, "text") && !token.tokens) {
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
  const direction = textDirection(source(tokens), presentation.direction);
  return (
    <View className="min-w-0 gap-1" style={{ direction }}>
      {sourceEntries(lines, (line) => line.map(source).join("")).map(({ value: line, offset: lineOffset }) => (
        <View key={lineOffset} className="min-w-0 flex-row flex-wrap items-center gap-y-1">
          {sourceEntries(line, source).map(({ value: run, offset }) => {
            const [token] = run;
            if (!token) return null;
            if (tokenIs(token, "codespan")) {
              return <CodeSpan key={offset} text={token.text} presentation={presentation} row={direction} />;
            }
            if (isFileLink(token)) {
              return (
                <LinkFileReference key={offset} href={token.href} token={token} presentation={presentation} inRow />
              );
            }
            return (
              <Text
                key={offset}
                selectable={presentation.selectable}
                style={[
                  CHAT_TEXT_STYLES[presentation.type],
                  textContainerStyle(source(run), presentation),
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

const TABLE_COLUMN_MIN_WIDTH = 56;
const TABLE_COLUMN_MAX_WIDTH = 240;
const TABLE_CELL_PADDING = 24;
const TABLE_CHARACTER_WIDTH = 0.55;
const TABLE_INSET = 3;

function withAlpha(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/iu.test(color) ? `${color}${alpha}` : color;
}

function MarkdownTable({ token, presentation }: { token: Tokens.Table; presentation: TextPresentation }) {
  const [canvas, textColor = "", control = "", headerText, text] = useCSSVariable([
    "--openbot-bg-native-canvas",
    "--openbot-text-primary",
    "--openbot-bg-control",
    "--openbot-data-table-header-text",
    "--openbot-data-table-text",
  ]).map((value) => (value === undefined ? "" : String(value)));
  const { tone } = presentation;
  const solidCard = useSolidChatFill(PLAIN_BUBBLE_SHARE);
  const card = presentation.outside
    ? tone
      ? "transparent"
      : (solidCard ?? withAlpha(control, "99"))
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
  const contentTotal = contentWidths.reduce((total, width) => total + width, 0);
  const grow = Math.max(1, (frameWidth - TABLE_INSET * 2) / Math.max(1, contentTotal));
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
            backgroundColor: presentation.outside && tone ? tone.panel : undefined,
          }}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: rowsBackground }]} />
        </View>
      ) : null}
      <ChatHorizontalScrollView
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
      </ChatHorizontalScrollView>
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
    if (await copyToClipboard(text, "mobile.chat.table.copyFailed", t)) setCopied(format);
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

function isDisplayMath(token: Token): token is MathToken {
  return tokenIs(token, "inlineMath") && token.display;
}

function isBlankInline(token: Token): boolean {
  return token.type === "br" || token.type === "checkbox" || (tokenIs(token, "text") && !token.text.trim());
}

function trimmedEdge(token: Token | undefined, trim: (text: string) => string): Token[] {
  if (!token) return [];
  if (!tokenIs(token, "text") || token.tokens) return [token];
  return [{ ...token, text: trim(token.text) }];
}

function textRun(token: Tokens.Paragraph | Tokens.Text, run: Token[]): Token[] {
  const start = run.findIndex((child) => !isBlankInline(child));
  if (start < 0) return [];
  const end = run.findLastIndex((child) => !isBlankInline(child));
  const edges = run.slice(start, end + 1);
  const first = trimmedEdge(edges[0], (text) => text.trimStart());
  const tokens =
    edges.length === 1
      ? trimmedEdge(first[0], (text) => text.trimEnd())
      : [...first, ...edges.slice(1, -1), ...trimmedEdge(edges.at(-1), (text) => text.trimEnd())];
  const raw = tokens.map((child) => child.raw).join("");
  return [{ ...token, raw, text: raw, tokens }];
}

const displayMathSplits = new WeakMap<Token, Token[]>();

function withDisplayMathBlocks(tokens: Token[]): Token[] {
  return tokens.flatMap((token) => {
    if (!(tokenIs(token, "paragraph") || tokenIs(token, "text")) || !token.tokens?.some(isDisplayMath)) return [token];
    const cached = displayMathSplits.get(token);
    if (cached) return cached;
    const blocks: Token[] = [];
    let run: Token[] = [];
    for (const child of token.tokens) {
      if (!isDisplayMath(child)) {
        run.push(child);
        continue;
      }
      blocks.push(...textRun(token, run), { ...child, type: "blockMath" });
      run = [];
    }
    blocks.push(...textRun(token, run));
    displayMathSplits.set(token, blocks);
    return blocks;
  });
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
  const blocks = useMemo(() => withDisplayMathBlocks(tokens), [tokens]);
  return (
    <View className={inList ? "min-w-0 gap-1.5" : "min-w-0 gap-2.5"}>
      {sourceEntries(blocks, (token) => token.raw).map(({ value: token, offset }) => (
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
  if (token.type === "space" || token.type === "def" || token.type === "checkbox") return null;
  if (tokenIs(token, "paragraph") || tokenIs(token, "text")) {
    if (
      inList &&
      Platform.OS !== "android" &&
      token.tokens?.some((child) => tokenIs(child, "codespan") || isFileLink(child))
    ) {
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
            remoteContent={presentation.remoteContent}
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
    const direction = textDirection(token.text, presentation.direction);
    return (
      <View className="border-separator" style={{ direction, borderStartWidth: 2, paddingStart: 12 }}>
        <MarkdownBlocks tokens={token.tokens} presentation={withDirection(presentation, direction)} inList={inList} />
      </View>
    );
  }
  if (tokenIs(token, "list")) {
    const listDirection = textDirection(token.raw, presentation.direction);
    return (
      <View className="gap-1.5">
        {sourceEntries(token.items, (item) => item.raw).map(({ value: item, offset: itemOffset }, itemIndex) => {
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

export function chatMarkdownHasTable(body: string, finished: boolean): boolean {
  if (!body.includes("|")) return false;
  return (finished ? parseFinishedChatMarkdown(body) : parseStreamingChatMarkdown(body)).some(
    (token) => token.type === "table",
  );
}

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
  remoteContent = false,
  fontWeight,
  inline: inlineOnly = false,
  tone,
  renderText,
  renderTable,
  tableFrame,
  align = "start",
  literalWordStars = false,
}: {
  body: string;
  color: ColorValue | undefined;
  tone?: BubbleTone;
  renderText?: (children: ReactNode, key: string) => ReactNode;
  renderTable?: (table: ReactNode, key: string) => ReactNode;
  tableFrame?: (card: ReactNode) => ReactNode;
  align?: "start" | "end";
  literalWordStars?: boolean;
  fontWeight?: TextStyle["fontWeight"];
  inline?: boolean;
  compact?: boolean;
  streaming?: boolean;
  finished?: boolean;
  animationEnabled?: boolean;
  playback?: ReplyPlayback;
  selectable?: boolean;
  agents?: readonly MobileAgent[];
  linkFavicons?: boolean;
  remoteContent?: boolean;
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
      linkFavicons: linkFavicons && remoteContent,
      remoteContent,
      direction: layoutDirection(),
      tone,
      chipBackground,
      outside: false,
      tableFrame: undefined,
      align,
      literalWordStars,
    }),
    [
      linkFavicons,
      remoteContent,
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
      literalWordStars,
    ],
  );
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
