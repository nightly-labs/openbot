import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { type ReportStorage, telemetryIO } from "./queue";

/** Atomic replacement; the file contains sanitized reports only. */
export function fileReportStorage(path: string): ReportStorage {
  return {
    read: () =>
      telemetryIO(async () => {
        try {
          return JSON.parse(await readFile(path, "utf8"));
        } catch (error) {
          if (error instanceof SyntaxError || (isDynamicRecord(error) && error.code === "ENOENT")) return null;
          throw error;
        }
      }),
    write: (value) =>
      telemetryIO(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
        await rename(`${path}.tmp`, path);
      }),
  };
}
