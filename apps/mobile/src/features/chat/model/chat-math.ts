import katex from "katex";

/**
 * A MathML element from KaTeX. React Native has no DOM, so the app draws this tree with native
 * views instead of the KaTeX HTML that desktop shows. KaTeX still parses the LaTeX, expands its
 * macros and picks each symbol, so both apps accept the same formulas.
 */
export interface MathElement {
  tag: string;
  attributes: Readonly<Record<string, string>>;
  children: readonly MathNode[];
}

export type MathNode = MathElement | string;

/** The MathML elements the native renderer draws. A formula with another element shows its source. */
const SUPPORTED_ELEMENTS = new Set([
  "math",
  "semantics",
  "annotation",
  "mrow",
  "mstyle",
  "mpadded",
  "mphantom",
  "menclose",
  "mi",
  "mn",
  "mo",
  "mtext",
  "ms",
  "mspace",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "mover",
  "munder",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
]);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

// Settled messages render again as the list scrolls, so each formula is parsed once. Cap the size so
// a long session cannot grow this without bound.
const MATH_CACHE_LIMIT = 300;
const mathCache = new Map<string, MathElement | null>();

/**
 * The MathML tree of `tex`, without the `math` and `semantics` wrappers and the source annotation.
 * Null when KaTeX cannot parse the formula, or when it needs an element the app cannot draw.
 * `trust: false` keeps `\href`, `\includegraphics` and the `\html*` commands inert.
 */
export function mathTree(tex: string, display: boolean): MathElement | null {
  const key = `${display ? "d" : "i"}${tex}`;
  const cached = mathCache.get(key);
  if (cached !== undefined) return cached;
  let tree: MathElement | null;
  try {
    const markup = katex.renderToString(tex, {
      displayMode: display,
      output: "mathml",
      throwOnError: true,
      trust: false,
      strict: "ignore",
    });
    tree = formulaBody(parseMathMl(markup));
  } catch {
    tree = null;
  }
  if (mathCache.size >= MATH_CACHE_LIMIT) {
    const oldest = mathCache.keys().next();
    if (!oldest.done) mathCache.delete(oldest.value);
  }
  mathCache.set(key, tree);
  return tree;
}

function formulaBody(root: MathElement): MathElement | null {
  const math = findElement(root, "math");
  const semantics = math?.children.find((child) => typeof child !== "string" && child.tag === "semantics");
  const body = typeof semantics === "string" ? undefined : semantics;
  const children = (body ?? math)?.children.filter(
    (child): child is MathElement => typeof child !== "string" && child.tag !== "annotation",
  );
  if (!children?.every(supported)) return null;
  return { tag: "mrow", attributes: {}, children };
}

function findElement(node: MathElement, tag: string): MathElement | undefined {
  if (node.tag === tag) return node;
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const found = findElement(child, tag);
    if (found) return found;
  }
  return undefined;
}

function supported(node: MathNode): boolean {
  return typeof node === "string" || (SUPPORTED_ELEMENTS.has(node.tag) && node.children.every(supported));
}

/**
 * Reads the markup that KaTeX writes: elements, double-quoted attributes, self-closing elements and
 * escaped text. It is not a general XML parser.
 */
function parseMathMl(markup: string): MathElement {
  const root: MathElement & { children: MathNode[] } = { tag: "#root", attributes: {}, children: [] };
  const stack: (MathElement & { children: MathNode[] })[] = [root];
  const pattern = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/gu;
  for (const match of markup.matchAll(pattern)) {
    const parent = stack.at(-1) ?? root;
    const [, closing, tag, attributeSource, selfClosing, text] = match;
    if (text !== undefined) {
      parent.children.push(decodeEntities(text));
      continue;
    }
    if (!tag) continue;
    if (closing) {
      if (stack.length > 1 && parent.tag === tag) stack.pop();
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const attribute of (attributeSource ?? "").matchAll(/([\w:-]+)="([^"]*)"/gu)) {
      if (attribute[1]) attributes[attribute[1]] = decodeEntities(attribute[2] ?? "");
    }
    const element = { tag, attributes, children: [] };
    parent.children.push(element);
    if (!selfClosing) stack.push(element);
  }
  return root;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** The text of a leaf element such as `mi` or `mo`. */
export function mathText(node: MathElement): string {
  return node.children.map((child) => (typeof child === "string" ? child : mathText(child))).join("");
}

/** A MathML length in em, such as `0.2778em` or `+0.6em`. Other units are not used by KaTeX. */
export function mathLength(value: string | undefined): number {
  const match = /^([+-]?\d*\.?\d+)em$/u.exec(value?.trim() ?? "");
  return match?.[1] ? Number(match[1]) : 0;
}

/** TeX spacing around an operator, in em, as KaTeX's HTML output uses it. */
export function operatorSpacing(operator: string): { before: number; after: number } {
  if (RELATIONS.has(operator)) return { before: 0.2778, after: 0.2778 };
  if (BINARY_OPERATORS.has(operator)) return { before: 0.2222, after: 0.2222 };
  if (operator === "," || operator === ";") return { before: 0, after: 0.1667 };
  return { before: 0, after: 0 };
}

const RELATIONS = new Set([..."=<>≤≥≠≈≡≅∼≃∝∈∉∋⊂⊃⊆⊇⊊⊋≺≻⪯⪰∣∥⊥⊨⊢⊣≪≫≐:→←↔⇒⇐⇔⟶⟵⟷⟹⟸⟺↦⟼↑↓⇑⇓≲≳"]);

const BINARY_OPERATORS = new Set([..."+−-±∓×÷⋅·∘∙∗∪∩∧∨⊕⊖⊗⊘⊙∖⋆⋄◃▹△▽†‡⊎⊓⊔"]);

/** Operators that KaTeX draws in a larger font: sums, products, integrals and big set operations. */
export const LARGE_OPERATORS = new Set([..."∑∏∐∫∬∭∮∯∰⋃⋂⋁⋀⨁⨂⨀⨄⨆"]);
