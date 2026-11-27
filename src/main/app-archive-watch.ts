import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, type FSWatcher, fstatSync, openSync, readSync, watch } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AppTranslate } from "@openbot/i18n";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Option, Schema } from "effect";
import { dialog, shell } from "electron";
import { DOWNLOAD_URL } from "./download-url";

const logger = createOpenBotLogger("app-archive");
const SETTLE_MS = 2_000;

const decodePlistIntegrity = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      ElectronAsarIntegrity: Schema.Struct({ "Resources/app.asar": Schema.Struct({ hash: Schema.String }) }),
    }),
  ),
);

function readHeaderHash(archivePath: string): string | null {
  const previousNoAsar = process.noAsar;
  process.noAsar = true;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(archivePath, "r");
    const prefix = Buffer.alloc(16);
    if (readSync(descriptor, prefix, 0, 16, 0) !== 16) return null;
    const length = prefix.readUInt32LE(12);
    if (16 + length > fstatSync(descriptor).size) return null;
    const header = Buffer.alloc(length);
    if (readSync(descriptor, header, 0, length, 16) !== length) return null;
    return createHash("sha256").update(header).digest("hex");
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    process.noAsar = previousNoAsar;
  }
}

async function readPlistHash(resourcesPath: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("/usr/bin/plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      join(resourcesPath, "..", "Info.plist"),
    ]);
    const plist = decodePlistIntegrity(stdout);
    return Option.isSome(plist) ? plist.value.ElectronAsarIntegrity["Resources/app.asar"].hash : null;
  } catch {
    return null;
  }
}

async function showArchiveChanged(translate: AppTranslate): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    message: translate("startup.archiveChangedTitle"),
    detail: translate("startup.archiveChangedBody"),
    buttons: [translate("startup.archiveChangedDownload"), translate("common.close")],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) await shell.openExternal(DOWNLOAD_URL);
}

export function watchAppArchive(resourcesPath: string, translate: AppTranslate): () => void {
  if (process.platform !== "win32" && process.platform !== "darwin") return () => {};
  const archivePath = join(resourcesPath, "app.asar");
  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    watcher?.close();
  };

  const check = async (startHash: string) => {
    const current = readHeaderHash(archivePath);
    const expected = process.platform === "darwin" ? ((await readPlistHash(resourcesPath)) ?? startHash) : startHash;
    if (stopped || current === expected) return;
    stop();
    logger.error("app.asar changed while OpenBot runs; the next start fails the integrity check.");
    await showArchiveChanged(translate);
  };

  const startHash = readHeaderHash(archivePath);
  if (!startHash) {
    logger.warn("Could not read app.asar; changes to it are not watched.");
    return stop;
  }
  try {
    watcher = watch(resourcesPath, (_event, name) => {
      if (name && name !== "app.asar") return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        check(startHash).catch((error) => logger.warn("Could not check app.asar:", toLogValue(error)));
      }, SETTLE_MS);
    });
    watcher.on("error", (error) => {
      logger.warn("Stopped watching app.asar:", toLogValue(error));
      stop();
    });
  } catch (error) {
    logger.warn("Could not watch app.asar:", toLogValue(error));
  }
  return stop;
}
