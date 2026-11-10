// Run: bun scripts/antigravity-windows-zip-e2e.ts [--archive <agy_cli_windows_x64.zip>]
// Report: .openbot-build/antigravity-windows-zip-e2e.json
// Stages zips through the real Antigravity provider descriptor for Windows. The Antigravity CLI 1.5.x
// Windows zip stores `antigravity.exe` with Unix mode 0600 and no type bits, which OpenBot 0.67.0
// refused as a special file. A zip entry with a link type must still be refused. With `--archive`, the
// locked zip (from the lock's win32-x64 URL) also stages and passes the lock hashes.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit } from "effect";
import lockValue from "../native-runtime.lock.json";
import { providerRuntimeDescriptor } from "../src/main/provider-runtime-descriptors";
import { parseAgentRuntimeLock } from "./agent-runtime-lock";

const REPORT = join(".openbot-build", "antigravity-windows-zip-e2e.json");
const ZIP_LOCAL = 0x04034b50;
const ZIP_END = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_HOST_UNIX = 3;
const UNIX_LINK = 0o120777;

const lock = parseAgentRuntimeLock(lockValue);
const descriptor = providerRuntimeDescriptor("antigravity");
const spec = descriptor.spec("win32-x64", lock);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A zip from a Unix host with one stored entry, as the Antigravity CLI Windows zip is made. */
function unixZip(name: string, data: Buffer, unixMode: number): Buffer {
  const nameBytes = Buffer.from(name, "utf8");
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(ZIP_LOCAL, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(ZIP_CENTRAL, 0);
  central.writeUInt16LE((ZIP_HOST_UNIX << 8) | 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE((unixMode << 16) >>> 0, 38);
  const directoryOffset = local.length + nameBytes.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(directoryOffset, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

/** The Unix mode of the first central directory entry. */
function firstEntryMode(zip: Buffer): number {
  let end = -1;
  for (let index = zip.length - 22; index >= 0; index -= 1) {
    if (zip.readUInt32LE(index) === ZIP_END) {
      end = index;
      break;
    }
  }
  assert.ok(end >= 0, "the zip has no end record");
  const offset = zip.readUInt32LE(end + 16);
  assert.equal(zip.readUInt32LE(offset), ZIP_CENTRAL);
  return zip.readUInt32LE(offset + 38) >>> 16;
}

function stage(archive: string, staging: string, verify: boolean) {
  const staged = Effect.promise(() => mkdir(staging, { recursive: true })).pipe(
    Effect.andThen(
      descriptor.stage({
        spec,
        downloadedPath: archive,
        staging,
        lock,
        downloadSmallFile: () => Effect.die(new Error("Antigravity downloads no other file")),
      }),
    ),
  );
  return Effect.runPromiseExit(verify ? staged.pipe(Effect.andThen(descriptor.verify(staging, spec, lock))) : staged);
}

const flag = process.argv.indexOf("--archive");
const lockedPath = flag >= 0 ? process.argv[flag + 1] : undefined;
if (flag >= 0) assert.ok(lockedPath, "--archive needs the path of the zip");

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-zip-"));
try {
  const program = Buffer.from("antigravity.exe from a zip with no Unix type\n");
  const typeless = join(root, "typeless.zip");
  await writeFile(typeless, unixZip(spec.executableName, program, 0o600));
  const staged = await stage(typeless, join(root, "staged"), false);
  assert.ok(Exit.isSuccess(staged), `a zip entry with mode 0600 did not stage: ${String(staged)}`);
  assert.deepEqual(await readFile(join(root, "staged", "bin", spec.executableName)), program);

  const linked = join(root, "linked.zip");
  await writeFile(linked, unixZip(spec.executableName, Buffer.from("target"), UNIX_LINK));
  const refused = await stage(linked, join(root, "linked"), false);
  assert.ok(Exit.isFailure(refused), "a zip entry with a link type staged");
  assert.ok(String(refused).includes(sourceText("error.provider.archiveSpecialFile")), String(refused));

  // The locked zip is 70 MB, so CI runs only the cases above. A local run can add it.
  let locked: { version: string; entryMode: string; installedSha256: string } | null = null;
  if (lockedPath) {
    const bytes = await readFile(lockedPath);
    assert.equal(sha256(bytes), spec.archiveDigest?.hex, "the archive is not the locked asset");
    const result = await stage(lockedPath, join(root, "locked"), true);
    assert.ok(Exit.isSuccess(result), `the locked zip did not stage: ${String(result)}`);
    locked = {
      version: spec.version,
      entryMode: `0${firstEntryMode(bytes).toString(8)}`,
      installedSha256: sha256(await readFile(join(root, "locked", "bin", spec.executableName))),
    };
  }

  const report = { typelessEntryStaged: true, linkTypeRefused: true, locked };
  await mkdir(".openbot-build", { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
