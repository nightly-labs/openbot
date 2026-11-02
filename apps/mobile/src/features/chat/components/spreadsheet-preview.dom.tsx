"use dom";

import { parseSpreadsheet, type SpreadsheetData } from "@openbot/contracts/spreadsheet-workbook";
import { useMemo, useState } from "react";
import { base64Bytes } from "../model/base64-bytes";

interface SpreadsheetPreviewProps {
  /** The `.xlsx` file as Base64. */
  base64: string;
  title: string;
  /** The language that formats the cell numbers, as desktop formats them. */
  locale: string;
  /** The space that the floating header and the home indicator cover. */
  insets: { top: number; bottom: number };
  colors: { background: string; foreground: string; muted: string; border: string; field: string };
  failedText: string;
  truncatedText: string;
  dom?: import("expo/dom").DOMProps;
}

const NO_INSETS = { top: 0, bottom: 0 };
const NO_COLORS = { background: "#fff", foreground: "#000", muted: "#666", border: "#ddd", field: "#f2f2f2" };
const FONT = "13px/18px system-ui";

interface Cell {
  id: string;
  value: string;
}

interface ShownSheet {
  id: string;
  name: string;
  header: Cell[];
  rows: { id: string; cells: Cell[] }[];
}

/** The sheets with an id for each sheet, row and cell: the place of each in the workbook. */
function shownSheets(workbook: SpreadsheetData): ShownSheet[] {
  const cells = (row: string[]) => row.map((value, column) => ({ id: String(column), value }));
  return workbook.sheets.map((sheet, index) => ({
    id: String(index),
    name: sheet.name,
    header: cells(sheet.rows[0] ?? []),
    rows: sheet.rows.slice(1).map((row, number) => ({ id: String(number), cells: cells(row) })),
  }));
}

/**
 * The sheets of an `.xlsx` file as tables, with the parser of the desktop preview. The parser
 * reads the workbook XML with `DOMParser`, which this web view has and the app does not.
 * The first row is the header, and the tabs choose a sheet when the workbook has several.
 * The props have defaults: Expo Go on Android can render once before they come; see expo-go-dom.ts.
 */
export default function SpreadsheetPreview({
  base64 = "",
  title = "",
  locale = "en",
  insets = NO_INSETS,
  colors = NO_COLORS,
  failedText = "",
  truncatedText = "",
}: SpreadsheetPreviewProps) {
  const workbook = useMemo<SpreadsheetData | null>(() => {
    if (!base64) return null;
    try {
      return parseSpreadsheet(base64Bytes(base64), {
        number: (value, options) => new Intl.NumberFormat(locale, options).format(value),
      });
    } catch {
      return null;
    }
  }, [base64, locale]);
  const sheets = useMemo(() => (workbook ? shownSheets(workbook) : []), [workbook]);
  const [active, setActive] = useState("0");
  const sheet = sheets.find((current) => current.id === active) ?? sheets[0];
  const cell = {
    padding: "6px 10px",
    border: `1px solid ${colors.border}`,
    whiteSpace: "pre",
    textAlign: "left",
  } as const;

  return (
    <div
      role="document"
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "auto",
        background: colors.background,
        color: colors.foreground,
        font: FONT,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 16,
        boxSizing: "border-box",
      }}
    >
      {base64 && !workbook ? (
        <p style={{ color: colors.muted, textAlign: "center", font: "15px system-ui", margin: "48px 24px" }}>
          {failedText}
        </p>
      ) : null}
      {sheets.length > 1 ? (
        <div role="tablist" style={{ display: "flex", gap: 8, padding: "8px 16px", overflowX: "auto" }}>
          {sheets.map((current) => (
            <button
              key={current.id}
              type="button"
              role="tab"
              aria-selected={current.id === sheet?.id}
              onClick={() => setActive(current.id)}
              style={{
                flex: "none",
                font: FONT,
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: 999,
                border: `1px solid ${colors.border}`,
                background: current.id === sheet?.id ? colors.foreground : colors.field,
                color: current.id === sheet?.id ? colors.background : colors.foreground,
              }}
            >
              {current.name}
            </button>
          ))}
        </div>
      ) : null}
      {sheet ? (
        <table style={{ borderCollapse: "collapse", margin: "8px 16px" }}>
          <caption style={{ textAlign: "left", fontWeight: 600, padding: "4px 0 8px" }}>{sheet.name}</caption>
          {sheet.header.length ? (
            <thead>
              <tr>
                {sheet.header.map((header) => (
                  <th key={header.id} scope="col" style={{ ...cell, background: colors.field, fontWeight: 600 }}>
                    {header.value}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {sheet.rows.map((row) => (
              <tr key={row.id}>
                {row.cells.map((value) => (
                  <td key={value.id} style={cell}>
                    {value.value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {workbook?.truncated ? <p style={{ color: colors.muted, margin: "8px 16px" }}>{truncatedText}</p> : null}
    </div>
  );
}
