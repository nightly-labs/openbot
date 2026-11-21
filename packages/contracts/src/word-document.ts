import { strFromU8, unzipSync } from "fflate";

export const WORD_DOCUMENT_MAX_BLOCKS = 5000;
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_STYLE_DEPTH = 16;
const DOCX_XML_ENTRY = /^word\/(?:document|styles|numbering)\.xml$/u;
const RUN_CONTAINERS = new Set([
  "hyperlink",
  "ins",
  "moveTo",
  "smartTag",
  "fldSimple",
  "sdt",
  "sdtContent",
  "customXml",
  "dir",
  "bdo",
]);
const BLOCK_CONTAINERS = new Set(["sdt", "sdtContent", "customXml", "ins", "moveTo"]);
const OFF_VALUES = new Set(["0", "false", "off", "none"]);

export interface WordRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

export interface WordTableCell {
  paragraphs: WordRun[][];
  columnSpan: number;
}

export interface WordTableRow {
  cells: WordTableCell[];
  header: boolean;
}

const WORD_HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export type WordHeadingLevel = (typeof WORD_HEADING_LEVELS)[number];

export type WordBlock =
  | { kind: "heading"; level: WordHeadingLevel; runs: WordRun[] }
  | { kind: "paragraph"; runs: WordRun[] }
  | { kind: "list"; ordered: boolean; items: WordRun[][] }
  | { kind: "table"; rows: WordTableRow[] };

export interface WordDocumentData {
  blocks: WordBlock[];
  truncated: boolean;
}

interface ParagraphStyle {
  basedOn: string | null;
  headingLevel: number | null;
  numbering: Element | null;
}

interface DocumentContext {
  styles: Map<string, ParagraphStyle>;
  orderedLists: Map<string, Set<string>>;
  blocks: WordBlock[];
  units: number;
  truncated: boolean;
}

function xmlDocument(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null;
  const document = new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("The document contains invalid XML.");
  }
  return document;
}

function childElements(parent: Element, name?: string): Element[] {
  return Array.from(parent.children).filter((child) => name === undefined || child.localName === name);
}

function childElement(parent: Element | null | undefined, name: string): Element | null {
  if (!parent) return null;
  for (const child of Array.from(parent.children)) if (child.localName === name) return child;
  return null;
}

function attribute(element: Element | null | undefined, name: string): string | null {
  if (!element) return null;
  for (const item of Array.from(element.attributes)) if (item.localName === name) return item.value;
  return null;
}

function toggleOn(properties: Element | null, name: string): boolean {
  const element = childElement(properties, name);
  if (!element) return false;
  const value = attribute(element, "val");
  return value === null || !OFF_VALUES.has(value.toLowerCase());
}

function headingLevelForName(name: string | null): number | null {
  if (!name) return null;
  const normalized = name.trim().toLowerCase();
  if (normalized === "title") return 1;
  const match = /^heading\s*([1-9])$/u.exec(normalized);
  return match?.[1] ? Number(match[1]) : null;
}

function outlineLevel(paragraphProperties: Element | null): number | null {
  const value = attribute(childElement(paragraphProperties, "outlineLvl"), "val");
  if (value === null) return null;
  const level = Number(value);
  return Number.isInteger(level) && level >= 0 && level < 9 ? level + 1 : null;
}

function parseStyles(document: Document | null): Map<string, ParagraphStyle> {
  const styles = new Map<string, ParagraphStyle>();
  if (!document) return styles;
  for (const style of Array.from(document.getElementsByTagNameNS("*", "style"))) {
    if (attribute(style, "type") !== "paragraph") continue;
    const id = attribute(style, "styleId");
    if (!id) continue;
    const properties = childElement(style, "pPr");
    styles.set(id, {
      basedOn: attribute(childElement(style, "basedOn"), "val"),
      headingLevel: headingLevelForName(attribute(childElement(style, "name"), "val")) ?? outlineLevel(properties),
      numbering: childElement(properties, "numPr"),
    });
  }
  return styles;
}

function parseOrderedLists(document: Document | null): Map<string, Set<string>> {
  const lists = new Map<string, Set<string>>();
  if (!document) return lists;
  const abstractLevels = new Map<string, Set<string>>();
  for (const abstract of Array.from(document.getElementsByTagNameNS("*", "abstractNum"))) {
    const id = attribute(abstract, "abstractNumId");
    if (id === null) continue;
    const ordered = new Set<string>();
    for (const level of childElements(abstract, "lvl")) {
      const format = attribute(childElement(level, "numFmt"), "val");
      if (format && format !== "bullet" && format !== "none") ordered.add(attribute(level, "ilvl") ?? "0");
    }
    abstractLevels.set(id, ordered);
  }
  for (const numbering of Array.from(document.getElementsByTagNameNS("*", "num"))) {
    const id = attribute(numbering, "numId");
    const abstractId = attribute(childElement(numbering, "abstractNumId"), "val");
    if (id !== null && abstractId !== null) lists.set(id, abstractLevels.get(abstractId) ?? new Set());
  }
  return lists;
}

function styleChain(context: DocumentContext, styleId: string | null): ParagraphStyle[] {
  const chain: ParagraphStyle[] = [];
  let current = styleId;
  while (current && chain.length < MAX_STYLE_DEPTH) {
    const style = context.styles.get(current);
    if (!style) break;
    chain.push(style);
    current = style.basedOn;
  }
  return chain;
}

function runText(run: Element): string {
  let text = "";
  for (const child of Array.from(run.children)) {
    switch (child.localName) {
      case "t":
        text += child.textContent ?? "";
        break;
      case "tab":
        text += "\t";
        break;
      case "br":
      case "cr":
        text += "\n";
        break;
      case "noBreakHyphen":
        text += "-";
        break;
    }
  }
  return text;
}

function collectRuns(parent: Element, runs: WordRun[]): void {
  for (const child of Array.from(parent.children)) {
    if (child.localName === "r") {
      const text = runText(child);
      if (!text) continue;
      const properties = childElement(child, "rPr");
      runs.push({
        text,
        bold: toggleOn(properties, "b"),
        italic: toggleOn(properties, "i"),
        underline: toggleOn(properties, "u"),
        strike: toggleOn(properties, "strike") || toggleOn(properties, "dstrike"),
      });
    } else if (RUN_CONTAINERS.has(child.localName)) {
      collectRuns(child, runs);
    }
  }
}

function sameFormat(left: WordRun, right: WordRun): boolean {
  return (
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.strike === right.strike
  );
}

function paragraphRuns(paragraph: Element): WordRun[] {
  const runs: WordRun[] = [];
  collectRuns(paragraph, runs);
  const merged: WordRun[] = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (previous && sameFormat(previous, run)) {
      previous.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

function hasText(runs: WordRun[]): boolean {
  return runs.some((run) => run.text.trim().length > 0);
}

function headingLevel(properties: Element | null, chain: ParagraphStyle[]) {
  const level = outlineLevel(properties) ?? chain.find((style) => style.headingLevel !== null)?.headingLevel ?? null;
  if (level === null) return null;
  return WORD_HEADING_LEVELS[Math.min(Math.max(level, 1), 6) - 1] ?? null;
}

function listOrder(context: DocumentContext, properties: Element | null, chain: ParagraphStyle[]): boolean | null {
  const numbering = childElement(properties, "numPr") ?? chain.find((style) => style.numbering)?.numbering ?? null;
  if (!numbering) return null;
  const id = attribute(childElement(numbering, "numId"), "val");
  if (id === null || id === "0") return null;
  const level = attribute(childElement(numbering, "ilvl"), "val") ?? "0";
  return context.orderedLists.get(id)?.has(level) ?? false;
}

function reserveUnit(context: DocumentContext): boolean {
  if (context.units >= WORD_DOCUMENT_MAX_BLOCKS) {
    context.truncated = true;
    return false;
  }
  context.units += 1;
  return true;
}

function addParagraph(context: DocumentContext, paragraph: Element): void {
  const runs = paragraphRuns(paragraph);
  if (!hasText(runs) || !reserveUnit(context)) return;
  const properties = childElement(paragraph, "pPr");
  const chain = styleChain(context, attribute(childElement(properties, "pStyle"), "val"));
  const level = headingLevel(properties, chain);
  if (level !== null) {
    context.blocks.push({ kind: "heading", level, runs });
    return;
  }
  const ordered = listOrder(context, properties, chain);
  if (ordered === null) {
    context.blocks.push({ kind: "paragraph", runs });
    return;
  }
  const previous = context.blocks.at(-1);
  if (previous?.kind === "list" && previous.ordered === ordered) {
    previous.items.push(runs);
  } else {
    context.blocks.push({ kind: "list", ordered, items: [runs] });
  }
}

function cellParagraphs(parent: Element, paragraphs: WordRun[][]): void {
  for (const child of childElements(parent)) {
    if (child.localName === "p") {
      const runs = paragraphRuns(child);
      if (hasText(runs)) paragraphs.push(runs);
    } else if (child.localName === "tbl") {
      for (const row of childElements(child, "tr")) {
        for (const cell of childElements(row, "tc")) cellParagraphs(cell, paragraphs);
      }
    } else if (BLOCK_CONTAINERS.has(child.localName)) {
      cellParagraphs(child, paragraphs);
    }
  }
}

function tableRows(table: Element): Element[] {
  return childElements(table).flatMap((child) =>
    child.localName === "tr" ? [child] : BLOCK_CONTAINERS.has(child.localName) ? tableRows(child) : [],
  );
}

function rowCells(row: Element): Element[] {
  return childElements(row).flatMap((child) =>
    child.localName === "tc" ? [child] : BLOCK_CONTAINERS.has(child.localName) ? rowCells(child) : [],
  );
}

function addTable(context: DocumentContext, table: Element): void {
  const rows: WordTableRow[] = [];
  for (const row of tableRows(table)) {
    if (!reserveUnit(context)) break;
    const cells = rowCells(row).map((cell) => {
      const paragraphs: WordRun[][] = [];
      cellParagraphs(cell, paragraphs);
      const span = Number(attribute(childElement(childElement(cell, "tcPr"), "gridSpan"), "val"));
      return { paragraphs, columnSpan: Number.isInteger(span) && span > 1 ? span : 1 };
    });
    rows.push({ cells, header: toggleOn(childElement(row, "trPr"), "tblHeader") });
  }
  if (rows.length > 0) context.blocks.push({ kind: "table", rows });
}

function addBlocks(context: DocumentContext, parent: Element): void {
  for (const child of childElements(parent)) {
    if (context.truncated) return;
    if (child.localName === "p") {
      addParagraph(context, child);
    } else if (child.localName === "tbl") {
      addTable(context, child);
    } else if (BLOCK_CONTAINERS.has(child.localName)) {
      addBlocks(context, child);
    }
  }
}

function unzipWordDocument(bytes: Uint8Array) {
  let expandedBytes = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      if (!DOCX_XML_ENTRY.test(file.name)) return false;
      if (file.originalSize > MAX_ZIP_ENTRY_BYTES) {
        throw new Error("The document preview is too large to read safely.");
      }
      expandedBytes += file.originalSize;
      if (expandedBytes > MAX_ZIP_EXPANDED_BYTES) {
        throw new Error("The document preview is too large to read safely.");
      }
      return true;
    },
  });
}

export function parseWordDocument(bytes: Uint8Array): WordDocumentData {
  const files = unzipWordDocument(bytes);
  const document = xmlDocument(files["word/document.xml"]);
  const body = document ? document.getElementsByTagNameNS("*", "body")[0] : undefined;
  if (!body) throw new Error("The document has no readable body.");
  const context: DocumentContext = {
    styles: parseStyles(xmlDocument(files["word/styles.xml"])),
    orderedLists: parseOrderedLists(xmlDocument(files["word/numbering.xml"])),
    blocks: [],
    units: 0,
    truncated: false,
  };
  addBlocks(context, body);
  return { blocks: context.blocks, truncated: context.truncated };
}
