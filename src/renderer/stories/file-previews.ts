import type { FilePreview } from "@openbot/contracts/ipc";
import { strToU8, zipSync } from "fflate";

/**
 * File previews for the Storybook stories of the file preview panel. The panel takes
 * the bytes that the main process read, so each fixture is written here as text.
 */

const encode = (value: string) => new TextEncoder().encode(value);

const filePreview = (
  name: string,
  mimeType: string,
  previewKind: FilePreview["previewKind"],
  content: string,
): FilePreview => {
  const bytes = encode(content);
  return { name, size: bytes.length, mimeType, previewKind, bytes };
};

const MARKDOWN = `# Release notes

OpenBot keeps workspaces, conversations, and attachments on **your** computer.

## What is new

- A file preview panel for markdown, text, images, and PDFs
- Resizable panels that remember their width
- Links that open in the embedded browser: [openbot.run](https://openbot.run)

## Configuration

Set the provider in \`~/OpenBot/config.json\`:

\`\`\`json
{
  "provider": "claude-code",
  "workspace": "~/OpenBot/Agents"
}
\`\`\`

> Migrations are irreversible. No backup of \`openbot.db\` is made before an upgrade.

| Kind | Rendered as |
| --- | --- |
| markdown | Rich text |
| text | Monospace |
| image | Bitmap |

1. Open an attachment
2. Read the preview
3. Open it externally when you need the full application
`;

// Text keeps its spacing and does not wrap. The long lines show the horizontal
// scroll, and the indented lines show that the spacing stays as it is in the file.
const TEXT = `2026-09-13T09:12:04.118Z  info   provider.claude-code   session started  id=sess_8f31c2
2026-09-13T09:12:04.402Z  debug  ipc.attachments        preview requested  name=RELEASE-NOTES.md kind=markdown bytes=1043
2026-09-13T09:12:05.907Z  warn   team-api.host          adapter v2 client asked for a v3 field; the response keeps the v2 shape and drops "routines"
2026-09-13T09:12:06.311Z  error  provider.codex         spawn failed  code=ENOENT  path=/usr/local/bin/codex
  retry 1 of 3 in 500 ms
  retry 2 of 3 in 1000 ms
2026-09-13T09:12:08.044Z  info   provider.codex         ready  pid=48122
2026-09-13T09:12:08.049Z  info   db.migrations          schema v14 is current; no migration ran
`;

const SOURCE = `import type { AgentSummary } from "./agents";

/** Team API v1-v3 call an agent a "bot". Translate on the wire only. */
export function toWireAgent(agent: AgentSummary) {
  return { botId: agent.id, name: agent.name, workspace: agent.workspacePath };
}
`;

const JSON_DATA = `{
  "sources": 8,
  "verified": 7,
  "needsReview": 1
}
`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
  <rect width="320" height="200" rx="12" fill="#12141a" />
  <rect x="24" y="32" width="120" height="56" rx="10" fill="#2f6df6" />
  <rect x="176" y="112" width="120" height="56" rx="10" fill="#f6a62f" />
  <path d="M144 60 H210 V112" stroke="#8d94a5" stroke-width="3" fill="none" />
  <text x="84" y="66" fill="#ffffff" font-family="sans-serif" font-size="14" text-anchor="middle">Renderer</text>
  <text x="236" y="146" fill="#12141a" font-family="sans-serif" font-size="14" text-anchor="middle">Main</text>
</svg>
`;

// A one-page PDF, written here so the stories need no binary asset. Each offset in
// the cross-reference table must give the byte position of its object, so the table
// is built after the objects. All bytes are ASCII: a string index is a byte offset.
const buildPdf = () => {
  const stream = "BT /F1 18 Tf 24 150 Td (OpenBot file preview) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 200]" +
      " /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const offsets: number[] = [];
  let body = "%PDF-1.4\n";
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startXref = body.length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  const size = objects.length + 1;
  return `${body}xref\n0 ${size}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
};

/**
 * A silent MPEG-1 Layer III stream: 40 frames of 417 bytes at 128 kbit/s and 44.1 kHz, which is
 * about one second. Only the four header bytes of each frame carry meaning; the rest stays zero,
 * so the decoder reads silence. A QuickTime container has no equally short honest form, so there
 * is no video fixture: point the panel at a real .mov to check that kind.
 */
const buildMp3 = (): Uint8Array => {
  const frameBytes = 417;
  const frames = 40;
  const bytes = new Uint8Array(frameBytes * frames);
  for (let index = 0; index < frames; index += 1) {
    bytes.set([0xff, 0xfb, 0x90, 0x00], index * frameBytes);
  }
  return bytes;
};

const buildXlsx = (): Uint8Array =>
  zipSync({
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Operating plan" sheetId="1" r:id="rId1"/><sheet name="Regional view" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Workstream</t></is></c><c r="B1" t="inlineStr"><is><t>Owner</t></is></c><c r="C1" t="inlineStr"><is><t>Status</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Product QA</t></is></c><c r="B2" t="inlineStr"><is><t>Builder</t></is></c><c r="C2" t="inlineStr"><is><t>Ready</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Evidence</t></is></c><c r="B3" t="inlineStr"><is><t>Research</t></is></c><c r="C3" t="inlineStr"><is><t>In review</t></is></c></row></sheetData></worksheet>',
    ),
    "xl/worksheets/sheet2.xml": strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Region</t></is></c><c r="B1" t="inlineStr"><is><t>Activation</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>North</t></is></c><c r="B2"><v>55</v></c></row></sheetData></worksheet>',
    ),
  });

export const MARKDOWN_PREVIEW = filePreview("RELEASE-NOTES.md", "text/markdown", "markdown", MARKDOWN);

export const MARKDOWN_SHORT_PREVIEW = filePreview(
  "NOTES.md",
  "text/markdown",
  "markdown",
  "## Today\n\nAsk the agent to summarize the thread.\n",
);

export const TEXT_PREVIEW = filePreview("provider-session.log", "text/plain", "text", TEXT);

export const SOURCE_PREVIEW = filePreview("current-agent-keys.ts", "text/typescript", "text", SOURCE);

export const JSON_PREVIEW = filePreview("evidence-map.json", "application/json", "text", JSON_DATA);

export const IMAGE_PREVIEW = filePreview("trust-boundary.svg", "image/svg+xml", "image", SVG);

export const PDF_PREVIEW = filePreview("invoice-2026-09.pdf", "application/pdf", "pdf", buildPdf());

export const AUDIO_PREVIEW: FilePreview = {
  name: "standup-recap.mp3",
  mimeType: "audio/mpeg",
  previewKind: "audio",
  bytes: buildMp3(),
  size: buildMp3().byteLength,
};

export const XLSX_PREVIEW: FilePreview = {
  name: "operating-plan.xlsx",
  size: buildXlsx().byteLength,
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  previewKind: "spreadsheet",
  bytes: buildXlsx(),
};

/** A kind that the panel cannot show. The user opens the file externally. */
export const UNSUPPORTED_PREVIEW: FilePreview = {
  name: "archive.zip",
  size: 68 * 1024,
  mimeType: "application/zip",
  previewKind: "none",
  bytes: null,
};

/** The workspace files that the chat story links to, in the order that the chat names them. */
export const WORKSPACE_FILE_PREVIEWS: FilePreview[] = [
  MARKDOWN_PREVIEW,
  TEXT_PREVIEW,
  SOURCE_PREVIEW,
  JSON_PREVIEW,
  IMAGE_PREVIEW,
  PDF_PREVIEW,
  AUDIO_PREVIEW,
  XLSX_PREVIEW,
];

/** Find the preview for a file path, as the main process does for a file link in a message. */
export function filePreviewForPath(path: string): FilePreview | null {
  const name = path.replaceAll("\\", "/").split("/").pop();
  return WORKSPACE_FILE_PREVIEWS.find((preview) => preview.name === name) ?? null;
}
