import { type ShjLanguage, type ShjToken, tokenize } from "@speed-highlight/core";

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

export function codeLanguage(info = "") {
  const name = info.trim().split(/\s+/u)[0].toLowerCase();
  const language = LANGUAGE_ALIASES[name] ?? LANGUAGES.find((item) => item === name) ?? "plain";
  return { language, label: language === "plain" && name ? name : (LANGUAGE_LABELS[language] ?? language) };
}

export async function highlightCode(text: string, info?: string): Promise<CodeToken[]> {
  const result: CodeToken[] = [];
  let offset = 0;
  await tokenize(text, codeLanguage(info).language, (value, type) => {
    if (!value) return;
    result.push({ text: value, type, offset });
    offset += value.length;
  });
  // A tokenizer failure must never change or duplicate the source shown to the user.
  return result.map((token) => token.text).join("") === text ? result : [{ text, offset: 0 }];
}
