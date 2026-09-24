import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** The hex SHA-256 of a file. Reads it as a stream, so a large file does not fill memory. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
