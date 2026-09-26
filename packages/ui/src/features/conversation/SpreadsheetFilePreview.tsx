import { type AppFormat, createFormat } from "@openbot/i18n";
import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { strFromU8, unzipSync } from "fflate";
import { createMemo, createSignal, For, Show } from "solid-js";

const MAX_ROWS = 500;
const MAX_COLUMNS = 50;
const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_EXPANDED_BYTES = 32 * 1024 * 1024;
const XLSX_XML_ENTRY =
  /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/u;

interface SpreadsheetSheet {
  name: string;
  rows: string[][];
}

interface SpreadsheetData {
  sheets: SpreadsheetSheet[];
  truncated: boolean;
}

interface ParsedSheet {
  sheet: SpreadsheetSheet;
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

const BUILTIN_NUMBER_FORMATS = new Map<number, string>([
  [0, "General"],
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [9, "0%"],
  [10, "0.00%"],
  [14, "m/d/yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [49, "@"],
]);

function parseNumberFormats(bytes: Uint8Array | undefined): string[] {
  if (!bytes) return [];
  const document = xmlDocument(bytes, "xl/styles.xml");
  const formats = new Map(BUILTIN_NUMBER_FORMATS);
  for (const format of Array.from(document.getElementsByTagNameNS("*", "numFmt"))) {
    const id = Number(format.getAttribute("numFmtId"));
    const code = format.getAttribute("formatCode");
    if (Number.isInteger(id) && code) formats.set(id, code);
  }
  const cellFormats = document.getElementsByTagNameNS("*", "cellXfs")[0];
  return Array.from(cellFormats?.getElementsByTagNameNS("*", "xf") ?? [], (format) => {
    const id = Number(format.getAttribute("numFmtId"));
    return formats.get(id) ?? "General";
  });
}

function formatExcelDate(value: number, format: string, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + value * 86_400_000);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  if (!hasTimeFormat(format)) return day;
  return `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function unquotedFormat(format: string): string {
  return format.replace(/"[^"]*"/gu, "").replace(/\\./gu, "");
}

function hasDateFormat(format: string): boolean {
  return /[dy]/iu.test(unquotedFormat(format).replace(/\[[^\]]+\]/gu, ""));
}

function hasTimeFormat(format: string): boolean {
  const withoutMetadata = unquotedFormat(format).replace(/\[(?!h+\]|m+\]|s+\])[^\]]+\]/giu, "");
  return /h|s|am\/pm/iu.test(withoutMetadata);
}

function formatLiteralSuffix(format: string): string {
  return format.match(/"([^"]*)"\s*$/u)?.[1]?.trim() ?? "";
}

function isSupportedNumberFormat(format: string): boolean {
  const unquoted = unquotedFormat(format);
  if (
    unquoted.includes(";") ||
    /e[+-]?\d/iu.test(unquoted) ||
    /,+\s*$/u.test(unquoted.trim()) ||
    /\[(?:m+|s+)\]/iu.test(unquoted)
  )
    return false;
  if (hasDateFormat(format) || hasTimeFormat(format)) return true;
  return unquoted.replace(/[%#,0.]/gu, "").trim() === "";
}

function formatExcelTime(value: number, format: string): string {
  const totalSeconds = Math.max(0, Math.round(value * 86_400));
  const hours = /\[h+\]/iu.test(format) ? Math.floor(totalSeconds / 3_600) : Math.floor(totalSeconds / 3_600) % 24;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  const suffix = /am\/pm/iu.test(format) ? (hours >= 12 ? " PM" : " AM") : "";
  const displayedHours = /am\/pm/iu.test(format) ? hours % 12 || 12 : hours;
  return `${String(displayedHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}${/[s]/iu.test(format) ? `:${String(seconds).padStart(2, "0")}` : ""}${suffix}`;
}

function formatExcelNumber(value: string, format: string, date1904: boolean, numbers: AppFormat): string {
  const number = Number(value);
  if (!Number.isFinite(number) || format === "General" || format === "@") return value;
  if (!isSupportedNumberFormat(format)) return value;
  const decimals = format.match(/\.([0#]+)/u)?.[1] ?? "";
  if (decimals.length > 100) return value;
  const hasDate = hasDateFormat(format);
  if (hasDate) return formatExcelDate(number, format, date1904);
  if (hasTimeFormat(format)) return number < 0 ? value : formatExcelTime(number, format);
  const suffix = formatLiteralSuffix(format);
  const hasPercentScaling = unquotedFormat(format).includes("%");
  if (hasPercentScaling) {
    const minimumFractionDigits = (decimals.match(/0/gu) ?? []).length;
    const maximumFractionDigits = decimals.length;
    return `${numbers.number(number * 100, { minimumFractionDigits, maximumFractionDigits })}%${suffix ? ` ${suffix}` : ""}`;
  }
  const minimumFractionDigits = (decimals.match(/0/gu) ?? []).length;
  const integerFormat = unquotedFormat(format).split(".")[0] ?? "";
  const minimumIntegerDigits = Math.max(1, (integerFormat.match(/0/gu) ?? []).length);
  if (minimumIntegerDigits > 21) return value;
  const formatted = numbers.number(number, {
    minimumFractionDigits,
    maximumFractionDigits: decimals.length,
    minimumIntegerDigits,
    useGrouping: integerFormat.includes(","),
  });
  if (suffix) return suffix === "%" ? `${formatted}%` : `${formatted} ${suffix}`;
  return /"[^"]*%[^"]*"|\\%/u.test(format) ? `${formatted}%` : formatted;
}

function cellValue(
  cell: Element,
  sharedStrings: string[],
  numberFormats: string[],
  date1904: boolean,
  numbers: AppFormat,
): string {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") return cell.getElementsByTagNameNS("*", "is")[0]?.textContent ?? "";
  const valueElement = cell.getElementsByTagNameNS("*", "v")[0];
  if (!valueElement) return "";
  const value = valueElement.textContent ?? "";
  if (!value) return "";
  if (type === "s") return sharedStrings[Number(value)] ?? "";
  if (type === "str") return value;
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  const style = Number(cell.getAttribute("s"));
  return formatExcelNumber(value, numberFormats[style] ?? "General", date1904, numbers);
}

function parseSheet(
  bytes: Uint8Array,
  sharedStrings: string[],
  numberFormats: string[],
  date1904: boolean,
  name: string,
  numbers: AppFormat,
): ParsedSheet {
  const document = xmlDocument(bytes, "a worksheet");
  const rows: string[][] = [];
  const allRowElements = Array.from(document.getElementsByTagNameNS("*", "row"));
  const rowElements = allRowElements.slice(0, MAX_ROWS);
  let truncated = allRowElements.length > MAX_ROWS;
  let maxColumns = 0;
  for (const [rowIndex, rowElement] of rowElements.entries()) {
    const row = Array.from({ length: Math.min(maxColumns, MAX_COLUMNS) }, () => "");
    for (const cell of Array.from(rowElement.getElementsByTagNameNS("*", "c"))) {
      const index = columnIndex(cell.getAttribute("r"));
      if (index === null || index >= MAX_COLUMNS) {
        truncated = true;
        continue;
      }
      row[index] = cellValue(cell, sharedStrings, numberFormats, date1904, numbers);
      maxColumns = Math.max(maxColumns, index + 1);
    }
    row.length = Math.min(maxColumns, MAX_COLUMNS);
    rows[rowIndex] = row;
  }
  for (const row of rows) row.length = maxColumns;
  return { sheet: { name, rows }, truncated };
}

function unzipSpreadsheet(bytes: Uint8Array) {
  let expandedBytes = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      if (!XLSX_XML_ENTRY.test(file.name)) return false;
      if (file.originalSize > MAX_ZIP_ENTRY_BYTES) {
        throw new Error("The spreadsheet preview is too large to read safely.");
      }
      expandedBytes += file.originalSize;
      if (expandedBytes > MAX_ZIP_EXPANDED_BYTES) {
        throw new Error("The spreadsheet preview is too large to read safely.");
      }
      return true;
    },
  });
}

/** `numbers` formats cell numbers. The default is English, for a caller outside the app. */
export function parseSpreadsheet(bytes: Uint8Array, numbers: AppFormat = createFormat("en")): SpreadsheetData {
  const files = unzipSpreadsheet(bytes);
  const workbook = xmlDocument(files["xl/workbook.xml"], "xl/workbook.xml");
  const dateSystem = workbook.getElementsByTagNameNS("*", "workbookPr")[0]?.getAttribute("date1904");
  const date1904 = dateSystem === "1" || dateSystem === "true";
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
  const numberFormats = parseNumberFormats(files["xl/styles.xml"]);
  const parsedSheets = Array.from(workbook.getElementsByTagNameNS("*", "sheet"))
    .map((sheet) => {
      const id =
        sheet.getAttribute("r:id") ??
        sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const target = id ? relationshipTargets.get(id) : undefined;
      if (!target || !files[target]) return null;
      return parseSheet(
        files[target],
        sharedStrings,
        numberFormats,
        date1904,
        sheet.getAttribute("name") ?? "Sheet",
        numbers,
      );
    })
    .filter((sheet): sheet is ParsedSheet => sheet !== null);
  if (parsedSheets.length === 0) throw new Error("The workbook contains no readable sheets.");
  return {
    sheets: parsedSheets.map(({ sheet }) => sheet),
    truncated: parsedSheets.some(({ truncated }) => truncated),
  };
}

export interface SpreadsheetFilePreviewProps {
  bytes: Uint8Array | null;
  loading?: boolean;
  error?: string | null;
  class?: string;
}

export function SpreadsheetFilePreview(props: SpreadsheetFilePreviewProps) {
  const { t, format } = useText();
  const parsed = createMemo(() => {
    if (props.loading || props.error || !props.bytes) return null;
    try {
      return parseSpreadsheet(props.bytes, format);
    } catch {
      return null;
    }
  });
  const parseError = () =>
    !props.loading && !props.error && props.bytes && !parsed() ? t("preview.spreadsheet.readFailed") : null;

  return (
    <div class={`spreadsheet-file-preview${props.class ? ` ${props.class}` : ""}`}>
      <Show
        when={parsed()}
        fallback={
          <pre class="file-preview-spreadsheet-status">
            {props.loading ? t("common.loading") : (props.error ?? parseError() ?? t("preview.unavailable"))}
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
                <p class="file-preview-spreadsheet-note">
                  {t("preview.spreadsheet.truncated", {
                    rows: format.number(MAX_ROWS),
                    columns: format.number(MAX_COLUMNS),
                  })}
                </p>
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}
