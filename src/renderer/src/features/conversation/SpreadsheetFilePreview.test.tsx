import { fireEvent, render, screen } from "@solidjs/testing-library";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseSpreadsheet, SpreadsheetFilePreview } from "./SpreadsheetFilePreview";

function workbook(): Uint8Array {
  return zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="true"/><sheets><sheet name="Plan" sheetId="1" r:id="rId1"/><sheet name="Regions" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    ),
    "xl/styles.xml": strToU8(
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="11"><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd"/><numFmt numFmtId="167" formatCode="h:mm"/><numFmt numFmtId="168" formatCode="0.##"/><numFmt numFmtId="169" formatCode="0.00 &quot;USD&quot;"/><numFmt numFmtId="170" formatCode="0.00E+00"/><numFmt numFmtId="171" formatCode="0.00&quot;%&quot;"/><numFmt numFmtId="172" formatCode="0.0,,&quot; million&quot;"/><numFmt numFmtId="173" formatCode="00000"/><numFmt numFmtId="174" formatCode="#.##"/><numFmt numFmtId="175" formatCode="00000000000000000000000"/></numFmts><cellXfs count="12"><xf numFmtId="0"/><xf numFmtId="165"/><xf numFmtId="166"/><xf numFmtId="167"/><xf numFmtId="168"/><xf numFmtId="169"/><xf numFmtId="170"/><xf numFmtId="171"/><xf numFmtId="172"/><xf numFmtId="173"/><xf numFmtId="174"/><xf numFmtId="175"/></cellXfs></styleSheet>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="inlineStr"><is><t>Task</t></is></c><c r="B1" t="inlineStr"><is><t>Status</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Preview</t></is></c><c r="B2" t="inlineStr"><is><t>Ready</t></is></c></row></sheetData></worksheet>',
    ),
    "xl/worksheets/sheet2.xml": strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="inlineStr"><is><t>Region</t></is></c><c r="B1" t="inlineStr"><is><t>Activation</t></is></c><c r="C1" t="inlineStr"><is><t>Date</t></is></c><c r="D1" t="inlineStr"><is><t>Time</t></is></c><c r="E1" t="inlineStr"><is><t>Empty</t></is></c><c r="F1" t="inlineStr"><is><t>Optional</t></is></c><c r="G1" t="inlineStr"><is><t>Currency</t></is></c><c r="H1" t="inlineStr"><is><t>Exponent</t></is></c><c r="I1" t="inlineStr"><is><t>LiteralPercent</t></is></c><c r="J1" t="inlineStr"><is><t>Scaled</t></is></c><c r="K1" t="inlineStr"><is><t>FormulaText</t></is></c><c r="L1" t="inlineStr"><is><t>Postal</t></is></c><c r="M1" t="inlineStr"><is><t>PostalLarge</t></is></c><c r="N1" t="inlineStr"><is><t>Sparse</t></is></c><c r="O1" t="inlineStr"><is><t>TooWide</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>North</t></is></c><c r="B2" s="1"><v>0.55</v></c><c r="C2" s="2"><v>0</v></c><c r="D2" s="3"><v>0.5</v></c><c r="E2" s="1"/><c r="F2" s="4"><v>1.25</v></c><c r="G2" s="5"><v>1.25</v></c><c r="H2" s="6"><v>0.000123</v></c><c r="I2" s="7"><v>12.5</v></c><c r="J2" s="8"><v>1500000</v></c><c r="K2" t="str" s="1"><v>00042</v></c><c r="L2" s="9"><v>123</v></c><c r="M2" s="9"><v>12345</v></c><c r="N2" s="10"><v>1.2</v></c><c r="O2" s="11"><v>123</v></c><c r="AZ2" s="1"><v>0.1</v></c></row></sheetData></worksheet>',
    ),
  });
}

function unsupportedFormatsWorkbook(): Uint8Array {
  const longFormat = `0.${"0".repeat(101)}`;
  return zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Formats" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/styles.xml": strToU8(
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="176" formatCode="[$USD-409]0.00"/><numFmt numFmtId="177" formatCode="${longFormat}"/><numFmt numFmtId="178" formatCode="[m]:ss"/><numFmt numFmtId="179" formatCode="[hh]:mm"/></numFmts><cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="176"/><xf numFmtId="177"/><xf numFmtId="178"/><xf numFmtId="179"/></cellXfs></styleSheet>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="inlineStr"><is><t>CurrencyMetadata</t></is></c><c r="B1" t="inlineStr"><is><t>LongFraction</t></is></c><c r="C1" t="inlineStr"><is><t>ElapsedMinutes</t></is></c><c r="D1" t="inlineStr"><is><t>ElapsedHours</t></is></c></row><row><c r="A2" s="1"><v>1.25</v></c><c r="B2" s="2"><v>1.5</v></c><c r="C2" s="3"><v>1.5</v></c><c r="D2" s="4"><v>1.5</v></c></row></sheetData></worksheet>',
    ),
  });
}

describe("SpreadsheetFilePreview", () => {
  it("renders workbook cells and switches between sheets", async () => {
    render(() => <SpreadsheetFilePreview bytes={workbook()} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Task" })).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Regions" }));
    expect(screen.getByRole("columnheader", { name: "Region" })).toBeInTheDocument();
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("55.0%")).toBeInTheDocument();
    expect(screen.getByText("1904-01-01")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
    expect(screen.getByText("1.25")).toBeInTheDocument();
    expect(screen.getByText("1.25 USD")).toBeInTheDocument();
    expect(screen.getByText("0.000123")).toBeInTheDocument();
    expect(screen.getByText("12.50%")).toBeInTheDocument();
    expect(screen.getByText("1500000")).toBeInTheDocument();
    expect(screen.getByText("00042")).toBeInTheDocument();
    expect(screen.getByText("00123")).toBeInTheDocument();
    expect(screen.getByText("12345")).toBeInTheDocument();
    expect(screen.getByText("1.2")).toBeInTheDocument();
    expect(screen.getByText("123")).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
    expect(screen.getByText("Preview limited to the first 500 rows and 50 columns.")).toBeInTheDocument();
  });

  it("rejects a file that is not a readable workbook", () => {
    expect(() => parseSpreadsheet(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("preserves values for unsupported metadata and fractional formats", () => {
    expect(parseSpreadsheet(unsupportedFormatsWorkbook()).sheets[0]?.rows[1]).toEqual(["1.25", "1.5", "1.5", "36:00"]);
  });

  it("rejects an oversized expanded XML entry before parsing it", () => {
    const oversized = zipSync({
      "xl/worksheets/sheet1.xml": strToU8("x".repeat(8 * 1024 * 1024 + 1)),
    });
    expect(() => parseSpreadsheet(oversized)).toThrow("read safely");
  });
});
