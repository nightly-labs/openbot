import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileResponse } from "./file-response";

describe("fileResponse", () => {
  it("serves the whole file with the given headers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbot-file-response-"));
    const path = join(directory, "image.png");
    const bytes = randomBytes(300_000);
    await writeFile(path, bytes);

    const response = await fileResponse(path, { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff" });

    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("rejects a file that cannot be opened, so the protocol can answer 404", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbot-file-response-"));

    await expect(fileResponse(join(directory, "missing.png"), {})).rejects.toThrow(/ENOENT/);
  });

  it("rejects a directory instead of a body that fails after the headers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbot-file-response-"));

    await expect(fileResponse(directory, {})).rejects.toThrow("Not a regular file.");
  });
});
