import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { Duration, Effect, Schema } from "effect";
import { z } from "zod";

export const READ_DOCUMENT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const READ_DEADLINE = Duration.seconds(60);

export const readDocumentToolShape = {
  path: z.string().min(1).max(INPUT_LIMITS.path).describe("An absolute path, or a path in your workspace."),
  firstPage: z.number().int().min(1).optional().describe("The first page to read. Default 1."),
};

export const readDocumentToolSchema = z.strictObject(readDocumentToolShape);

export class DocumentReadFailed extends Schema.TaggedError<DocumentReadFailed>()("DocumentReadFailed", {
  reason: Schema.String,
}) {}

function readFailure(cause: unknown): DocumentReadFailed {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "PdfPageOutOfRange" && cause instanceof Error) return new DocumentReadFailed({ reason: cause.message });
  if (name === "PasswordException")
    return new DocumentReadFailed({ reason: "The PDF has a password. OpenBot cannot open a PDF with a password." });
  if (name === "InvalidPDFException")
    return new DocumentReadFailed({ reason: "The file is not a valid PDF, or it is damaged." });
  return new DocumentReadFailed({ reason: "OpenBot could not read this PDF." });
}

export const readPdfText = Effect.fn("DocumentReader.readPdfText")(function* (bytes: Uint8Array, firstPage: number) {
  return yield* Effect.tryPromise({
    try: async (signal) => (await import("./pdf-text")).extractPdfText(bytes, firstPage, signal),
    catch: readFailure,
  }).pipe(
    Effect.timeoutOrElse({
      duration: READ_DEADLINE,
      orElse: () => Effect.fail(new DocumentReadFailed({ reason: "Reading the PDF took too long." })),
    }),
  );
});
