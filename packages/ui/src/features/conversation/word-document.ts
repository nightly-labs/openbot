import { unzipOfficeXml } from "@openbot/contracts/office-zip";

export const WORD_DOCUMENT_MAX_BLOCKS = 5000;
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

interface WordStyle {
  basedOn: string | null;
  headingLevel: number | null;
  numbering: Element | null;
  runProperties: Element | null;
}

interface OpenList {
  block: WordBlock;
  id: string;
}

interface DocumentContext {
  styles: Map<string, WordStyle>;
  orderedLists: Map<string, Set<string>>;
  blocks: WordBlock[];
  openList: OpenList | null;
  units: number;
  truncated: boolean;
}

function xmlDocument(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null;
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
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
  return layeredToggle([properties], name);
}

function layeredToggle(layers: readonly (Element | null)[], name: string): boolean {
  for (const layer of layers) {
    const element = childElement(layer, name);
    if (!element) continue;
    const value = attribute(element, "val");
    return value === null || !OFF_VALUES.has(value.toLowerCase());
  }
  return false;
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

function parseStyles(document: Document | null): Map<string, WordStyle> {
  const styles = new Map<string, WordStyle>();
  if (!document) return styles;
  for (const style of Array.from(document.getElementsByTagNameNS("*", "style"))) {
    const type = attribute(style, "type");
    if (type !== "paragraph" && type !== "character") continue;
    const id = attribute(style, "styleId");
    if (!id) continue;
    const paragraphStyle = type === "paragraph";
    const properties = paragraphStyle ? childElement(style, "pPr") : null;
    styles.set(id, {
      basedOn: attribute(childElement(style, "basedOn"), "val"),
      headingLevel: paragraphStyle
        ? (headingLevelForName(attribute(childElement(style, "name"), "val")) ?? outlineLevel(properties))
        : null,
      numbering: childElement(properties, "numPr"),
      runProperties: childElement(style, "rPr"),
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

function styleChain(context: DocumentContext, styleId: string | null): WordStyle[] {
  const chain: WordStyle[] = [];
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

function runLayers(context: DocumentContext, run: Element, paragraphChain: WordStyle[]): (Element | null)[] {
  const properties = childElement(run, "rPr");
  const characterChain = styleChain(context, attribute(childElement(properties, "rStyle"), "val"));
  return [properties, ...[...characterChain, ...paragraphChain].map((style) => style.runProperties)];
}

function collectRuns(context: DocumentContext, parent: Element, paragraphChain: WordStyle[], runs: WordRun[]): void {
  for (const child of Array.from(parent.children)) {
    if (child.localName === "r") {
      const text = runText(child);
      if (!text) continue;
      const layers = runLayers(context, child, paragraphChain);
      runs.push({
        text,
        bold: layeredToggle(layers, "b"),
        italic: layeredToggle(layers, "i"),
        underline: layeredToggle(layers, "u"),
        strike: layeredToggle(layers, "strike") || layeredToggle(layers, "dstrike"),
      });
    } else if (RUN_CONTAINERS.has(child.localName)) {
      collectRuns(context, child, paragraphChain, runs);
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

function paragraphStyleChain(context: DocumentContext, paragraph: Element): WordStyle[] {
  return styleChain(context, attribute(childElement(childElement(paragraph, "pPr"), "pStyle"), "val"));
}

function paragraphRuns(context: DocumentContext, paragraph: Element, chain: WordStyle[]): WordRun[] {
  const runs: WordRun[] = [];
  collectRuns(context, paragraph, chain, runs);
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

function headingLevel(properties: Element | null, chain: WordStyle[]) {
  const level = outlineLevel(properties) ?? chain.find((style) => style.headingLevel !== null)?.headingLevel ?? null;
  if (level === null) return null;
  return WORD_HEADING_LEVELS[Math.min(Math.max(level, 1), 6) - 1] ?? null;
}

function numberingValue(properties: Element | null, chain: WordStyle[], name: string): string | null {
  const direct = attribute(childElement(childElement(properties, "numPr"), name), "val");
  if (direct !== null) return direct;
  for (const style of chain) {
    const value = attribute(childElement(style.numbering, name), "val");
    if (value !== null) return value;
  }
  return null;
}

function listMembership(
  context: DocumentContext,
  properties: Element | null,
  chain: WordStyle[],
): { id: string; ordered: boolean } | null {
  const id = numberingValue(properties, chain, "numId");
  if (id === null || id === "0") return null;
  const level = numberingValue(properties, chain, "ilvl") ?? "0";
  return { id, ordered: context.orderedLists.get(id)?.has(level) ?? false };
}

function reserveUnit(context: DocumentContext): boolean {
  if (context.units >= WORD_DOCUMENT_MAX_BLOCKS) {
    context.truncated = true;
    return false;
  }
  context.units += 1;
  return true;
}

function addListItem(context: DocumentContext, list: { id: string; ordered: boolean }, runs: WordRun[]): void {
  const previous = context.blocks.at(-1);
  if (
    previous?.kind === "list" &&
    previous === context.openList?.block &&
    context.openList.id === list.id &&
    previous.ordered === list.ordered
  ) {
    previous.items.push(runs);
    return;
  }
  const block: WordBlock = { kind: "list", ordered: list.ordered, items: [runs] };
  context.blocks.push(block);
  context.openList = { block, id: list.id };
}

function addParagraph(context: DocumentContext, paragraph: Element): void {
  const chain = paragraphStyleChain(context, paragraph);
  const runs = paragraphRuns(context, paragraph, chain);
  if (!hasText(runs) || !reserveUnit(context)) return;
  const properties = childElement(paragraph, "pPr");
  const level = headingLevel(properties, chain);
  if (level !== null) {
    context.blocks.push({ kind: "heading", level, runs });
    return;
  }
  const list = listMembership(context, properties, chain);
  if (list === null) {
    context.blocks.push({ kind: "paragraph", runs });
    return;
  }
  addListItem(context, list, runs);
}

function cellParagraphs(context: DocumentContext, parent: Element, paragraphs: WordRun[][]): void {
  for (const child of childElements(parent)) {
    if (context.truncated) return;
    if (child.localName === "p") {
      const runs = paragraphRuns(context, child, paragraphStyleChain(context, child));
      if (hasText(runs) && reserveUnit(context)) paragraphs.push(runs);
    } else if (child.localName === "tbl") {
      for (const row of childElements(child, "tr")) {
        for (const cell of childElements(row, "tc")) cellParagraphs(context, cell, paragraphs);
      }
    } else if (BLOCK_CONTAINERS.has(child.localName)) {
      cellParagraphs(context, child, paragraphs);
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
      cellParagraphs(context, cell, paragraphs);
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

export function parseWordDocument(bytes: Uint8Array): WordDocumentData {
  const files = unzipOfficeXml(bytes, DOCX_XML_ENTRY);
  const document = xmlDocument(files["word/document.xml"]);
  const body = document ? document.getElementsByTagNameNS("*", "body")[0] : undefined;
  if (!body) throw new Error("The document has no readable body.");
  const context: DocumentContext = {
    styles: parseStyles(xmlDocument(files["word/styles.xml"])),
    orderedLists: parseOrderedLists(xmlDocument(files["word/numbering.xml"])),
    blocks: [],
    openList: null,
    units: 0,
    truncated: false,
  };
  addBlocks(context, body);
  return { blocks: context.blocks, truncated: context.truncated };
}
