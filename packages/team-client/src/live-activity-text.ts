import { chatMathStart, inlineChatMath } from "@openbot/contracts/chat-math";

/**
 * A message as one line of inline Markdown for the Live Activity. SwiftUI shows only inline
 * Markdown in a `Text` (bold, italic, code, strikethrough), and the island has two lines. So blocks
 * become one line: a heading is bold, a list item starts with a bullet, a table row joins its
 * cells, and links and images keep their text. The widget cannot typeset LaTeX, so math becomes
 * Unicode where it can, such as `x^2` → x² and `\frac{a}{b}` → a/b.
 *
 * The result has at most `limit` visible characters. A cut closes the open marks, so no `**` stays.
 */
export function liveActivityMarkdown(source: string, limit: number): string {
  return truncateMarkdown(inlineText(blockText(source)), limit);
}

function blockText(source: string): string {
  const parts: string[] = [];
  let fence: { marker: string; math: boolean; lines: string[] } | null = null;
  for (const line of source.replace(/\r\n?/gu, "\n").split("\n")) {
    const opening = /^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)/u.exec(line);
    if (!fence && opening?.[1]) {
      fence = { marker: opening[1], math: opening[2] === "math", lines: [] };
      continue;
    }
    if (fence) {
      if (line.trim().startsWith(fence.marker)) {
        parts.push(fenceText(fence));
        fence = null;
      } else fence.lines.push(line.trim());
      continue;
    }
    const text = blockLine(line);
    if (text) parts.push(text);
  }
  if (fence) parts.push(fenceText(fence));
  return parts.join(" ");
}

function fenceText(fence: { math: boolean; lines: string[] }): string {
  const content = fence.lines.filter(Boolean).join(" ");
  if (!content) return "";
  return fence.math ? escapeMarkdown(texToUnicode(content)) : codeSpan(content);
}

function blockLine(line: string): string {
  let text = line.trim();
  if (!text) return "";
  // A rule, or the line under a table header.
  if (/^(?:[-*_]\s*){3,}$/u.test(text) || /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/u.test(text)) return "";
  const heading = /^#{1,6}\s+(.*?)(?:\s+#+)?$/u.exec(text);
  if (heading?.[1]) return `**${heading[1].replaceAll("**", "")}**`;
  text = text.replace(/^(?:>\s?)+/u, "");
  const task = /^[-*+]\s+\[([ xX])\]\s+/u.exec(text);
  if (task) return `${task[1] === " " ? "☐" : "☑"} ${text.slice(task[0].length)}`;
  text = text.replace(/^[-*+]\s+/u, "• ");
  if (text.startsWith("|")) {
    return text
      .replace(/^\||\|$/gu, "")
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(" · ");
  }
  return text;
}

/** Keeps code spans as they are, turns math into Unicode, and flattens links, images and HTML. */
function inlineText(source: string): string {
  let result = "";
  let rest = source;
  while (rest) {
    const code = /`+/u.exec(rest);
    const math = chatMathStart(rest);
    const next = Math.min(code?.index ?? rest.length, math ?? rest.length);
    result += inlineMarks(rest.slice(0, next));
    rest = rest.slice(next);
    if (!rest) break;
    if (code && code.index === next) {
      const end = rest.indexOf(code[0], code[0].length);
      if (end > 0) {
        result += rest.slice(0, end + code[0].length);
        rest = rest.slice(end + code[0].length);
        continue;
      }
    } else {
      const found = inlineChatMath(rest);
      if (found) {
        result += escapeMarkdown(texToUnicode(found.tex));
        rest = rest.slice(found.raw.length);
        continue;
      }
    }
    // A backtick or a `$` that opens nothing is text.
    result += escapeMarkdown(rest.charAt(0));
    rest = rest.slice(1);
  }
  return result.replace(/\s+/gu, " ").trim();
}

function inlineMarks(text: string): string {
  return text
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/<\/?[A-Za-z][^>]*>/gu, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<(https?:\/\/[^>]+)>/gu, "$1")
    .replace(/__(?=\S)(.+?)(?<=\S)__/gu, "**$1**");
}

function codeSpan(content: string): string {
  return content.includes("`") ? `\`\` ${content} \`\`` : `\`${content}\``;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_`~[\]]/gu, (character) => `\\${character}`);
}

/**
 * Cuts inline Markdown at `limit` visible characters and closes the marks that are open there. A
 * lone `*` that opens no emphasis can still count as a mark, and the cut then adds one `*`.
 */
function truncateMarkdown(text: string, limit: number): string {
  const marks: string[] = [];
  let visible = 0;
  let index = 0;
  const total = visibleLength(text);
  if (total <= limit) return text;
  while (index < text.length && visible < limit - 1) {
    const character = text.charAt(index);
    if (character === "\\" && index + 1 < text.length) {
      index += 2;
      visible += 1;
      continue;
    }
    const run = /^`+/u.exec(text.slice(index))?.[0];
    if (run) {
      const end = text.indexOf(run, index + run.length);
      if (end > 0) {
        const content = text.slice(index + run.length, end);
        const room = limit - 1 - visible;
        if (content.length > room) {
          return `${text.slice(0, index + run.length)}${content.slice(0, room)}${run}…${closing(marks)}`;
        }
        visible += content.length;
        index = end + run.length;
        continue;
      }
    }
    const mark = text.startsWith("**", index)
      ? "**"
      : text.startsWith("~~", index)
        ? "~~"
        : character === "*"
          ? "*"
          : null;
    if (mark) {
      if (marks.at(-1) === mark) marks.pop();
      else marks.push(mark);
      index += mark.length;
      continue;
    }
    const point = text.codePointAt(index) ?? 0;
    index += point > 0xffff ? 2 : 1;
    visible += 1;
  }
  return `${text.slice(0, index).trimEnd()}…${closing(marks)}`;
}

function closing(marks: readonly string[]): string {
  return [...marks].reverse().join("");
}

function visibleLength(text: string): number {
  const plain = text
    .replace(/\\(.)/gu, "$1")
    .replace(/\*\*|~~|`+/gu, "")
    .replace(/\*/gu, "");
  return Array.from(plain).length;
}

/** Writes LaTeX as Unicode text. A command it does not know keeps its name. */
export function texToUnicode(tex: string): string {
  let text = tex;
  for (let pass = 0; pass < 4; pass += 1) {
    text = text
      .replace(/\\(?:[dt]?frac|cfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/gu, (_, top: string, bottom: string) => {
        return `${grouped(top)}/${grouped(bottom)}`;
      })
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/gu, (_, root: string, value: string) => {
        return `${script(root, SUPERSCRIPT, "^")}√${grouped(value)}`;
      })
      .replace(/\\sqrt\s*\{([^{}]*)\}/gu, (_, value: string) => `√${grouped(value)}`)
      .replace(/\\mathbb\s*\{([A-Za-z])\}/gu, (_, letter: string) => DOUBLE_STRUCK[letter] ?? letter)
      .replace(
        /\\(?:text|textrm|textbf|textit|mathrm|mathbf|mathit|mathsf|mathtt|mathcal|operatorname|boldsymbol)\s*\{([^{}]*)\}/gu,
        "$1",
      );
  }
  text = text
    .replace(/\\([A-Za-z]+)/gu, (_, name: string) => SYMBOLS[name] ?? name)
    .replace(/\\\\/gu, " ")
    .replace(/\\[,;:! ]/gu, " ")
    .replace(/\\([$%&#_{}])/gu, "$1");
  for (let pass = 0; pass < 2; pass += 1) {
    text = text
      .replace(/\^\s*\{([^{}]*)\}/gu, (_, value: string) => script(value, SUPERSCRIPT, "^"))
      .replace(/_\s*\{([^{}]*)\}/gu, (_, value: string) => script(value, SUBSCRIPT, "_"));
  }
  return text
    .replace(/\^\s*([^\s{}])/gu, (_, value: string) => script(value, SUPERSCRIPT, "^"))
    .replace(/_\s*([^\s{}])/gu, (_, value: string) => script(value, SUBSCRIPT, "_"))
    .replace(/[{}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function grouped(value: string): string {
  const text = value.trim();
  return Array.from(text).length > 1 && /[\s+\-−=·×/]/u.test(text) ? `(${text})` : text;
}

function script(value: string, table: Readonly<Record<string, string>>, mark: string): string {
  const characters = Array.from(value.trim());
  if (characters.length > 0 && characters.every((character) => table[character])) {
    return characters.map((character) => table[character]).join("");
  }
  return characters.length === 1 ? `${mark}${value.trim()}` : `${mark}(${value.trim()})`;
}

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "−": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  a: "ᵃ",
  b: "ᵇ",
  c: "ᶜ",
  d: "ᵈ",
  e: "ᵉ",
  f: "ᶠ",
  g: "ᵍ",
  h: "ʰ",
  i: "ⁱ",
  j: "ʲ",
  k: "ᵏ",
  l: "ˡ",
  m: "ᵐ",
  n: "ⁿ",
  o: "ᵒ",
  p: "ᵖ",
  r: "ʳ",
  s: "ˢ",
  t: "ᵗ",
  u: "ᵘ",
  v: "ᵛ",
  w: "ʷ",
  x: "ˣ",
  y: "ʸ",
  z: "ᶻ",
  T: "ᵀ",
  "′": "′",
  "*": "*",
};

const SUBSCRIPT: Readonly<Record<string, string>> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "−": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
};

const DOUBLE_STRUCK: Readonly<Record<string, string>> = {
  C: "ℂ",
  H: "ℍ",
  N: "ℕ",
  P: "ℙ",
  Q: "ℚ",
  R: "ℝ",
  Z: "ℤ",
};

const SYMBOLS: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  propto: "∝",
  infty: "∞",
  sum: "∑",
  prod: "∏",
  int: "∫",
  iint: "∬",
  oint: "∮",
  partial: "∂",
  nabla: "∇",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  gets: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  iff: "⇔",
  implies: "⟹",
  mapsto: "↦",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  lnot: "¬",
  land: "∧",
  wedge: "∧",
  lor: "∨",
  vee: "∨",
  oplus: "⊕",
  otimes: "⊗",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  vdots: "⋮",
  circ: "∘",
  degree: "°",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  mid: "∣",
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  prime: "′",
  star: "⋆",
  ast: "∗",
  bullet: "•",
  checkmark: "✓",
  left: "",
  right: "",
  big: "",
  Big: "",
  bigg: "",
  Bigg: "",
  displaystyle: "",
  textstyle: "",
  limits: "",
  nolimits: "",
  quad: " ",
  qquad: " ",
};
