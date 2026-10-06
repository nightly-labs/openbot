import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { Button, Check, Copy } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { type ShjLanguage, type ShjToken, tokenize } from "@speed-highlight/core";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { useText } from "../../text";
import type { MessageCodeBlock } from "./DataTable";

interface CodeToken {
  text: string;
  type?: ShjToken;
}

type CodeLine = CodeToken[];

interface HighlightedCode {
  /** The highlighted source. While the block streams, this ends at its last line break. */
  code: string;
  language: ShjLanguage;
  lines: CodeLine[];
  /** For each line start, whether the tokenizer had no open token there, so it can start again there. */
  restarts: boolean[];
}

const LANGUAGE_ALIASES: Record<string, ShjLanguage> = {
  assembly: "asm",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  cpp: "c",
  cxx: "c",
  dockerfile: "docker",
  golang: "go",
  htaccess: "http",
  javascript: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  markdown: "md",
  perl: "pl",
  plaintext: "plain",
  text: "plain",
  txt: "plain",
  python: "py",
  rust: "rs",
  scss: "css",
  typescript: "ts",
  tsx: "ts",
  svg: "xml",
  yml: "yaml",
};

const SUPPORTED_LANGUAGES = new Set<string>([
  "asm",
  "bash",
  "bf",
  "c",
  "css",
  "csv",
  "diff",
  "docker",
  "git",
  "go",
  "html",
  "http",
  "ini",
  "java",
  "js",
  "jsdoc",
  "json",
  "leanpub-md",
  "log",
  "lua",
  "make",
  "md",
  "pl",
  "plain",
  "py",
  "regex",
  "rs",
  "sql",
  "todo",
  "toml",
  "ts",
  "uri",
  "xml",
  "yaml",
]);

// Words, not language names: these are translated.
const LANGUAGE_TEXT_KEYS = {
  asm: "chat.code.language.assembly",
  bash: "chat.code.language.shell",
  diff: "chat.code.language.diff",
  plain: "chat.code.language.plain",
  regex: "chat.code.language.regex",
} as const satisfies Partial<Record<ShjLanguage, AppTextKey>>;

// Mermaid has no highlighter, so it shows as plain code with its own name.
const PLAIN_LANGUAGE_LABELS: Record<string, string> = { mermaid: "Mermaid", mmd: "Mermaid" };

const LANGUAGE_LABELS: Partial<Record<ShjLanguage, string>> = {
  c: "C",
  css: "CSS",
  csv: "CSV",
  docker: "Dockerfile",
  go: "Go",
  html: "HTML",
  http: "HTTP",
  ini: "INI",
  java: "Java",
  js: "JavaScript",
  jsdoc: "JSDoc",
  json: "JSON",
  lua: "Lua",
  make: "Makefile",
  md: "Markdown",
  py: "Python",
  rs: "Rust",
  sql: "SQL",
  toml: "TOML",
  ts: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

export function CodeBlock(props: {
  block: MessageCodeBlock;
  streaming?: boolean | undefined;
  /** Buttons before Copy, such as the switch between a preview and its code. */
  actions?: JSX.Element;
  /** Buttons after Copy, such as the button that opens a larger view. */
  trailingActions?: JSX.Element;
  /** Places the code lines in a larger body, such as beside a rendered preview of the code. */
  body?: ((code: JSX.Element) => JSX.Element) | undefined;
}) {
  const { t } = useText();
  const [lines, setLines] = createSignal<CodeLine[]>(untrack(() => plainCodeLines(props.block.code)));
  const [copied, setCopied] = createSignal(false);
  let highlightRun = 0;
  let highlighted: HighlightedCode | undefined;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  const language = () => codeLanguage(props.block.language);
  const languageLabel = () => codeLanguageLabel(props.block.language, t);
  // A memo, because the caller computes this prop again for each streamed step of the message.
  const streaming = createMemo(() => props.streaming === true);

  // While the block streams, only complete lines are highlighted, and only from the last line that
  // the tokenizer can start again at. The open line shows as plain text until it ends. The complete
  // block is highlighted whole once, so a color that depends on later lines is correct at the end.
  createEffect(
    () => ({ code: props.block.code, language: language(), streaming: streaming() }),
    ({ code, language: selectedLanguage, streaming: blockStreaming }) => {
      const run = ++highlightRun;
      const languageChanged = highlighted !== undefined && highlighted.language !== selectedLanguage;
      if (languageChanged) highlighted = undefined;
      setLines((current) => reusedCodeLines(code, highlighted?.lines ?? [], languageChanged ? [] : current));
      if (selectedLanguage === "plain") return;

      const source = blockStreaming ? code.slice(0, code.lastIndexOf("\n") + 1) : code;
      if (blockStreaming && highlighted?.code === source) return;
      void highlightedCode(source, selectedLanguage, blockStreaming ? highlighted : undefined).then((result) => {
        if (run !== highlightRun) return;
        highlighted = result;
        setLines((current) => reusedCodeLines(code, result.lines, current));
      });
    },
  );

  onCleanup(() => {
    highlightRun += 1;
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.block.code);
      setCopied(true);
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  // One element, so the code keeps its scroll position when a caller moves it into its body.
  const code = (
    <pre class="message-code-scroll" tabindex="0">
      <code>
        <For each={lines()}>
          {(line, lineIndex) => (
            <span class="message-code-line">
              <span class="message-code-line-number" aria-hidden="true">
                {lineIndex() + 1}
              </span>
              <span class="message-code-line-source">
                <For each={line}>{(token) => <span data-code-token={token.type}>{token.text}</span>}</For>
                <Show when={streaming() && lineIndex() === lines().length - 1}>
                  <span class="message-code-caret" aria-hidden="true" />
                </Show>
              </span>
            </span>
          )}
        </For>
      </code>
    </pre>
  );

  return (
    <section class="message-code-block" aria-label={t("chat.code.blockLabel", { language: languageLabel() })}>
      <header class="message-code-header">
        <div class="message-code-heading">
          <Show when={props.block.filename}>
            {(filename) => <span class="message-code-filename">{filename()}</span>}
          </Show>
          <span class="message-code-language">{languageLabel()}</span>
        </div>
        <div class="message-code-actions">
          {props.actions}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            class="message-code-copy"
            aria-label={copied() ? t("chat.code.copied") : t("chat.code.copy")}
            onClick={() => void copy()}
          >
            <span class="message-code-copy-icons" aria-hidden="true">
              <span data-visible={!copied() ? "true" : undefined}>
                <Copy />
              </span>
              <span data-visible={copied() ? "true" : undefined}>
                <Check />
              </span>
            </span>
            <span>{copied() ? t("common.copied") : t("common.copy")}</span>
          </Button>
          {props.trailingActions}
        </div>
      </header>
      {props.body ? props.body(code) : code}
    </section>
  );
}

export function codeLanguage(language: string): ShjLanguage {
  const normalized = language.trim().toLowerCase();
  if (!normalized) return "plain";
  const alias = LANGUAGE_ALIASES[normalized];
  if (alias) return alias;
  return isSupportedLanguage(normalized) ? normalized : "plain";
}

function isSupportedLanguage(language: string): language is ShjLanguage {
  return SUPPORTED_LANGUAGES.has(language);
}

function isTranslatedLanguage(language: ShjLanguage): language is keyof typeof LANGUAGE_TEXT_KEYS {
  return language in LANGUAGE_TEXT_KEYS;
}

export function codeLanguageLabel(language: string, t: AppTranslate): string {
  const normalized = codeLanguage(language);
  if (normalized !== "plain") {
    if (isTranslatedLanguage(normalized)) return t(LANGUAGE_TEXT_KEYS[normalized]);
    return LANGUAGE_LABELS[normalized] ?? normalized.toUpperCase();
  }
  const original = language.trim();
  const plainLabel = PLAIN_LANGUAGE_LABELS[original.toLowerCase()];
  if (plainLabel) return plainLabel;
  return original ? original.toUpperCase() : t(LANGUAGE_TEXT_KEYS.plain);
}

function plainCodeLines(code: string): CodeLine[] {
  return code.split("\n").map((line) => [{ text: line }]);
}

function codeLineText(line: CodeLine | undefined): string | undefined {
  return line?.map((token) => token.text).join("");
}

function sameCodeLine(left: CodeLine, right: CodeLine): boolean {
  return (
    left.length === right.length &&
    left.every((token, index) => token.text === right[index]?.text && token.type === right[index]?.type)
  );
}

/**
 * The lines of `code`: a highlighted line, else a current line, else plain text, each only while
 * its text is still the same. A line equal to the current one is the current array, so `For`
 * keeps its elements.
 */
function reusedCodeLines(code: string, highlightedLines: CodeLine[], current: CodeLine[]): CodeLine[] {
  return code.split("\n").map((text, index) => {
    const highlightedLine = highlightedLines[index];
    const currentLine = current[index];
    const line =
      highlightedLine && codeLineText(highlightedLine) === text
        ? highlightedLine
        : currentLine && codeLineText(currentLine) === text
          ? currentLine
          : [{ text }];
    return currentLine && sameCodeLine(currentLine, line) ? currentLine : line;
  });
}

// Languages that contain lines of a different language, such as script in HTML or a fence in
// Markdown. Their lines have no type, so each one looks like a restart point.
const EMBEDDING_LANGUAGES = new Set<ShjLanguage>(["html", "md", "leanpub-md"]);

/**
 * Highlights `code`. With an earlier result for the start of the same code, the lines before a
 * restart point are kept and only the rest is tokenized.
 *
 * Text with no type can also come from a sub-language, such as script in HTML, so a restart point
 * can be false. Tokenizing starts before at least one complete line of the earlier result. A
 * different token on those lines, or a tail that ends in an open token, such as a string that a
 * false restart point started, tokenizes the whole code instead.
 */
async function highlightedCode(
  code: string,
  language: ShjLanguage,
  earlier: HighlightedCode | undefined,
): Promise<HighlightedCode> {
  if (earlier && !EMBEDDING_LANGUAGES.has(language) && code.startsWith(earlier.code)) {
    const completeLines = earlier.lines.length - 1;
    const restart = earlier.restarts.lastIndexOf(true, completeLines - 1);
    if (restart > 0) {
      const kept = earlier.lines.slice(0, restart);
      const start = kept.reduce((length, line) => length + (codeLineText(line)?.length ?? 0) + 1, 0);
      const rest = await tokenizedCode(code.slice(start), language);
      const overlap = earlier.lines.slice(restart, completeLines);
      if (
        rest &&
        rest.restarts.at(-1) !== false &&
        overlap.every((line, index) => sameCodeLine(line, rest.lines[index] ?? []))
      ) {
        return {
          code,
          language,
          lines: [...kept, ...rest.lines],
          restarts: [...earlier.restarts.slice(0, restart), ...rest.restarts],
        };
      }
    }
  }
  const whole = await tokenizedCode(code, language);
  return { code, language, lines: whole?.lines ?? plainCodeLines(code), restarts: whole?.restarts ?? [] };
}

async function tokenizedCode(
  code: string,
  language: ShjLanguage,
): Promise<Pick<HighlightedCode, "lines" | "restarts"> | undefined> {
  const lines: CodeLine[] = [[]];
  // Line 0 is a restart point: it is the block start or an earlier restart point.
  const restarts = [true];
  try {
    // At the top level of a language, text that no rule matches has no type.
    await tokenize(code, language, (text, type) => {
      const fragments = text.split("\n");
      for (const [index, fragment] of fragments.entries()) {
        if (fragment) lines.at(-1)?.push({ text: fragment, type });
        if (index < fragments.length - 1) {
          lines.push([]);
          restarts.push(type === undefined);
        }
      }
    });
    return { lines, restarts };
  } catch {
    return undefined;
  }
}
