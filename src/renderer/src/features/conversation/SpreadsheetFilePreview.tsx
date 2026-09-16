import { strFromU8, unzipSync } from "fflate";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "../../components/ui";

const MAX_ROWS = 500;
const MAX_COLUMNS = 50;

interface SpreadsheetSheet {
  name: string;
  rows: string[][];
}

interface SpreadsheetData {
  sheets: SpreadsheetSheet[];
  truncated: boolean;
}

function xmlDocument(bytes: Uint8Array | undefined, name: string): Document {
  if (!bytes) throw new Error(`The workbook is missing ${name}.`);
  const document = new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The workbook contains invalid XML.");
  return document;
}

function zipPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function relationshipTarget(target: string): string {
  return zipPath(target.startsWith("/") ? target : `xl/${target}`);
}

function columnIndex(reference: string | null): number | null {
  const match = reference?.match(/^([A-Z]+)/iu);
  if (!match?.[1]) return null;
  let result = 0;
  for (const character of match[1].toUpperCase()) result = result * 26 + character.charCodeAt(0) - 64;
  return result - 1;
}

function cellValue(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return cell.getElementsByTagNameNS("*", "is")[0]?.textContent ?? "";
  const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
  if (type === "s") return sharedStrings[Number(value)] ?? "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  return value;
}

function parseSheet(bytes: Uint8Array, sharedStrings: string[], name: string): SpreadsheetSheet {
  const document = xmlDocument(bytes, "a worksheet");
  const rows: string[][] = [];
  const rowElements = Array.from(document.getElementsByTagNameNS("*", "row")).slice(0, MAX_ROWS);
  let maxColumns = 0;
  for (const [rowIndex, rowElement] of rowElements.entries()) {
    const row = Array.from({ length: Math.min(maxColumns, MAX_COLUMNS) }, () => "");
    for (const cell of Array.from(rowElement.getElementsByTagNameNS("*", "c"))) {
      const index = columnIndex(cell.getAttribute("r"));
      if (index === null || index >= MAX_COLUMNS) continue;
      row[index] = cellValue(cell, sharedStrings);
      maxColumns = Math.max(maxColumns, index + 1);
    }
    row.length = Math.min(maxColumns, MAX_COLUMNS);
    rows[rowIndex] = row;
  }
  for (const row of rows) row.length = maxColumns;
  return { name, rows };
}

export function parseSpreadsheet(bytes: Uint8Array): SpreadsheetData {
  const files = unzipSync(bytes);
  const workbook = xmlDocument(files["xl/workbook.xml"], "xl/workbook.xml");
  const relationships = xmlDocument(files["xl/_rels/workbook.xml.rels"], "xl/_rels/workbook.xml.rels");
  const relationshipTargets = new Map(
    Array.from(relationships.getElementsByTagNameNS("*", "Relationship")).map((relationship) => [
      relationship.getAttribute("Id"),
      relationshipTarget(relationship.getAttribute("Target") ?? ""),
    ]),
  );
  const sharedStrings = files["xl/sharedStrings.xml"]
    ? Array.from(
        xmlDocument(files["xl/sharedStrings.xml"], "xl/sharedStrings.xml").getElementsByTagNameNS("*", "si"),
        (item) => item.textContent ?? "",
      )
    : [];
  const sheets = Array.from(workbook.getElementsByTagNameNS("*", "sheet"))
    .map((sheet) => {
      const id =
        sheet.getAttribute("r:id") ??
        sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const target = id ? relationshipTargets.get(id) : undefined;
      if (!target || !files[target]) return null;
      return parseSheet(files[target], sharedStrings, sheet.getAttribute("name") ?? "Sheet");
    })
    .filter((sheet): sheet is SpreadsheetSheet => sheet !== null);
  if (sheets.length === 0) throw new Error("The workbook contains no readable sheets.");
  return {
    sheets,
    truncated: sheets.some(
      (sheet) => sheet.rows.length >= MAX_ROWS || sheet.rows.some((row) => row.length >= MAX_COLUMNS),
    ),
  };
}

export interface SpreadsheetFilePreviewProps {
  bytes: Uint8Array | null;
  loading?: boolean;
  error?: string | null;
  class?: string;
}

export function SpreadsheetFilePreview(props: SpreadsheetFilePreviewProps) {
  const parsed = createMemo(() => {
    if (props.loading || props.error || !props.bytes) return null;
    try {
      return parseSpreadsheet(props.bytes);
    } catch {
      return null;
    }
  });
  const parseError = () =>
    !props.loading && !props.error && props.bytes && !parsed() ? "Could not read this spreadsheet." : null;

  return (
    <div class={`spreadsheet-file-preview${props.class ? ` ${props.class}` : ""}`}>
      <Show
        when={parsed()}
        fallback={
          <pre class="file-preview-spreadsheet-status">
            {props.loading ? "Loading…" : (props.error ?? parseError() ?? "Preview unavailable.")}
          </pre>
        }
      >
        {(workbook) => {
          const [activeSheet, setActiveSheet] = createSignal(0);
          const sheet = () => workbook().sheets[activeSheet()] ?? workbook().sheets[0];
          return (
            <>
              <Show when={workbook().sheets.length > 1}>
                <div class="file-preview-spreadsheet-tabs">
                  <For each={workbook().sheets}>
                    {(current, index) => (
                      <Button
                        variant="outline"
                        type="button"
                        aria-pressed={activeSheet() === index() ? "true" : "false"}
                        onClick={() => setActiveSheet(index())}
                      >
                        {current.name}
                      </Button>
                    )}
                  </For>
                </div>
              </Show>
              <div class="file-preview-spreadsheet-table-wrap">
                <table class="file-preview-spreadsheet-table">
                  <caption>{sheet()?.name}</caption>
                  <Show when={sheet()?.rows[0]}>
                    {(header) => (
                      <thead>
                        <tr>
                          <For each={header()}>{(value) => <th scope="col">{value}</th>}</For>
                        </tr>
                      </thead>
                    )}
                  </Show>
                  <tbody>
                    <For each={sheet()?.rows.slice(1)}>
                      {(row) => (
                        <tr>
                          <For each={row}>{(value) => <td>{value}</td>}</For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <Show when={workbook().truncated}>
                <p class="file-preview-spreadsheet-note">Preview limited to the first 500 rows and 50 columns.</p>
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}
