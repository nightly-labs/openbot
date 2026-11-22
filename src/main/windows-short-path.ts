import { createRequire } from "node:module";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type * as Koffi from "koffi";

const logger = createOpenBotLogger("windows-short-path");
const requireModule = createRequire(import.meta.url);

type GetShortPathName = (longPath: string, shortPath: Buffer | null, length: number) => number;

let getShortPathName: GetShortPathName | null = null;

function loadGetShortPathName(): GetShortPathName {
  if (getShortPathName) return getShortPathName;
  const koffi: typeof Koffi = requireModule("koffi");
  getShortPathName = koffi
    .load("kernel32.dll")
    .func("uint32_t __stdcall GetShortPathNameW(str16 longPath, void *shortPath, uint32_t length)");
  return getShortPathName;
}

function isAscii(value: string): boolean {
  return !/[^\p{ASCII}]/u.test(value);
}

export function windowsShortPath(path: string): string {
  if (process.platform !== "win32" || isAscii(path)) return path;
  try {
    const query = loadGetShortPathName();
    const size = query(path, null, 0);
    if (size === 0) return path;
    const buffer = Buffer.alloc(size * 2);
    const length = query(path, buffer, size);
    if (length === 0 || length >= size) return path;
    const shortPath = buffer.toString("utf16le", 0, length * 2);
    return isAscii(shortPath) ? shortPath : path;
  } catch (error) {
    logger.warn("Unable to read the Windows short path:", toLogValue(error));
    return path;
  }
}
