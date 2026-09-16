import { fireEvent, render, screen } from "@solidjs/testing-library";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseSpreadsheet, SpreadsheetFilePreview } from "./SpreadsheetFilePreview";

function workbook(): Uint8Array {
  return zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Plan" sheetId="1" r:id="rId1"/><sheet name="Regions" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    ),
    "xl/styles.xml": strToU8(
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="165"/></cellXfs></styleSheet>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="inlineStr"><is><t>Task</t></is></c><c r="B1" t="inlineStr"><is><t>Status</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>Preview</t></is></c><c r="B2" t="inlineStr"><is><t>Ready</t></is></c></row></sheetData></worksheet>',
    ),
    "xl/worksheets/sheet2.xml": strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="inlineStr"><is><t>Region</t></is></c><c r="B1" t="inlineStr"><is><t>Activation</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>North</t></is></c><c r="B2" s="1"><v>0.55</v></c></row></sheetData></worksheet>',
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
  });

  it("rejects a file that is not a readable workbook", () => {
    expect(() => parseSpreadsheet(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("rejects an oversized expanded XML entry before parsing it", () => {
    const oversized = zipSync({
      "xl/worksheets/sheet1.xml": strToU8("x".repeat(8 * 1024 * 1024 + 1)),
    });
    expect(() => parseSpreadsheet(oversized)).toThrow("read safely");
  });
});
