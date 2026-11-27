import "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

const PAGES_PER_READ = 30;
const TEXT_PER_READ = 60_000;
const SCANNED_NOTE =
  "These pages have no text. The PDF is possibly scanned. OpenBot cannot read text in pictures of pages. Tell the user.";

interface DocumentReading {
  pageCount: number;
  firstPage: number;
  lastPage: number;
  nextPage: number | null;
  text: string;
  note: string | null;
}

class PdfPageOutOfRange extends Error {
  override name = "PdfPageOutOfRange";
}

function pageText(items: readonly object[]): string {
  return items
    .map((item) => ("str" in item ? `${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : ""}` : ""))
    .join("")
    .trim();
}

export async function extractPdfText(bytes: Uint8Array, firstPage: number): Promise<DocumentReading> {
  const loading = getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const document = await loading.promise;
    const pageCount = document.numPages;
    if (firstPage > pageCount) throw new PdfPageOutOfRange(`The PDF has only ${pageCount} pages.`);
    const pages: string[] = [];
    let length = 0;
    let hasText = false;
    let lastPage = firstPage - 1;
    while (lastPage < pageCount && lastPage - firstPage + 1 < PAGES_PER_READ && length < TEXT_PER_READ) {
      lastPage += 1;
      const page = await document.getPage(lastPage);
      const text = pageText((await page.getTextContent()).items);
      page.cleanup();
      hasText ||= text.length > 0;
      pages.push(`--- page ${lastPage} ---\n${text}`);
      length += text.length;
    }
    const nextPage = lastPage < pageCount ? lastPage + 1 : null;
    const note = !hasText
      ? SCANNED_NOTE
      : nextPage === null
        ? null
        : `Call read_document again with firstPage ${nextPage} for the next pages.`;
    return { pageCount, firstPage, lastPage, nextPage, text: pages.join("\n\n").slice(0, TEXT_PER_READ), note };
  } finally {
    await loading.destroy();
  }
}
