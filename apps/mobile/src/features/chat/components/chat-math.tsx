import { useFonts } from "expo-font";
import { Typography } from "heroui-native";
import amsRegular from "katex/dist/fonts/KaTeX_AMS-Regular.ttf";
import caligraphicRegular from "katex/dist/fonts/KaTeX_Caligraphic-Regular.ttf";
import frakturRegular from "katex/dist/fonts/KaTeX_Fraktur-Regular.ttf";
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.ttf";
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.ttf";
import mainRegular from "katex/dist/fonts/KaTeX_Main-Regular.ttf";
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.ttf";
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.ttf";
import sansSerifRegular from "katex/dist/fonts/KaTeX_SansSerif-Regular.ttf";
import size1Regular from "katex/dist/fonts/KaTeX_Size1-Regular.ttf";
import size2Regular from "katex/dist/fonts/KaTeX_Size2-Regular.ttf";
import typewriterRegular from "katex/dist/fonts/KaTeX_Typewriter-Regular.ttf";
import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import { type ColorValue, type LayoutChangeEvent, ScrollView, View, type ViewStyle } from "react-native";
import {
  LARGE_OPERATORS,
  type MathElement,
  type MathNode,
  mathLength,
  mathText,
  mathTree,
  operatorSpacing,
} from "../model/chat-math";

const KATEX_FONTS = {
  "KaTeX_AMS-Regular": amsRegular,
  "KaTeX_Caligraphic-Regular": caligraphicRegular,
  "KaTeX_Fraktur-Regular": frakturRegular,
  "KaTeX_Main-Bold": mainBold,
  "KaTeX_Main-Italic": mainItalic,
  "KaTeX_Main-Regular": mainRegular,
  "KaTeX_Math-BoldItalic": mathBoldItalic,
  "KaTeX_Math-Italic": mathItalic,
  "KaTeX_SansSerif-Regular": sansSerifRegular,
  "KaTeX_Size1-Regular": size1Regular,
  "KaTeX_Size2-Regular": size2Regular,
  "KaTeX_Typewriter-Regular": typewriterRegular,
} as const;

type MathFont = keyof typeof KATEX_FONTS;

/**
 * The ascender, descender and line gap of each font's `hhea` table, in em. The phone puts a
 * glyph's baseline in its line box from these, so each font's letters sit at a different height.
 */
const FONT_METRICS: Record<MathFont, readonly [number, number, number]> = {
  "KaTeX_AMS-Regular": [1.003, 0.463, 0.09],
  "KaTeX_Caligraphic-Regular": [0.789, 0.143, 0.09],
  "KaTeX_Fraktur-Regular": [0.741, 0.257, 0.09],
  "KaTeX_Main-Bold": [0.951, 0.268, 0.09],
  "KaTeX_Main-Italic": [0.75, 0.25, 0.09],
  "KaTeX_Main-Regular": [0.903, 0.272, 0.09],
  "KaTeX_Math-BoldItalic": [0.725, 0.216, 0.09],
  "KaTeX_Math-Italic": [0.717, 0.218, 0.09],
  "KaTeX_SansSerif-Regular": [0.75, 0.25, 0.09],
  "KaTeX_Size1-Regular": [0.85, 0.35, 0.09],
  "KaTeX_Size2-Regular": [1.36, 0.862, 0.09],
  "KaTeX_Typewriter-Regular": [0.694, 0.229, 0.09],
};

/** TeX's math axis: the height of a fraction bar and of the middle of `+`, above the baseline. */
const AXIS_HEIGHT = 0.25;
/**
 * How far the middle of a letter or digit is above the middle of its box, in em. Glyph boxes are
 * centred on the math axis, but a digit's ink runs from its baseline to 0.68em above it. A fraction
 * moves its parts down by this, so the numerator and the denominator are equally far from the bar.
 */
const INK_OFFSET = 0.09;
/** How much taller than its font, in em, the line box of a glyph's text is. See `Glyph`. */
const LINE_BOX_MARGIN = 0.25;
/** The descender of the system text font. A view inside text has its bottom this far below the baseline. */
const TEXT_DESCENT = 0.24;

/**
 * How far to move a glyph up, in em, so that its baseline is `AXIS_HEIGHT` below the middle of its
 * line box. The phone centres the font's ascender, descender and line gap in the box, so without
 * this the baseline is half of `ascender - descender + gap` below the middle.
 */
function baselineCorrection(font: MathFont): number {
  const [ascender, descender, gap] = FONT_METRICS[font];
  return (ascender - descender + gap) / 2 - AXIS_HEIGHT;
}

const VARIANT_FONTS: Record<string, MathFont> = {
  normal: "KaTeX_Main-Regular",
  italic: "KaTeX_Math-Italic",
  bold: "KaTeX_Main-Bold",
  "bold-italic": "KaTeX_Math-BoldItalic",
  "double-struck": "KaTeX_AMS-Regular",
  script: "KaTeX_Caligraphic-Regular",
  fraktur: "KaTeX_Fraktur-Regular",
  "sans-serif": "KaTeX_SansSerif-Regular",
  monospace: "KaTeX_Typewriter-Regular",
};

/** KaTeX sets math larger than the text around it, because its fonts have a small x-height. */
const MATH_SCALE = 1.15;
/** The size of each script level against the formula's size, as TeX's script and scriptscript styles. */
const SCRIPT_SCALES = [1, 0.7, 0.5] as const;
const LINE_HEIGHT = 1.2;
/** Scripts sit close to their base, so their line is as tall as their font, with no leading. */
const SCRIPT_LINE_HEIGHT = 1;
const RULE_THICKNESS = 0.05;

interface MathContext {
  /** The formula's font size in points, with the phone's text size applied. */
  base: number;
  level: number;
  display: boolean;
  color: ColorValue | undefined;
}

/**
 * The sizes of one script level in points. Every part of a formula takes its height from these, so
 * the renderer knows each height before layout. A view inside a line of text gets no layout event,
 * so inline math cannot measure itself.
 */
function metrics(context: MathContext) {
  const size = context.base * (SCRIPT_SCALES[Math.min(context.level, SCRIPT_SCALES.length - 1)] ?? 1);
  const lineHeight = context.level > 0 ? SCRIPT_LINE_HEIGHT : LINE_HEIGHT;
  return { size, lineHeight, line: size * lineHeight, rule: Math.max(1, RULE_THICKNESS * size) };
}

function scriptContext(context: MathContext, levels = 1): MathContext {
  return { ...context, level: context.level + levels, display: false };
}

function isElement(node: MathNode): node is MathElement {
  return typeof node !== "string";
}

/** A key for each child: its tag and its place among the siblings with the same tag. */
function keyedElements(nodes: readonly MathNode[]): { node: MathElement; key: string }[] {
  const seen = new Map<string, number>();
  return nodes.filter(isElement).map((node) => {
    const count = seen.get(node.tag) ?? 0;
    seen.set(node.tag, count + 1);
    return { node, key: `${node.tag}${count}` };
  });
}

function isLeafOperator(node: MathElement | undefined): boolean {
  return node?.tag === "mo" && node.children.every((child) => !isElement(child));
}

function isFence(node: MathElement): boolean {
  return isLeafOperator(node) && (node.attributes.fence === "true" || node.attributes.stretchy === "true");
}

function isStretchy(node: MathElement | undefined): node is MathElement {
  return node !== undefined && isLeafOperator(node) && node.attributes.stretchy === "true";
}

/** U+2061, which KaTeX writes between a function name such as `sin` and its argument. */
const FUNCTION_APPLICATION = 0x2061;

/** Invisible operators, U+2061 to U+2064, that only add the spacing of their row. */
function isInvisibleOperator(text: string): boolean {
  const code = text.length === 1 ? text.codePointAt(0) : undefined;
  return code !== undefined && code >= FUNCTION_APPLICATION && code <= 0x2064;
}

function styledContext(node: MathElement, context: MathContext): MathContext {
  const { scriptlevel, displaystyle, mathcolor } = node.attributes;
  const level = scriptlevel === undefined ? context.level : Number.parseInt(scriptlevel, 10);
  return {
    ...context,
    level: Number.isNaN(level)
      ? context.level
      : scriptlevel?.startsWith("+") || scriptlevel?.startsWith("-")
        ? context.level + level
        : level,
    display: displaystyle === undefined ? context.display : displaystyle === "true",
    color: mathcolor ?? context.color,
  };
}

function leafFont(node: MathElement): MathFont {
  const variant = node.attributes.mathvariant;
  if (variant && VARIANT_FONTS[variant]) return VARIANT_FONTS[variant];
  if (node.tag !== "mi") return "KaTeX_Main-Regular";
  // A single letter is a variable, set in italic. A name such as `sin` is upright.
  return [...mathText(node)].length === 1 ? "KaTeX_Math-Italic" : "KaTeX_Main-Regular";
}

// Heights --------------------------------------------------------------------------------------

const heightCache = new WeakMap<MathElement, Map<string, number>>();

/** The height in points of `node` as the components below draw it. */
function heightOf(node: MathElement, context: MathContext): number {
  const key = `${context.base}:${context.level}:${context.display}`;
  let byContext = heightCache.get(node);
  if (!byContext) {
    byContext = new Map();
    heightCache.set(node, byContext);
  }
  const cached = byContext.get(key);
  if (cached !== undefined) return cached;
  const height = computeHeight(node, context);
  byContext.set(key, height);
  return height;
}

function rowHeight(nodes: readonly MathNode[], context: MathContext): number {
  return Math.max(0, ...nodes.filter(isElement).map((node) => heightOf(node, context)));
}

function computeHeight(node: MathElement, context: MathContext): number {
  const { size, line, rule } = metrics(context);
  switch (node.tag) {
    case "mstyle":
      return rowHeight(node.children, styledContext(node, context));
    case "mi":
    case "mn":
    case "mtext":
    case "ms":
      return line;
    case "mo":
      return isLeafOperator(node) ? operatorLayout(node, context).height : rowHeight(node.children, context);
    case "mspace":
      return Math.max(0, mathLength(node.attributes.height) * size);
    case "msup":
    case "msub":
    case "msubsup":
      return scriptsLayout(node, context).height;
    case "mfrac":
      return fractionLayout(node, context).height;
    case "msqrt":
      return radicalLayout(node.children, undefined, context).height;
    case "mroot":
      return radicalLayout(node.children.slice(0, 1), node.children[1], context).height;
    case "mover":
    case "munder":
    case "munderover":
      return underOverLayout(node, context).height;
    case "menclose":
      return rowHeight(node.children, context) + (enclosesInBox(node) ? 2 * rule + 0.3 * size : 0);
    case "mtable":
      return tableLayout(node, context).height;
    default:
      return rowHeight(node.children, context);
  }
}

function operatorLayout(node: MathElement, context: MathContext) {
  const { size } = metrics(context);
  const text = mathText(node);
  if (isInvisibleOperator(text)) return { text, large: false, lineHeight: 0, height: 0 };
  const large = LARGE_OPERATORS.has(text);
  const lineHeight = large ? (context.display ? 2.2 : 1.6) : metrics(context).lineHeight;
  return { text, large, lineHeight, height: size * lineHeight };
}

function scriptsLayout(node: MathElement, context: MathContext) {
  const [base, first, second] = node.children.filter(isElement);
  const { line } = metrics(context);
  const script = scriptContext(context);
  const superscript = node.tag === "msub" ? undefined : node.tag === "msup" ? first : second;
  const subscript = node.tag === "msup" ? undefined : first;
  const baseHeight = base ? heightOf(base, context) : 0;
  // A tall base, such as a bracketed fraction, raises and lowers its scripts to its edges.
  const gap = Math.max(0, baseHeight - line);
  const reserve = Math.max(
    superscript ? heightOf(superscript, script) : 0,
    subscript ? heightOf(subscript, script) : 0,
  );
  return { base, superscript, subscript, script, gap, reserve, height: Math.max(baseHeight, gap + 2 * reserve) };
}

function fractionLayout(node: MathElement, context: MathContext) {
  const [numerator, denominator] = node.children.filter(isElement);
  const { size, rule } = metrics(context);
  const part = context.display ? { ...context, display: false } : scriptContext(context);
  const thickness = node.attributes.linethickness === "0px" ? 0 : rule;
  // TeX leaves about 0.12em between the bar and the parts of an inline fraction, and more in display.
  const margin = size * (context.display ? 0.05 : 0.02);
  const reserve = Math.max(numerator ? heightOf(numerator, part) : 0, denominator ? heightOf(denominator, part) : 0);
  return {
    numerator,
    denominator,
    part,
    thickness,
    margin,
    reserve,
    inkOffset: INK_OFFSET * metrics(part).size,
    height: thickness + 2 * margin + 2 * reserve,
  };
}

function radicalLayout(content: readonly MathNode[], index: MathNode | undefined, context: MathContext) {
  const { size, line, rule } = metrics(context);
  const padding = size * 0.08;
  const inner = rowHeight(content, context) + rule + padding;
  const indexElement = index && isElement(index) ? index : undefined;
  const indexContext = scriptContext(context, 2);
  const indexReserve = indexElement ? heightOf(indexElement, indexContext) : 0;
  return {
    padding,
    inner,
    scale: inner > line ? inner / line : 1,
    index: indexElement,
    indexContext,
    indexReserve,
    height: Math.max(inner, line, 2 * indexReserve),
  };
}

const ARROWS_RIGHT = new Set([..."→⟶⇒⟹↦⟼"]);
const ARROWS_LEFT = new Set([..."←⟵⇐⟸"]);
const ARROWS_BOTH = new Set([..."↔⟷⇔⟺"]);
const BRACES = new Set([..."⏞⏟⎴⎵"]);

function isArrow(text: string): boolean {
  return ARROWS_RIGHT.has(text) || ARROWS_LEFT.has(text) || ARROWS_BOTH.has(text);
}

function stretchyHeight(text: string, context: MathContext): number {
  const { size, line, rule } = metrics(context);
  if (isArrow(text)) return line;
  if (BRACES.has(text)) return size * 0.25;
  return rule + 2 * size * 0.08;
}

function underOverLayout(node: MathElement, context: MathContext) {
  const [base, first, second] = node.children.filter(isElement);
  const over = node.tag === "munder" ? undefined : node.tag === "mover" ? first : second;
  const under = node.tag === "mover" ? undefined : first;
  const script = scriptContext(context);
  const partHeight = (child: MathElement | undefined) => {
    if (!child) return 0;
    return isStretchy(child) ? stretchyHeight(mathText(child), context) : heightOf(child, script);
  };
  const baseHeight = base ? (isStretchy(base) ? stretchyHeight(mathText(base), context) : heightOf(base, context)) : 0;
  // An accent such as `\hat` sits on the letter, not a script's height above it.
  const accent = node.attributes.accent === "true" && over !== undefined && isLeafOperator(over) && !isStretchy(over);
  const reserve = accent ? 0 : Math.max(partHeight(over), partHeight(under));
  return { base, over, under, script, accent, reserve, height: baseHeight + 2 * reserve };
}

function enclosesInBox(node: MathElement): boolean {
  return (node.attributes.notation ?? "").includes("box");
}

function tableLayout(node: MathElement, context: MathContext) {
  const { size } = metrics(context);
  const rows = keyedElements(node.children).map(({ node: row, key }) => {
    const cells = keyedElements(row.children);
    return { key, cells, height: Math.max(0, ...cells.map((cell) => rowHeight(cell.node.children, context))) };
  });
  const alignments = (node.attributes.columnalign ?? "center").split(/\s+/u);
  const columns: { key: string; index: number; align: "flex-start" | "flex-end" | "center" }[] = [];
  for (let index = 0; index < Math.max(0, ...rows.map((row) => row.cells.length)); index += 1) {
    const align = alignments[Math.min(index, alignments.length - 1)];
    columns.push({
      key: `column${index}`,
      index,
      align: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
    });
  }
  const columnSpacing = mathLength(node.attributes.columnspacing ?? "1em") * size;
  const rowSpacing = mathLength(node.attributes.rowspacing ?? "0.25em") * size;
  const height = rows.reduce((total, row) => total + row.height, 0) + rowSpacing * Math.max(0, rows.length - 1);
  return { rows, columns, columnSpacing, rowSpacing, height };
}

// Components -----------------------------------------------------------------------------------

/**
 * A LaTeX formula drawn with native views from KaTeX's MathML. A formula that KaTeX cannot parse,
 * or that needs an element the app does not draw, shows `fallback` instead.
 *
 * Inline math sits in a line of text: its middle is moved to the height of the text's math axis.
 * Display math is centred on its own row, and scrolls sideways when it is wider than the message.
 */
export const ChatMath = memo(function ChatMath({
  tex,
  display,
  block,
  textSize,
  color,
  fallback,
}: {
  tex: string;
  display: boolean;
  block: boolean;
  /** The size of the text around the formula, in points, with the phone's text size applied. */
  textSize: number;
  color: ColorValue | undefined;
  fallback: ReactNode;
}) {
  const tree = useMemo(() => mathTree(tex, display), [tex, display]);
  const [fontsLoaded, fontError] = useFonts(KATEX_FONTS);
  if (!tree) return fallback;
  const context: MathContext = { base: textSize * MATH_SCALE, level: 0, display, color };
  // Draw the formula only in its own fonts: a first frame in the system font would change size.
  const ready = fontsLoaded || fontError !== null;
  const formula = ready ? <MathRow nodes={tree.children} context={context} /> : null;
  if (block) {
    return (
      <ScrollView
        horizontal
        alwaysBounceHorizontal={false}
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: textSize * 0.25 }}
        accessible
        accessibilityLabel={tex}
      >
        {formula}
      </ScrollView>
    );
  }
  // The middle of the formula is its math axis. A view inside text has its bottom a descender below
  // the baseline, so move it down until its axis is `AXIS_HEIGHT` above the text's baseline.
  const height = rowHeight(tree.children, context);
  const shift = height / 2 - TEXT_DESCENT * textSize - AXIS_HEIGHT * metrics(context).size;
  return (
    <View
      collapsable={false}
      accessible
      accessibilityLabel={tex}
      style={{
        transform: [{ translateY: shift }],
        paddingHorizontal: textSize * 0.08,
      }}
    >
      {formula}
    </View>
  );
});

function MathRow({ nodes, context, style }: { nodes: readonly MathNode[]; context: MathContext; style?: ViewStyle }) {
  const keyed = keyedElements(nodes);
  const elements = keyed.map((entry) => entry.node);
  // Brackets such as `\left(` grow to the height of what they enclose.
  const enclosed = Math.max(0, ...elements.filter((node) => !isFence(node)).map((node) => heightOf(node, context)));
  const { size } = metrics(context);
  return (
    <View style={[{ flexDirection: "row", alignItems: "center" }, style]}>
      {keyed.map(({ node, key }, index) => {
        if (!isLeafOperator(node)) return <MathNodeView key={key} node={node} context={context} />;
        const spacing = rowOperatorSpacing(elements, index, context);
        return (
          <Operator
            key={key}
            node={node}
            context={context}
            stretchTo={isFence(node) ? enclosed : undefined}
            style={{ marginLeft: spacing.before * size, marginRight: spacing.after * size }}
          />
        );
      })}
    </View>
  );
}

function rowOperatorSpacing(elements: readonly MathElement[], index: number, context: MathContext) {
  const node = elements[index];
  if (!node) return { before: 0, after: 0 };
  const { lspace, rspace } = node.attributes;
  if (lspace !== undefined || rspace !== undefined) return { before: mathLength(lspace), after: mathLength(rspace) };
  const text = mathText(node);
  // Function application, as in `\sin x`: a thin space, but none before a parenthesis.
  if (text === String.fromCodePoint(FUNCTION_APPLICATION)) {
    const next = elements[index + 1];
    return { before: 0, after: next && isLeafOperator(next) && mathText(next) === "(" ? 0 : 0.1667 };
  }
  // TeX adds no operator spacing in a script.
  if (context.level > 0) return { before: 0, after: 0 };
  const spacing = operatorSpacing(text);
  if (spacing.before === 0.2222) {
    // A binary operator at the start or after another operator is a sign, as in `-x` or `= -1`.
    const previous = elements[index - 1];
    const closing = previous && isLeafOperator(previous) && /^[)\]}|⟩⌋⌉]$/u.test(mathText(previous));
    if (!previous || (isLeafOperator(previous) && !closing)) return { before: 0, after: 0 };
  }
  // TeX spaces an operator from its neighbours only, so `$\le$` alone has no space around it.
  return {
    before: index > 0 ? spacing.before : 0,
    after: index < elements.length - 1 ? spacing.after : 0,
  };
}

function MathNodeView({ node, context }: { node: MathElement; context: MathContext }): ReactNode {
  switch (node.tag) {
    case "mstyle":
      return <MathRow nodes={node.children} context={styledContext(node, context)} />;
    case "mpadded": {
      const { size } = metrics(context);
      const left = mathLength(node.attributes.lspace);
      const width = node.attributes.width?.startsWith("+") ? mathLength(node.attributes.width) : 0;
      return (
        <MathRow
          nodes={node.children}
          context={context}
          style={{ paddingLeft: left * size, paddingRight: Math.max(0, width - left) * size }}
        />
      );
    }
    case "mphantom":
      return <MathRow nodes={node.children} context={context} style={{ opacity: 0 }} />;
    case "menclose":
      return <Enclose node={node} context={context} />;
    case "mi":
    case "mn":
    case "mtext":
    case "ms":
      return <Glyph text={mathText(node)} font={leafFont(node)} context={context} />;
    case "mo":
      return isLeafOperator(node) ? (
        <Operator node={node} context={context} />
      ) : (
        <MathRow nodes={node.children} context={context} />
      );
    case "mspace":
      return <Space node={node} context={context} />;
    case "msup":
    case "msub":
    case "msubsup":
      return <Scripts node={node} context={context} />;
    case "mfrac":
      return <Fraction node={node} context={context} />;
    case "msqrt":
      return <Radical content={node.children} context={context} />;
    case "mroot":
      return <Radical content={node.children.slice(0, 1)} index={node.children[1]} context={context} />;
    case "mover":
    case "munder":
    case "munderover":
      return <UnderOver node={node} context={context} />;
    case "mtable":
      return <MathTable node={node} context={context} />;
    default:
      return <MathRow nodes={node.children} context={context} />;
  }
}

function Glyph({
  text,
  font,
  context,
  lineHeight = metrics(context).lineHeight,
  scaleY = 1,
  style,
}: {
  text: string;
  font: MathFont;
  context: MathContext;
  lineHeight?: number;
  /** Stretches a bracket or a radical sign to the height of what it encloses. */
  scaleY?: number;
  style?: ViewStyle;
}) {
  const { size } = metrics(context);
  const [ascender, descender, gap] = FONT_METRICS[font];
  // The phone centres the font in a line box only when the box is at least as tall as the font.
  // In a shorter box it moves the baseline, so the text keeps the font's height, and the box that
  // the formula lays out with keeps the height given here. The text extends past it, centred.
  // The phone rounds the font's metrics, so the text box has a margin of `LINE_BOX_MARGIN` over them.
  const textLineHeight = Math.max(lineHeight, ascender + descender + gap + LINE_BOX_MARGIN) * size;
  return (
    <View style={[{ height: size * lineHeight, justifyContent: "center" }, style]}>
      <Typography
        allowFontScaling={false}
        style={{
          fontFamily: font,
          fontSize: size,
          lineHeight: textLineHeight,
          color: context.color,
          transform: [{ translateY: -baselineCorrection(font) * size }, { scaleY }],
        }}
      >
        {text}
      </Typography>
    </View>
  );
}

function Operator({
  node,
  context,
  stretchTo,
  style,
}: {
  node: MathElement;
  context: MathContext;
  stretchTo?: number | undefined;
  style?: ViewStyle;
}) {
  const layout = operatorLayout(node, context);
  if (layout.height === 0) return <View style={style} />;
  const scale = stretchTo && stretchTo > layout.height ? stretchTo / layout.height : 1;
  const font: MathFont = layout.large
    ? context.display
      ? "KaTeX_Size2-Regular"
      : "KaTeX_Size1-Regular"
    : (VARIANT_FONTS[node.attributes.mathvariant ?? ""] ?? "KaTeX_Main-Regular");
  return (
    <View style={style}>
      <Glyph text={layout.text} font={font} context={context} lineHeight={layout.lineHeight} scaleY={scale} />
    </View>
  );
}

function Space({ node, context }: { node: MathElement; context: MathContext }) {
  const { size } = metrics(context);
  const width = mathLength(node.attributes.width) * size;
  const height = mathLength(node.attributes.height) * size;
  const background = node.attributes.mathbackground ? context.color : undefined;
  return (
    <View
      style={width < 0 ? { marginRight: width } : { width, height, backgroundColor: background }}
      accessibilityElementsHidden
    />
  );
}

/**
 * Three parts in a column. `above` and `below` both take `reserve` points, so the middle of
 * `middle` is the middle of the column, which a row lines up with the math axis.
 */
function Stack({
  above,
  middle,
  below,
  reserve,
  align = "center",
}: {
  above?: ReactNode;
  middle?: ReactNode;
  below?: ReactNode;
  reserve: number;
  align?: "center" | "flex-start";
}) {
  return (
    <View style={{ alignItems: align }}>
      <View style={{ height: reserve, justifyContent: "flex-end", alignItems: align }}>{above}</View>
      {middle}
      <View style={{ height: reserve, justifyContent: "flex-start", alignItems: align }}>{below}</View>
    </View>
  );
}

function Scripts({ node, context }: { node: MathElement; context: MathContext }) {
  const layout = scriptsLayout(node, context);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {layout.base ? <MathNodeView node={layout.base} context={context} /> : null}
      <Stack
        align="flex-start"
        reserve={layout.reserve}
        above={layout.superscript ? <MathNodeView node={layout.superscript} context={layout.script} /> : null}
        middle={<View style={{ height: layout.gap }} />}
        below={layout.subscript ? <MathNodeView node={layout.subscript} context={layout.script} /> : null}
      />
    </View>
  );
}

function Fraction({ node, context }: { node: MathElement; context: MathContext }) {
  const layout = fractionLayout(node, context);
  const { size } = metrics(context);
  return (
    <View style={{ paddingHorizontal: size * 0.12 }}>
      <Stack
        reserve={layout.reserve}
        above={
          layout.numerator ? (
            <View style={{ transform: [{ translateY: layout.inkOffset }] }}>
              <MathNodeView node={layout.numerator} context={layout.part} />
            </View>
          ) : null
        }
        middle={
          <View
            style={{
              alignSelf: "stretch",
              height: layout.thickness,
              marginVertical: layout.margin,
              backgroundColor: layout.thickness ? context.color : undefined,
            }}
          />
        }
        below={
          layout.denominator ? (
            <View style={{ transform: [{ translateY: layout.inkOffset }] }}>
              <MathNodeView node={layout.denominator} context={layout.part} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

function Radical({
  content,
  index,
  context,
}: {
  content: readonly MathNode[];
  index?: MathNode;
  context: MathContext;
}) {
  const layout = radicalLayout(content, index, context);
  const { size, rule } = metrics(context);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {layout.index ? (
        <View style={{ marginRight: -size * 0.35, zIndex: 1 }}>
          <Stack
            reserve={layout.indexReserve}
            above={<MathNodeView node={layout.index} context={layout.indexContext} />}
          />
        </View>
      ) : null}
      <Glyph text="√" font="KaTeX_Main-Regular" context={context} scaleY={layout.scale} />
      <View style={{ borderTopWidth: rule, borderColor: context.color, paddingTop: layout.padding }}>
        <MathRow nodes={content} context={context} style={{ paddingHorizontal: size * 0.06 }} />
      </View>
    </View>
  );
}

/** A stretchy mark over or under a formula: a line, an arrow or a brace as wide as the formula. */
function StretchyMark({ text, context, over }: { text: string; context: MathContext; over: boolean }) {
  const { size, rule } = metrics(context);
  const line = <View style={{ flexGrow: 1, height: rule, backgroundColor: context.color }} />;
  const arrow = (glyph: string, side: "left" | "right") => (
    <Glyph
      text={glyph}
      font="KaTeX_Main-Regular"
      context={context}
      style={side === "right" ? { marginLeft: -size * 0.5 } : { marginRight: -size * 0.5 }}
    />
  );
  if (isArrow(text)) {
    const both = ARROWS_BOTH.has(text);
    return (
      <View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", minWidth: size }}>
        {ARROWS_LEFT.has(text) || both ? arrow(both ? "←" : text, "left") : null}
        {line}
        {ARROWS_RIGHT.has(text) || both ? arrow(both ? "→" : text, "right") : null}
      </View>
    );
  }
  if (BRACES.has(text)) {
    return (
      <View
        style={{
          alignSelf: "stretch",
          height: stretchyHeight(text, context),
          borderColor: context.color,
          borderLeftWidth: rule,
          borderRightWidth: rule,
          ...(over ? { borderTopWidth: rule } : { borderBottomWidth: rule }),
        }}
      />
    );
  }
  return (
    <View style={{ alignSelf: "stretch", height: rule, marginVertical: size * 0.08, backgroundColor: context.color }} />
  );
}

function UnderOver({ node, context }: { node: MathElement; context: MathContext }) {
  const layout = underOverLayout(node, context);
  const { size } = metrics(context);
  const part = (child: MathElement | undefined, over: boolean) => {
    if (!child) return null;
    if (isStretchy(child)) return <StretchyMark text={mathText(child)} context={context} over={over} />;
    return <MathNodeView node={child} context={layout.script} />;
  };
  const base = layout.base;
  const baseView = base ? (
    isStretchy(base) ? (
      <View style={{ alignSelf: "stretch", minWidth: mathLength(base.attributes.minsize) * size }}>
        <StretchyMark text={mathText(base)} context={context} over />
      </View>
    ) : (
      <MathNodeView node={base} context={context} />
    )
  ) : null;
  if (layout.accent && layout.over) {
    return (
      <View style={{ alignItems: "center" }}>
        {baseView}
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: -size * 0.2, left: 0, right: 0, alignItems: "center" }}
        >
          <Glyph text={mathText(layout.over)} font="KaTeX_Main-Regular" context={context} />
        </View>
      </View>
    );
  }
  return (
    <Stack
      reserve={layout.reserve}
      above={part(layout.over, true)}
      middle={baseView}
      below={part(layout.under, false)}
    />
  );
}

function Enclose({ node, context }: { node: MathElement; context: MathContext }) {
  const { size, rule } = metrics(context);
  const notation = node.attributes.notation ?? "";
  const height = rowHeight(node.children, context);
  // A diagonal strike needs the width, which only layout gives. Before that, and inside a line of
  // text, where no layout event comes, it is drawn level.
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((previous) => (Math.abs(previous - next) < 0.5 ? previous : next));
  }, []);
  const strike = /strike/u.test(notation);
  const diagonal = notation.includes("diagonal") && width > 0;
  const angle = diagonal ? Math.atan2(height, width) * (notation.includes("up") ? -1 : 1) : 0;
  const box = enclosesInBox(node);
  const inset = box ? rule + size * 0.15 : 0;
  return (
    <View
      onLayout={strike ? onLayout : undefined}
      style={
        box
          ? { borderWidth: rule, borderColor: context.color, padding: size * 0.15 }
          : { paddingHorizontal: size * 0.05 }
      }
    >
      <MathRow nodes={node.children} context={context} />
      {strike ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: inset + height / 2 - rule / 2,
            left: diagonal ? (width - Math.hypot(width, height)) / 2 : 0,
            width: diagonal ? Math.hypot(width, height) : "100%",
            height: rule,
            backgroundColor: context.color,
            transform: [{ rotate: `${angle}rad` }],
          }}
        />
      ) : null}
    </View>
  );
}

function MathTable({ node, context }: { node: MathElement; context: MathContext }) {
  const layout = tableLayout(node, context);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: layout.columnSpacing }}>
      {layout.columns.map((column) => (
        <View key={column.key} style={{ alignItems: column.align, gap: layout.rowSpacing }}>
          {layout.rows.map((row) => {
            const cell = row.cells[column.index]?.node;
            // Each column is its own view, so each cell takes the height of the tallest cell in its row.
            return (
              <View key={row.key} style={{ height: row.height, justifyContent: "center", alignItems: column.align }}>
                {cell ? <MathRow nodes={cell.children} context={context} /> : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
