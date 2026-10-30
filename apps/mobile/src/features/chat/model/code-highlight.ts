import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import type { ShjLanguage, ShjToken } from "@speed-highlight/core";

export interface CodeToken {
  text: string;
  type?: ShjToken;
  offset: number;
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

const LANGUAGE_LABELS: Partial<Record<ShjLanguage, string>> = {
  asm: "Assembly",
  bash: "Shell",
  c: "C",
  css: "CSS",
  csv: "CSV",
  diff: "Diff",
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
  plain: "Code",
  py: "Python",
  regex: "Regular expression",
  rs: "Rust",
  sql: "SQL",
  toml: "TOML",
  ts: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

const LANGUAGES: ShjLanguage[] = [
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
];

function codeLanguage(info = "") {
  const name = (info.trim().split(/\s+/u)[0] ?? "").toLowerCase();
  const language = LANGUAGE_ALIASES[name] ?? LANGUAGES.find((item) => item === name) ?? "plain";
  return { language, label: language === "plain" && name ? name : (LANGUAGE_LABELS[language] ?? language) };
}

const LANGUAGE_LABEL_KEYS: Partial<Record<ShjLanguage, MobileTextKey>> = {
  asm: "mobile.chat.code.language.assembly",
  bash: "mobile.chat.code.language.shell",
  diff: "mobile.chat.code.language.diff",
  plain: "mobile.chat.code.language.plain",
  regex: "mobile.chat.code.language.regex",
};

/** The label of `codeLanguage` in the interface language. A name from the fence stays as written. */
export function codeLanguageLabel(info: string | undefined, t: MobileTranslate): string {
  const { language, label } = codeLanguage(info);
  const key = LANGUAGE_LABEL_KEYS[language];
  return key && label === LANGUAGE_LABELS[language] ? t(key) : label;
}

const MAX_CACHED_HIGHLIGHTS = 100;
const highlights = new Map<string, CodeToken[]>();

function highlightKey(text: string, info: string | undefined): string {
  return `${codeLanguage(info).language}\u0000${text}`;
}

/** The tokens of a block highlighted before in this app run, so a chat that opens again shows them at once. */
export function cachedHighlight(text: string, info?: string): CodeToken[] | undefined {
  const key = highlightKey(text, info);
  const cached = highlights.get(key);
  if (!cached) return undefined;
  highlights.delete(key);
  highlights.set(key, cached);
  return cached;
}

/** `keep` stores the result for the app run. A block that still streams changes, so it does not keep it. */
export async function highlightCode(text: string, info?: string, keep = false): Promise<CodeToken[]> {
  const cached = cachedHighlight(text, info);
  if (cached) return cached;
  const { tokenize } = await import("@speed-highlight/core");
  const result: CodeToken[] = [];
  let offset = 0;
  await tokenize(text, codeLanguage(info).language, (value, type) => {
    if (!value) return;
    result.push({ text: value, type, offset });
    offset += value.length;
  });
  // A tokenizer failure must never change or duplicate the source shown to the user.
  const tokens = result.map((token) => token.text).join("") === text ? result : [{ text, offset: 0 }];
  if (!keep) return tokens;
  const oldest = highlights.keys().next().value;
  if (highlights.size >= MAX_CACHED_HIGHLIGHTS && oldest !== undefined) highlights.delete(oldest);
  highlights.set(highlightKey(text, info), tokens);
  return tokens;
}
