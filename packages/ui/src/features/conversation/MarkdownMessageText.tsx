import { fileReferenceName, isFileReference } from "@openbot/brand/file-reference";
import { attachmentReferenceAt } from "@openbot/contracts/attachment-references";
import {
  blockChatMath,
  chatMathBlockInterrupts,
  chatMathBlockStart,
  chatMathStart,
  inlineChatMath,
} from "@openbot/contracts/chat-math";
import { chatPreviewKind } from "@openbot/contracts/chat-preview";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { markdownImageName } from "@openbot/contracts/markdown-preview-text";
import { Button, Checkbox } from "@openbot/ui";
import { Dynamic } from "@solidjs/web";
import { Marked, type Token, type Tokens, type TokensList } from "marked";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ScrollEdges } from "../../components/ScrollEdges";
import { textDirection } from "../../content-direction";
import { useText } from "../../text";
import { AttachmentReferenceVisual, attachmentReferenceTone } from "./AttachmentReference";
import { CodeBlock } from "./CodeBlock";
import { CodePreview } from "./CodePreview";
import type { MessageCodeBlock } from "./DataTable";
import { MathFormula } from "./MathFormula";
import { linkTitle, MessageLink, RichMessageText, type RichMessageTextProps, safeBrowserUrl } from "./RichMessageText";
import {
  sameStreamingTailOffsets,
  streamingTailInside,
  streamingTailOffsets,
  streamingTrailReach,
  useStreamingReveal,
} from "./streamingReveal";

type MarkdownMessageTextProps = Omit<RichMessageTextProps, "showCitationFooter"> & {
  showCitationFooter?: boolean;
  streaming?: boolean;
  imagesAsLinks?: boolean | undefined;
  onOpenImage?: ((image: HTMLImageElement) => void) | undefined;
  excerpt?: boolean | undefined;
  document?: boolean | undefined;
};

type MarkdownContentProps = Omit<
  MarkdownMessageTextProps,
  "body" | "showCitationFooter" | "streaming" | "streamingTailAfter" | "document"
> & {
  fileDirectory: FileDirectoryContext | null;
};

interface FileDirectoryContext {
  path: string;
  kind: "shared" | "workspace";
}

interface MarkdownTokenByType {
  heading: Tokens.Heading;
  paragraph: Tokens.Paragraph;
  blockquote: Tokens.Blockquote;
  list: Tokens.List;
  code: Tokens.Code;
  table: Tokens.Table;
  text: Tokens.Text;
  strong: Tokens.Strong;
  em: Tokens.Em;
  del: Tokens.Del;
  codespan: Tokens.Codespan;
  link: Tokens.Link;
  image: Tokens.Image;
  escape: Tokens.Escape;
  blockMath: MathToken;
  inlineMath: MathToken;
  attachmentTag: AttachmentTagToken;
}

interface AttachmentTagToken extends Tokens.Generic {
  type: "attachmentTag";
  text: string;
  attachmentId: string;
}

interface MathToken extends Tokens.Generic {
  type: "blockMath" | "inlineMath";
  text: string;
  display: boolean;
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  tokenizer: {
    lheading(source) {
      const heading = this.rules.block.lheading.exec(source);
      return heading && chatMathBlockInterrupts(source, heading[0].length) ? undefined : false;
    },
  },
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start: chatMathBlockStart,
      tokenizer(source): MathToken | undefined {
        const math = blockChatMath(source);
        if (math) return { type: "blockMath", raw: math.raw, text: math.tex, display: true };
      },
    },
    {
      name: "inlineMath",
      level: "inline",
      start: chatMathStart,
      tokenizer(source): MathToken | undefined {
        const math = inlineChatMath(source);
        if (math) return { type: "inlineMath", raw: math.raw, text: math.tex, display: math.display };
      },
    },
    {
      name: "attachmentTag",
      level: "inline",
      start: (source) => source.indexOf("@["),
      tokenizer(source): AttachmentTagToken | undefined {
        const reference = attachmentReferenceAt(source);
        if (!reference) return undefined;
        return {
          type: "attachmentTag",
          raw: reference.marker,
          text: reference.name,
          attachmentId: reference.attachmentId,
        };
      },
    },
  ],
});

const VOID_HTML_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const EXCERPT_BLOCK_LIMIT = 4;

function tokenIs<K extends keyof MarkdownTokenByType>(token: Token, type: K): token is MarkdownTokenByType[K] {
  return token.type === type;
}

function headingLevel(depth: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (depth <= 1) return 1;
  if (depth === 2) return 2;
  if (depth === 3) return 3;
  if (depth === 4) return 4;
  if (depth === 5) return 5;
  return 6;
}

const LEXER_CACHE_LIMIT = 200;
const LEXER_CACHE_CHARACTERS = 2 * 1024 * 1024;

class LexerCache<T> {
  readonly #entries = new Map<string, T>();
  #characters = 0;

  get(body: string): T | undefined {
    return this.#entries.get(body);
  }

  set(body: string, tokens: T): void {
    if (body.length > LEXER_CACHE_CHARACTERS || this.#entries.has(body)) return;
    this.#entries.set(body, tokens);
    this.#characters += body.length;
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= LEXER_CACHE_LIMIT && this.#characters <= LEXER_CACHE_CHARACTERS) break;
      this.#entries.delete(oldest);
      this.#characters -= oldest.length;
    }
  }
}

const lexerCache = new LexerCache<TokensList>();
const inlineLexerCache = new LexerCache<Token[]>();

function lexBlockTokens(body: string, cache: boolean): TokensList {
  if (!cache) return markdown.lexer(body);
  const cached = lexerCache.get(body);
  if (cached) return cached;
  const tokens = markdown.lexer(body);
  lexerCache.set(body, tokens);
  return tokens;
}

interface StreamedTokens {
  body: string;
  tokens: TokensList;
}

function lexStreamingTokens(body: string, previous: StreamedTokens | undefined): TokensList {
  if (!previous || !body.startsWith(previous.body) || Object.keys(previous.tokens.links).length > 0) {
    return markdown.lexer(body);
  }
  let kept = previous.tokens.length - 1;
  while (kept > 0 && previous.tokens[kept]?.type === "space") kept -= 1;
  while (kept > 0 && previous.tokens[kept]?.type !== "space") kept -= 1;
  const openMath = previous.tokens.findIndex(
    (token, index) =>
      index < kept &&
      token.type !== "blockMath" &&
      token.type !== "code" &&
      chatMathBlockStart(token.raw) !== undefined,
  );
  if (openMath !== -1) kept = openMath;
  const settled = previous.tokens.slice(0, kept);
  const settledLength = settled.reduce((length, token) => length + token.raw.length, 0);
  const previousLength = previous.tokens.reduce((length, token) => length + token.raw.length, 0);
  if (settled.length === 0 || previousLength !== previous.body.length) return markdown.lexer(body);
  const tail = markdown.lexer(body.slice(settledLength));
  if (Object.keys(tail.links).length > 0) return markdown.lexer(body);
  return Object.assign([...settled, ...tail], { links: tail.links });
}

function lexInlineTokens(body: string): Token[] {
  const cached = inlineLexerCache.get(body);
  if (cached) return cached;
  const tokens = markdown.Lexer.lexInline(body, markdown.defaults);
  inlineLexerCache.set(body, tokens);
  return tokens;
}

export function MarkdownMessageText(props: MarkdownMessageTextProps) {
  let streamed: StreamedTokens | undefined;
  const tokens = createMemo(() => {
    const body = props.body;
    if (props.streaming !== true) {
      streamed = undefined;
      return lexBlockTokens(body, true);
    }
    const tokens = lexStreamingTokens(body, streamed);
    streamed = { body, tokens };
    return tokens;
  });
  const shownTokens = createMemo((): TokensList => {
    const all = tokens();
    if (props.excerpt !== true) return all;
    const blocks = all.filter((token) => token.type !== "space").slice(0, EXCERPT_BLOCK_LIMIT);
    return Object.assign(blocks, { links: all.links });
  });
  const fileDirectory = createMemo(() => (props.document === true ? null : messageFileDirectory(props.body)), {
    equals: (previous, next) => previous?.path === next?.path && previous?.kind === next?.kind,
  });
  const contentProps = createMemo(
    (): MarkdownContentProps => ({
      imagesAsLinks: props.imagesAsLinks,
      excerpt: props.excerpt,
      onOpenImage: props.onOpenImage,
      agents: props.agents,
      skills: props.skills,
      attachments: props.attachments,
      citations: props.citations,
      onSelectAgent: props.onSelectAgent,
      onOpenLink: props.onOpenLink,
      onOpenAttachment: props.onOpenAttachment,
      onOpenSharedFile: props.onOpenSharedFile,
      onOpenWorkspaceFile: props.onOpenWorkspaceFile,
      onOpenQuote: props.onOpenQuote,
      onOpenTag: props.onOpenTag,
      linkFavicons: props.linkFavicons,
      fileDirectory: fileDirectory(),
    }),
  );

  return (
    <>
      <MarkdownBlocks
        tokens={shownTokens()}
        linkDefinitions={JSON.stringify(shownTokens().links)}
        content={contentProps()}
        streaming={props.streaming}
        streamingTailAfter={props.streamingTailAfter}
      />
      <Show when={props.showCitationFooter !== false && (props.citations?.length ?? 0) > 0}>
        <RichMessageText {...contentProps()} body="" />
      </Show>
    </>
  );
}

export function MarkdownInlineText(
  props: Omit<MarkdownMessageTextProps, "showCitationFooter" | "streaming" | "streamingTailAfter">,
) {
  const tokens = createMemo(() => lexInlineTokens(props.body));
  const contentProps = (): MarkdownContentProps => ({
    imagesAsLinks: props.imagesAsLinks,
    onOpenImage: props.onOpenImage,
    agents: props.agents,
    skills: props.skills,
    attachments: props.attachments,
    citations: props.citations,
    onSelectAgent: props.onSelectAgent,
    onOpenLink: props.onOpenLink,
    onOpenAttachment: props.onOpenAttachment,
    onOpenSharedFile: props.onOpenSharedFile,
    onOpenWorkspaceFile: props.onOpenWorkspaceFile,
    onOpenQuote: props.onOpenQuote,
    onOpenTag: props.onOpenTag,
    linkFavicons: props.linkFavicons,
    fileDirectory: messageFileDirectory(props.body),
  });
  return <MarkdownInline tokens={tokens()} content={contentProps()} />;
}

interface RenderedToken {
  token: Token;
  streaming: boolean;
}

function createTailOffsets(tokens: () => readonly { raw: string }[], after: () => number | undefined) {
  const trail = useStreamingReveal();
  return createMemo(
    () =>
      streamingTailOffsets(
        tokens().map((token) => token.raw.length),
        after(),
        streamingTrailReach(trail?.() ?? []),
      ),
    { equals: sameStreamingTailOffsets },
  );
}

function tailInside(token: Token, children: readonly Token[] | undefined, after: number | undefined) {
  return children ? streamingTailInside(token.raw, children, after) : after;
}

function MarkdownBlocks(props: {
  tokens: Token[];
  linkDefinitions?: string;
  content: MarkdownContentProps;
  streaming?: boolean | undefined;
  streamingTailAfter?: number | undefined;
}) {
  const tokens = createMemo(() => props.tokens);
  const tailAfter = createTailOffsets(tokens, () => props.streamingTailAfter);
  const renderedTokens = createMemo<{ linkDefinitions: string | undefined; items: RenderedToken[] }>((previous) => {
    const values = tokens();
    const linkDefinitions = props.linkDefinitions;
    const earlierItems = previous && previous.linkDefinitions === linkDefinitions ? previous.items : [];
    const streamingTokenIndex = activeStreamingBlockTokenIndex(values);
    const items = values.map((token, index) => {
      const streaming = props.streaming === true && index === streamingTokenIndex;
      const earlier = earlierItems[index];
      return earlier?.token.raw === token.raw && earlier.token.type === token.type && earlier.streaming === streaming
        ? earlier
        : { token, streaming };
    });
    return { linkDefinitions, items };
  });
  return (
    <For each={renderedTokens().items}>
      {(item, index) => (
        <MarkdownBlock
          token={item.token}
          content={props.content}
          streaming={item.streaming}
          streamingTailAfter={tailAfter()[index()]}
        />
      )}
    </For>
  );
}

function MarkdownBlock(props: {
  token: Token;
  content: MarkdownContentProps;
  streaming?: boolean;
  streamingTailAfter?: number | undefined;
}) {
  const token = props.token;
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "heading": {
      if (!tokenIs(token, "heading")) return token.raw;
      const level = headingLevel(token.depth);
      return (
        <Dynamic component={`h${level}`} class="message-markdown-heading" data-level={level} dir="auto">
          <MarkdownInline
            tokens={token.tokens}
            content={props.content}
            streaming={props.streaming}
            streamingTailAfter={tailInside(token, token.tokens, props.streamingTailAfter)}
          />
        </Dynamic>
      );
    }
    case "paragraph": {
      if (!tokenIs(token, "paragraph")) return token.raw;
      return (
        <p dir="auto">
          <MarkdownInline
            tokens={token.tokens}
            content={props.content}
            streaming={props.streaming}
            streamingTailAfter={tailInside(token, token.tokens, props.streamingTailAfter)}
          />
        </p>
      );
    }
    case "blockquote": {
      if (!tokenIs(token, "blockquote")) return token.raw;
      return (
        <blockquote dir={tokensDirection(token.tokens)}>
          <MarkdownBlocks
            tokens={token.tokens}
            content={props.content}
            streaming={props.streaming === true && !containerClosesFinalNestedTable(token)}
            streamingTailAfter={tailInside(token, token.tokens, props.streamingTailAfter)}
          />
        </blockquote>
      );
    }
    case "list": {
      if (!tokenIs(token, "list")) return token.raw;
      return (
        <MarkdownList
          token={token}
          content={props.content}
          streaming={props.streaming === true && !containerClosesFinalNestedTable(token)}
          streamingTailAfter={props.streamingTailAfter}
        />
      );
    }
    case "blockMath": {
      if (!tokenIs(token, "blockMath")) return token.raw;
      return <MathFormula tex={token.text} raw={token.raw} display block />;
    }
    case "code": {
      if (!tokenIs(token, "code")) return token.raw;
      if (props.content.excerpt)
        return (
          <pre class="message-markdown-excerpt-code" dir="ltr">
            <code>{token.text}</code>
          </pre>
        );
      const language = token.lang?.trim().split(/\s+/u)[0] ?? "";
      if (language.toLowerCase() === "math") return <MathFormula tex={token.text} raw={token.raw} display block />;
      const block: MessageCodeBlock = { type: "code", code: token.text, language };
      const preview = chatPreviewKind(language);
      if (preview)
        return (
          <CodePreview
            block={block}
            kind={preview}
            streaming={props.streaming === true}
            onOpenLink={props.content.onOpenLink}
          />
        );
      return <CodeBlock block={block} streaming={props.streaming === true} />;
    }
    case "table": {
      if (!tokenIs(token, "table")) return token.raw;
      return <MarkdownTable token={token} content={props.content} streaming={props.streaming} />;
    }
    case "hr":
      return <hr />;
    case "html":
      return (
        <span class="message-markdown-raw-html" dir="ltr">
          {token.raw}
        </span>
      );
    case "text": {
      if (!tokenIs(token, "text")) return token.raw;
      return token.tokens ? (
        <MarkdownInline
          tokens={token.tokens}
          content={props.content}
          streaming={props.streaming}
          streamingTailAfter={tailInside(token, token.tokens, props.streamingTailAfter)}
        />
      ) : (
        <RichText
          body={token.text}
          content={props.content}
          streaming={props.streaming}
          streamingTailAfter={props.streamingTailAfter}
        />
      );
    }
    default:
      return (
        <RichText
          body={token.raw}
          content={props.content}
          streaming={props.streaming}
          streamingTailAfter={props.streamingTailAfter}
        />
      );
  }
}

function MarkdownList(props: {
  token: Tokens.List;
  content: MarkdownContentProps;
  streaming?: boolean;
  streamingTailAfter?: number | undefined;
}) {
  const items = createMemo(() => props.token.items);
  const tailAfter = createTailOffsets(items, () =>
    streamingTailInside(props.token.raw, props.token.items, props.streamingTailAfter),
  );
  const renderedItems = createMemo(() => {
    const values = items();
    return values.map((item, index) => ({
      item,
      streaming: props.streaming === true && index === values.length - 1,
    }));
  });
  const list = () => (
    <For each={renderedItems()}>
      {(renderedItem, index) => {
        const blocks = () => (
          <MarkdownBlocks
            tokens={renderedItem.item.tokens.filter((child) => child.type !== "checkbox")}
            content={props.content}
            streaming={renderedItem.streaming}
            streamingTailAfter={tailInside(
              renderedItem.item,
              renderedItem.item.tokens.filter((child) => child.type !== "checkbox"),
              tailAfter()[index()],
            )}
          />
        );
        return (
          <li class={renderedItem.item.task ? "message-markdown-task" : undefined} dir="auto">
            <Show when={renderedItem.item.task}>
              <Checkbox
                class="message-markdown-checkbox"
                checked={renderedItem.item.checked === true}
                disabled
                aria-label={renderedItem.item.text}
              />
            </Show>
            <Show when={renderedItem.item.task} fallback={blocks()}>
              <div class="message-markdown-task-body">{blocks()}</div>
            </Show>
          </li>
        );
      }}
    </For>
  );

  const direction = createMemo(() => tokensDirection(items()));
  return props.token.ordered ? (
    <ol start={props.token.start === "" ? undefined : props.token.start} dir={direction()}>
      {list()}
    </ol>
  ) : (
    <ul dir={direction()}>{list()}</ul>
  );
}

function MarkdownTable(props: { token: Tokens.Table; content: MarkdownContentProps; streaming?: boolean | undefined }) {
  const headers = createMemo(() => props.token.header);
  const rows = createMemo(() => props.token.rows);
  const streamingCellIndex = createMemo(() =>
    props.streaming === true ? activeStreamingTableCellIndex(props.token) : -1,
  );
  const { t } = useText();
  return (
    <ScrollEdges
      axis="x"
      class="message-table-frame message-markdown-table-frame"
      viewClass="message-markdown-table-scroll"
      label={t("chat.table.data")}
    >
      <table
        class="message-markdown-table"
        style={`--message-markdown-table-columns: ${headers().length}`}
        dir={tokensDirection([...headers(), ...rows().flat()].flatMap((cell) => cell.tokens))}
      >
        <thead>
          <tr>
            <For each={headers()}>
              {(cell) => (
                <th scope="col" data-align={cell.align ?? "left"}>
                  <MarkdownInline tokens={cell.tokens} content={props.content} />
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(row, rowIndex) => (
              <tr>
                <For each={row}>
                  {(cell, cellIndex) => (
                    <td data-align={cell.align ?? "left"}>
                      <MarkdownInline
                        tokens={cell.tokens}
                        content={props.content}
                        streaming={rowIndex() === rows().length - 1 && cellIndex() === streamingCellIndex()}
                      />
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </ScrollEdges>
  );
}

function MarkdownInline(props: {
  tokens: Token[];
  content: MarkdownContentProps;
  streaming?: boolean | undefined;
  streamingTailAfter?: number | undefined;
}) {
  const { t } = useText();
  const tokens = createMemo(() => repairEscapedLocalFileLinkTokens(props.tokens));
  const tailAfter = createTailOffsets(tokens, () => props.streamingTailAfter);
  const renderedTokens = createMemo(() => {
    const values = tokens();
    const markerTokenIndexes =
      props.streaming === true ? incompleteEmphasisMarkerTokenIndexes(values) : new Set<number>();
    return values.map((token, index) => ({
      token,
      streaming: markerTokenIndexes.has(index),
      semanticTag: index > 0 && textTokenEndsWithTagMarker(values[index - 1]) ? semanticChatTag(token) : null,
      precedesSemanticTag: textTokenEndsWithTagMarker(token) && semanticChatTag(values[index + 1]) !== null,
    }));
  });
  return (
    <For each={renderedTokens()}>
      {(item, index) => {
        const token = item.token;
        const after = () => tailAfter()[index()];
        switch (token.type) {
          case "strong":
            if (!tokenIs(token, "strong")) return token.raw;
            return (
              <strong>
                <MarkdownInline
                  tokens={token.tokens}
                  content={props.content}
                  streamingTailAfter={tailInside(token, token.tokens, after())}
                />
              </strong>
            );
          case "em":
            if (!tokenIs(token, "em")) return token.raw;
            return (
              <em>
                <MarkdownInline
                  tokens={token.tokens}
                  content={props.content}
                  streamingTailAfter={tailInside(token, token.tokens, after())}
                />
              </em>
            );
          case "del":
            if (!tokenIs(token, "del")) return token.raw;
            return (
              <del>
                <MarkdownInline
                  tokens={token.tokens}
                  content={props.content}
                  streamingTailAfter={tailInside(token, token.tokens, after())}
                />
              </del>
            );
          case "codespan": {
            if (!tokenIs(token, "codespan")) return token.raw;
            const file = mentionedFileTarget(token.text, props.content.fileDirectory);
            const openShared = props.content.onOpenSharedFile;
            const openWorkspace = props.content.onOpenWorkspaceFile;
            return file && file.kind === "shared" && openShared ? (
              <LocalFileLink
                path={file.path}
                label={token.text}
                kind="shared"
                onOpen={(path) => openShared(path, file.asWritten)}
              />
            ) : file && file.kind === "workspace" && openWorkspace ? (
              <LocalFileLink
                path={file.path}
                label={token.text}
                kind="workspace"
                onOpen={(path) => openWorkspace(path, file.asWritten)}
              />
            ) : (
              <code dir="ltr">{token.text}</code>
            );
          }
          case "br":
            return <br />;
          case "inlineMath":
            if (!tokenIs(token, "inlineMath")) return token.raw;
            return <MathFormula tex={token.text} raw={token.raw} display={token.display} />;
          case "link": {
            if (!tokenIs(token, "link")) return token.raw;
            if (item.semanticTag) {
              return <RichText body={item.semanticTag} content={props.content} streamingTailAfter={after()} />;
            }
            const url = safeBrowserUrl(token.href);
            const { shared: sharedPath, workspace: workspacePath } = linkFileTargets(writtenLinkTarget(token));
            return url ? (
              <MessageLink
                url={url}
                title={token.title || linkTitle(token.text, url)}
                isolate={linkTitle(token.text, token.href) === undefined}
                favicon={props.content.linkFavicons !== false}
                onOpenLink={props.content.onOpenLink}
              >
                {token.text === token.href ? (
                  token.text
                ) : (
                  <MarkdownInline
                    tokens={token.tokens}
                    content={{ ...props.content, onOpenImage: undefined }}
                    streamingTailAfter={tailInside(token, token.tokens, after())}
                  />
                )}
              </MessageLink>
            ) : sharedPath && props.content.onOpenSharedFile ? (
              <LocalFileLink
                path={sharedPath}
                label={markdownInlinePlainText(token.tokens) || token.text}
                kind="shared"
                onOpen={props.content.onOpenSharedFile}
              />
            ) : workspacePath && props.content.onOpenWorkspaceFile ? (
              <LocalFileLink
                path={workspacePath}
                label={markdownInlinePlainText(token.tokens) || token.text}
                kind="workspace"
                onOpen={props.content.onOpenWorkspaceFile}
              />
            ) : (
              <RichText body={token.text} content={props.content} streamingTailAfter={after()} />
            );
          }
          case "image": {
            if (!tokenIs(token, "image")) return token.raw;
            const url = safeBrowserUrl(token.href);
            if (url && props.content.imagesAsLinks) {
              return (
                <MessageLink
                  url={url}
                  title={url}
                  favicon={props.content.linkFavicons !== false}
                  onOpenLink={props.content.onOpenLink}
                >
                  {token.text || t("chat.image.view")}
                </MessageLink>
              );
            }
            if (!url) {
              return <RichText body={token.text || token.raw} content={props.content} streamingTailAfter={after()} />;
            }
            return (
              <MarkdownImage
                url={url}
                alt={token.text}
                title={token.title ?? undefined}
                onOpenImage={props.content.onOpenImage}
              />
            );
          }
          case "html":
            return token.raw;
          case "escape": {
            if (!tokenIs(token, "escape")) return token.raw;
            return <RichText body={token.text} content={props.content} streamingTailAfter={after()} />;
          }
          case "text": {
            if (!tokenIs(token, "text")) return token.raw;
            return token.tokens ? (
              <MarkdownInline
                tokens={token.tokens}
                content={props.content}
                streaming={item.streaming}
                streamingTailAfter={tailInside(token, token.tokens, after())}
              />
            ) : (
              <RichText
                body={item.precedesSemanticTag ? token.text.slice(0, -1) : token.text}
                content={props.content}
                streaming={item.streaming}
                streamingTailAfter={after()}
              />
            );
          }
          case "attachmentTag": {
            if (!tokenIs(token, "attachmentTag")) return token.raw;
            const held = props.content.attachments?.some((attachment) => attachment.id === token.attachmentId);
            return (
              <RichText body={held ? token.raw : token.text} content={props.content} streamingTailAfter={after()} />
            );
          }
          case "checkbox":
            return null;
          default:
            return <RichText body={token.raw} content={props.content} streamingTailAfter={after()} />;
        }
      }}
    </For>
  );
}

function tokensDirection(tokens: readonly Token[]): "ltr" | "rtl" | undefined {
  for (const token of tokens) {
    const direction = tokenDirection(token);
    if (direction) return direction;
  }
  return undefined;
}

function tokenDirection(token: Token): "ltr" | "rtl" | undefined {
  switch (token.type) {
    case "code":
    case "codespan":
    case "blockMath":
    case "inlineMath":
    case "html":
    case "image":
    case "checkbox":
      return undefined;
  }
  if (tokenIs(token, "list")) return tokensDirection(token.items);
  if (tokenIs(token, "table"))
    return tokensDirection([...token.header, ...token.rows.flat()].flatMap((cell) => cell.tokens));
  if (tokenIs(token, "link") && linkTitle(token.text, token.href) === undefined) return undefined;
  if ("tokens" in token && token.tokens) return tokensDirection(token.tokens);
  return "text" in token && typeof token.text === "string" ? textDirection(token.text) : undefined;
}

function textTokenEndsWithTagMarker(token: Token | undefined): boolean {
  return token !== undefined && tokenIs(token, "text") && !token.tokens && token.text.endsWith("@");
}

function semanticChatTag(token: Token | undefined): string | null {
  if (!token || !tokenIs(token, "link")) return null;
  const target = /^(agent|skill|mcp|quote|tab|thread)(?:\+uri)?:([^\r\n]+)$/u.exec(token.href);
  return target?.[2] ? `@${token.raw}` : null;
}

function MarkdownImage(props: {
  url: string;
  alt: string;
  title: string | undefined;
  onOpenImage: ((image: HTMLImageElement) => void) | undefined;
}) {
  const { t } = useText();
  const [failedUrl, setFailedUrl] = createSignal<string>();
  const loadingUrl = () => (failedUrl() === props.url ? undefined : props.url);
  return (
    <Show
      when={loadingUrl()}
      keyed
      fallback={
        <span class="message-markdown-image-unavailable">
          {t("chat.image.unavailableNamed", { name: markdownImageName(props.alt, props.url) })}
        </span>
      }
    >
      {(url) => {
        const image = () => (
          <img
            class="message-markdown-image"
            src={url}
            alt={props.alt}
            title={props.title}
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            onError={() => setFailedUrl(url)}
          />
        );
        return (
          <Show when={props.onOpenImage} fallback={image()}>
            {(onOpenImage) => (
              <Button
                variant="ghost"
                type="button"
                class="message-markdown-image-button"
                aria-label={t("chat.image.preview", { name: markdownImageName(props.alt, url) })}
                data-cuelume-tap="open"
                onClick={(event) => {
                  const picture = event.currentTarget.querySelector("img");
                  if (picture) onOpenImage()(picture);
                }}
              >
                {image()}
              </Button>
            )}
          </Show>
        );
      }}
    </Show>
  );
}

function RichText(props: {
  body: string;
  content: MarkdownContentProps;
  streaming?: boolean | undefined;
  streamingTailAfter?: number | undefined;
}) {
  return (
    <RichMessageText
      {...props.content}
      body={props.streaming ? hideIncompleteEmphasisMarker(props.body) : props.body}
      showCitationFooter={false}
      streamingTailAfter={props.streamingTailAfter}
    />
  );
}

function hideIncompleteEmphasisMarker(body: string): string {
  const characters = [...body];
  const markers = incompleteEmphasisMarkers(characters);
  for (const marker of markers.reverse()) characters.splice(marker.index, marker.length);
  return characters.join("");
}

function incompleteEmphasisMarkerTokenIndexes(tokens: Token[]): Set<number> {
  const characters: string[] = [];
  const owners: number[] = [];
  for (const [tokenIndex, token] of tokens.entries()) {
    for (const character of [...token.raw]) {
      characters.push(character);
      owners.push(token.type === "text" ? tokenIndex : -1);
    }
  }
  const markers = incompleteEmphasisMarkers(
    characters,
    (start, end) => owners[start] !== -1 && owners[start] === owners[end - 1],
  );
  return new Set(
    markers
      .map((marker) => owners[marker.index])
      .filter((owner): owner is number => owner !== undefined && owner !== -1),
  );
}

function incompleteEmphasisMarkers(
  characters: string[],
  eligible: (start: number, end: number) => boolean = () => true,
): Array<{ index: number; length: number }> {
  const markers: Array<{ index: number; length: number }> = [];
  for (let index = 0; index < characters.length; ) {
    const delimiter = characters[index];
    if (delimiter !== "*" && delimiter !== "_") {
      index += 1;
      continue;
    }
    let runEnd = index + 1;
    while (characters[runEnd] === delimiter) runEnd += 1;
    const previous = characters[index - 1];
    const next = characters[runEnd];
    if (eligible(index, runEnd) && canOpenEmphasisDelimiter(delimiter, previous, next)) {
      markers.push({ index, length: runEnd - index });
    }
    index = runEnd;
  }
  return markers;
}

function canOpenEmphasisDelimiter(delimiter: "*" | "_", previous: string | undefined, next: string | undefined) {
  if (next === undefined) {
    return previous === undefined || isMarkdownWhitespace(previous) || isMarkdownPunctuation(previous);
  }
  return (
    isLeftFlankingMarkdownDelimiter(previous, next) &&
    (delimiter === "*" ||
      !isRightFlankingMarkdownDelimiter(previous, next) ||
      (previous !== undefined && isMarkdownPunctuation(previous)))
  );
}

function isLeftFlankingMarkdownDelimiter(previous: string | undefined, next: string | undefined): boolean {
  return (
    next !== undefined &&
    !isMarkdownWhitespace(next) &&
    (!isMarkdownPunctuation(next) ||
      previous === undefined ||
      isMarkdownWhitespace(previous) ||
      isMarkdownPunctuation(previous))
  );
}

function isRightFlankingMarkdownDelimiter(previous: string | undefined, next: string | undefined): boolean {
  return (
    previous !== undefined &&
    !isMarkdownWhitespace(previous) &&
    (!isMarkdownPunctuation(previous) ||
      next === undefined ||
      isMarkdownWhitespace(next) ||
      isMarkdownPunctuation(next))
  );
}

function isMarkdownWhitespace(value: string): boolean {
  return /\s/u.test(value);
}

function isMarkdownPunctuation(value: string): boolean {
  return /[\p{P}\p{S}]/u.test(value);
}

function lastRenderableTokenIndex(tokens: Token[]): number {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (tokens[index]?.type !== "space" && tokens[index]?.type !== "def") return index;
  }
  return -1;
}

function activeStreamingBlockTokenIndex(tokens: Token[]): number {
  const index = lastRenderableTokenIndex(tokens);
  if (index === -1 || index !== tokens.length - 1) return -1;
  const token = tokens[index];
  if (!token || (tokenIs(token, "heading") && token.raw.includes("\n"))) return -1;
  return index;
}

function activeStreamingTableCellIndex(token: Tokens.Table): number {
  const row = token.rows.at(-1);
  if (!row || /\n[\t ]*$/u.test(token.raw)) return -1;
  const sourceRow = token.raw.split("\n").at(-1)?.trimEnd();
  if (!sourceRow) return -1;

  const finalCharacterIndex = sourceRow.length - 1;
  if (sourceRow[finalCharacterIndex] === "|" && !isEscapedMarkdownCharacter(sourceRow, finalCharacterIndex)) {
    return -1;
  }

  let sourceIndex = sourceRow.search(/\S/u);
  if (sourceIndex === -1) return -1;
  if (sourceRow[sourceIndex] === "|") sourceIndex += 1;

  let cellIndex = 0;
  for (; sourceIndex < sourceRow.length; sourceIndex += 1) {
    if (sourceRow[sourceIndex] === "|" && !isEscapedMarkdownCharacter(sourceRow, sourceIndex)) cellIndex += 1;
  }
  return cellIndex < row.length ? cellIndex : -1;
}

function containerClosesFinalNestedTable(token: Tokens.Blockquote | Tokens.List): boolean {
  if (!/\n[\t ]*$/u.test(token.raw)) return false;
  return finalNestedBlockToken(token) === "table";
}

function finalNestedBlockToken(token: Tokens.Blockquote | Tokens.List): Token["type"] | undefined {
  if (tokenIs(token, "list")) {
    const item = token.items.at(-1);
    if (!item) return token.type;
    return finalNestedTokenType(item.tokens);
  }
  return finalNestedTokenType(token.tokens);
}

function finalNestedTokenType(tokens: Token[]): Token["type"] | undefined {
  const index = lastRenderableTokenIndex(tokens);
  const token = tokens[index];
  if (!token) return undefined;
  if (tokenIs(token, "blockquote") || tokenIs(token, "list")) return finalNestedBlockToken(token);
  return token.type;
}

function isEscapedMarkdownCharacter(value: string, index: number): boolean {
  let slashCount = 0;
  for (let slashIndex = index - 1; slashIndex >= 0 && value[slashIndex] === "\\"; slashIndex -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

export function markdownPlainText(body: string): string {
  return markdownInlinePlainText(lexInlineTokens(body));
}

function markdownInlinePlainText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (tokenIs(token, "strong")) return markdownInlinePlainText(token.tokens);
      if (tokenIs(token, "em")) return markdownInlinePlainText(token.tokens);
      if (tokenIs(token, "del")) return markdownInlinePlainText(token.tokens);
      if (tokenIs(token, "link")) return markdownInlinePlainText(token.tokens);
      if (tokenIs(token, "text")) return token.tokens ? markdownInlinePlainText(token.tokens) : token.text;
      if (tokenIs(token, "codespan") || tokenIs(token, "escape") || tokenIs(token, "image")) return token.text;
      if (tokenIs(token, "inlineMath")) return token.raw;
      if (tokenIs(token, "attachmentTag")) return token.text;
      if (token.type === "br") return "\n";
      return token.raw;
    })
    .join("");
}

function LocalFileLink(props: {
  path: string;
  label: string;
  kind: "shared" | "workspace";
  onOpen: (path: string) => void;
}) {
  const { t } = useText();
  const folder = props.kind === "workspace" && /[/\\]$/u.test(props.path);
  const name = fileReferenceName(folder ? props.path.replace(/[/\\]+$/u, "") : props.path);
  const label = () => {
    if (props.kind === "shared") return t("chat.file.openShared", { name });
    return folder ? t("chat.file.openWorkspaceFolder", { name }) : t("chat.file.openWorkspace", { name });
  };
  return (
    <Button
      variant="ghost"
      type="button"
      class="message-file-reference"
      data-file-tone={attachmentReferenceTone(name)}
      aria-label={label()}
      title={props.path}
      data-cuelume-tap="open"
      onClick={() => props.onOpen(props.path)}
    >
      <AttachmentReferenceVisual name={name} />
      <span class="inline-file-reference-name" dir="auto">
        {props.label || name}
      </span>
    </Button>
  );
}

function sharedFileTarget(value: string): string | null {
  const path = value.trim();
  if (!path || /[\0\r\n]/u.test(path)) return null;
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("~/OpenBot/Shared/") ||
    normalized.startsWith("OpenBot/Shared/") ||
    normalized.includes("/OpenBot/Shared/")
    ? path
    : null;
}

function repairEscapedLocalFileLinkTokens(tokens: Token[]): Token[] {
  const raw = tokens.map((token) => token.raw).join("");
  if (!raw.includes("\\(<")) return tokens;
  const result: Token[] = [];
  let candidates: Token[] = [];
  const openHtmlElements: string[] = [];
  const flushCandidates = () => {
    if (candidates.length === 0) return;
    const source = candidates.map((token) => token.raw).join("");
    const maskedSource = candidates.map(maskProtectedMarkdownToken).join("");
    const repaired = normalizeEscapedLocalFileLinkCandidate(source, maskedSource);
    result.push(...(repaired === source ? candidates : markdown.Lexer.lexInline(repaired, markdown.defaults)));
    candidates = [];
  };
  for (const token of tokens) {
    if (token.type === "html") {
      flushCandidates();
      result.push(token);
      updateOpenHtmlElements(openHtmlElements, token.raw);
      continue;
    }
    if (openHtmlElements.length > 0) {
      flushCandidates();
      result.push(token);
      continue;
    }
    candidates.push(token);
  }
  flushCandidates();
  return result;
}

function maskProtectedMarkdownToken(token: Token): string {
  if (token.type === "html" || tokenIs(token, "codespan") || tokenIs(token, "inlineMath")) {
    return " ".repeat(token.raw.length);
  }
  const children =
    tokenIs(token, "strong") ||
    tokenIs(token, "em") ||
    tokenIs(token, "del") ||
    tokenIs(token, "link") ||
    tokenIs(token, "text")
      ? token.tokens
      : undefined;
  if (!children?.length) return token.raw;

  let masked = token.raw;
  let searchStart = 0;
  for (const child of children) {
    const childStart = token.raw.indexOf(child.raw, searchStart);
    if (childStart < 0) continue;
    const protectedChild = maskProtectedMarkdownToken(child);
    masked = `${masked.slice(0, childStart)}${protectedChild}${masked.slice(childStart + child.raw.length)}`;
    searchStart = childStart + child.raw.length;
  }
  return masked;
}

function updateOpenHtmlElements(elements: string[], raw: string): void {
  if (/^\s*<(?:!--|!|\?)/u.test(raw)) return;
  for (const match of raw.matchAll(/<\s*(\/?)\s*([A-Za-z][\w:-]*)\b[^>]*>/gu)) {
    const name = (match[2] ?? "").toLowerCase();
    if (!name) continue;
    if (match[1]) {
      const openingIndex = elements.lastIndexOf(name);
      if (openingIndex >= 0) elements.splice(openingIndex);
      continue;
    }
    if (!match[0].endsWith("/>") && !VOID_HTML_ELEMENTS.has(name)) elements.push(name);
  }
}

function normalizeEscapedLocalFileLinkCandidate(value: string, maskedValue = value): string {
  const pattern = /(?<!!)(\[[^\]\r\n]+\])\\\(<([^<>\r\n]+)>(\\?\))/gu;
  let result = "";
  let cursor = 0;
  for (const match of maskedValue.matchAll(pattern)) {
    const start = match.index;
    const labelLength = match[1]?.length ?? 0;
    const targetLength = match[2]?.length ?? 0;
    const targetStart = start + labelLength + 3;
    const target = value.slice(targetStart, targetStart + targetLength);
    if (!localFileTarget(target)) continue;
    const label = value.slice(start, start + labelLength);
    result += `${value.slice(cursor, start)}${label}(<${target}>)`;
    cursor = start + match[0].length;
  }
  return cursor === 0 ? value : result + value.slice(cursor);
}

function localFileTarget(value: string): string | null {
  const path = value.trim();
  if (path.startsWith("//")) return null;
  const workspace = workspaceFileTarget(path);
  if (!workspace) return null;
  const shared = sharedFileTarget(path);
  if (shared) return shared;
  return /^(?:~[/\\]|[/\\]|[A-Za-z]:[/\\])/u.test(path) || isFileReference(path) ? workspace : null;
}

function fileUrlPath(value: string): string | null {
  const match = /^file:\/\/(?:localhost)?(\/.*)$/iu.exec(value.trim());
  if (!match?.[1]) return null;
  return /^\/[A-Za-z]:\//u.test(match[1]) ? match[1].slice(1) : match[1];
}

function decodedFileUrlPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function workspaceFileTarget(value: string): string | null {
  const path = value.trim();
  if (!path || /[\0\r\n]/u.test(path) || path.startsWith("#")) return null;
  if (/^[A-Za-z]:[/\\]/u.test(path)) return path;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(path)) return null;
  return path;
}

function messageFileDirectory(body: string): FileDirectoryContext | null {
  const contexts = new Map<string, FileDirectoryContext>();
  for (const match of body.matchAll(/`([^`\r\n]+[/\\])`/gu)) {
    const path = match[1]?.trim();
    if (!path) continue;
    const shared = sharedFileTarget(`${path}file`);
    const workspace = workspaceFileTarget(`${path}file`);
    if (shared) contexts.set(path, { path, kind: "shared" });
    else if (workspace) contexts.set(path, { path, kind: "workspace" });
  }
  return contexts.size === 1 ? (contexts.values().next().value ?? null) : null;
}

const ABSOLUTE_PATH = /^(?:~[/\\]|[/\\]|[A-Za-z]:[/\\])/u;

function absoluteFilePath(path: string): boolean {
  if (!ABSOLUTE_PATH.test(path) || /^[/\\]{2}/u.test(path) || /[\0\r\n]/u.test(path)) return false;
  if (!/^[^.].*\.[\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*$/u.test(fileReferenceName(path))) return false;
  if (!/\s/u.test(path)) return true;
  return !/\s-+\p{L}/u.test(path) && !/[/\\]s?bin[/\\]/u.test(path.split(/\s/u)[0] ?? "");
}

function mentionedFileTarget(
  value: string,
  directory: FileDirectoryContext | null,
): (FileDirectoryContext & { asWritten?: string }) | null {
  const path = value.trim();
  if (!isFileReference(path) && !absoluteFilePath(path)) return null;
  const shared = sharedFileTarget(path);
  if (shared) return { path: shared, kind: "shared" };
  if (ABSOLUTE_PATH.test(path)) {
    const workspace = workspaceFileTarget(path);
    return workspace ? { path: workspace, kind: "workspace" } : null;
  }
  if (!directory) return { path, kind: "workspace" };
  const separator = directory.path.includes("\\") && !directory.path.includes("/") ? "\\" : "/";
  return {
    path: `${directory.path.replace(/[/\\]+$/u, "")}${separator}${path}`,
    kind: directory.kind,
    asWritten: path,
  };
}

const IMAGE_FILE_PATTERN = /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu;
const IMAGE_FILE_LIMIT = INPUT_LIMITS.attachments;

export type MessageImageFile = FileDirectoryContext;

export function messageImageFiles(blocks: readonly string[]): MessageImageFile[] {
  const files = new Map<string, MessageImageFile>();
  for (const body of blocks) {
    const directory = messageFileDirectory(body);
    void markdown.walkTokens(lexBlockTokens(body, true), (token) => {
      const file = tokenIs(token, "codespan")
        ? mentionedFileTarget(token.text, directory)
        : tokenIs(token, "link")
          ? linkFileTarget(writtenLinkTarget(token))
          : null;
      if (file && IMAGE_FILE_PATTERN.test(fileReferenceName(file.path)))
        files.set(`${file.kind}:${file.path}`, { path: file.path, kind: file.kind });
    });
  }
  return [...files.values()].slice(0, IMAGE_FILE_LIMIT);
}

const MARKDOWN_ESCAPABLE = /[!-/:-@[-`{-~]/u;
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[/\\]|\\\\)/u;

function writtenLinkTarget(token: { raw: string; href: string }): string {
  const { raw, href } = token;
  for (const match of raw.matchAll(/\]\(\s*<?/gu)) {
    const start = match.index + match[0].length;
    let index = start;
    let parsed = 0;
    while (parsed < href.length && index < raw.length) {
      const escaped = raw[index] === "\\" && MARKDOWN_ESCAPABLE.test(raw[index + 1] ?? "");
      if ((escaped ? raw[index + 1] : raw[index]) !== href[parsed]) break;
      index += escaped ? 2 : 1;
      parsed += 1;
    }
    const written = raw.slice(start, index);
    if (parsed !== href.length || !WINDOWS_ABSOLUTE_PATH.test(written)) continue;
    return written.slice(2).includes("\\\\") ? href : written;
  }
  return href;
}

function linkFileTargets(href: string): { shared: string | null; workspace: string | null } {
  const fileUrl = fileUrlPath(href);
  return {
    shared: sharedFileTarget(decodedFileUrlPath(fileUrl ?? href)),
    workspace: workspaceFileTarget(fileUrl ?? href),
  };
}

function linkFileTarget(href: string): FileDirectoryContext | null {
  if (safeBrowserUrl(href)) return null;
  const { shared, workspace } = linkFileTargets(href);
  if (shared) return { path: shared, kind: "shared" };
  return workspace ? { path: workspace, kind: "workspace" } : null;
}
