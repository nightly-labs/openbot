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

function readingNote(hasText: boolean, cutPage: number | null, nextPage: number | null): string | null {
  const next = nextPage === null ? null : `Call read_document again with firstPage ${nextPage} for the next pages.`;
  if (!hasText) return next === null ? SCANNED_NOTE : `These pages have no text. ${next}`;
  if (cutPage !== null) return [`The text of page ${cutPage} is too long: its end is missing.`, next].join(" ").trim();
  return next;
}

export async function extractPdfText(
  bytes: Uint8Array,
  firstPage: number,
  signal: AbortSignal,
): Promise<DocumentReading> {
  const loading = getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  const stop = () => void loading.destroy();
  signal.addEventListener("abort", stop, { once: true });
  try {
    const document = await loading.promise;
    const pageCount = document.numPages;
    if (firstPage > pageCount)
      throw new PdfPageOutOfRange(`The PDF has only ${pageCount} ${pageCount === 1 ? "page" : "pages"}.`);
    const pages: string[] = [];
    let length = 0;
    let hasText = false;
    let cutPage: number | null = null;
    let lastPage = firstPage - 1;
    while (lastPage < pageCount && pages.length < PAGES_PER_READ) {
      signal.throwIfAborted();
      const number = lastPage + 1;
      const page = await document.getPage(number);
      const text = pageText((await page.getTextContent()).items);
      page.cleanup();
      const block = `--- page ${number} ---\n${text}`;
      if (pages.length > 0 && length + block.length > TEXT_PER_READ) break;
      if (block.length > TEXT_PER_READ) cutPage = number;
      pages.push(block.slice(0, TEXT_PER_READ));
      length += block.length + 2;
      hasText ||= text.length > 0;
      lastPage = number;
    }
    const nextPage = lastPage < pageCount ? lastPage + 1 : null;
    const note = readingNote(hasText, cutPage, nextPage);
    return { pageCount, firstPage, lastPage, nextPage, text: pages.join("\n\n"), note };
  } finally {
    signal.removeEventListener("abort", stop);
    await loading.destroy();
  }
}
