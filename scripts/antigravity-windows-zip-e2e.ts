// Run: bun scripts/antigravity-windows-zip-e2e.ts [--archive <agy_cli_windows_x64.zip>]
// Report: .openbot-build/antigravity-windows-zip-e2e.json
// Stages the locked Antigravity CLI Windows zip with the real provider descriptor. The zip stores
// `antigravity.exe` with Unix mode 0600 and no type bits, which OpenBot 0.67.0 refused as a special
// file. A copy of the same zip with a link type must still be refused.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Exit } from "effect";
import lockValue from "../native-runtime.lock.json";
import { providerRuntimeDescriptor } from "../src/main/provider-runtime-descriptors";
import { parseAgentRuntimeLock } from "./agent-runtime-lock";

const REPORT = join(".openbot-build", "antigravity-windows-zip-e2e.json");
const ZIP_END = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const UNIX_LINK = 0o120777;

const lock = parseAgentRuntimeLock(lockValue);
const descriptor = providerRuntimeDescriptor("antigravity");
const spec = descriptor.spec("win32-x64", lock);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function lockedArchive(): Promise<Buffer> {
  const flag = process.argv.indexOf("--archive");
  const path = flag >= 0 ? process.argv[flag + 1] : undefined;
  const bytes = path
    ? await readFile(path)
    : Buffer.from(await (await fetch(spec.url, { redirect: "follow" })).arrayBuffer());
  assert.equal(sha256(bytes), spec.archiveDigest?.hex, "the archive is not the locked asset");
  return bytes;
}

/** The Unix mode of each central directory entry, and where its external attributes are. */
function centralEntries(zip: Buffer): { name: string; unixMode: number; attributesAt: number }[] {
  let end = -1;
  for (let index = zip.length - 22; index >= 0; index -= 1) {
    if (zip.readUInt32LE(index) === ZIP_END) {
      end = index;
      break;
    }
  }
  assert.ok(end >= 0, "the zip has no end record");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(zip.readUInt32LE(offset), ZIP_CENTRAL);
    const nameBytes = zip.readUInt16LE(offset + 28);
    entries.push({
      name: zip.toString("utf8", offset + 46, offset + 46 + nameBytes),
      unixMode: zip.readUInt32LE(offset + 38) >>> 16,
      attributesAt: offset + 38,
    });
    offset += 46 + nameBytes + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  return entries;
}

async function stage(archive: string, staging: string) {
  await mkdir(staging, { recursive: true });
  return Effect.runPromiseExit(
    descriptor
      .stage({
        spec,
        downloadedPath: archive,
        staging,
        lock,
        downloadSmallFile: () => Effect.die(new Error("Antigravity downloads no other file")),
      })
      .pipe(Effect.andThen(descriptor.verify(staging, spec, lock))),
  );
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-zip-"));
try {
  const zip = await lockedArchive();
  const entries = centralEntries(zip);
  assert.deepEqual(
    entries.map(({ name }) => name),
    [spec.executableName],
  );
  const [entry] = entries;
  assert.ok(entry);
  assert.equal(entry.unixMode & 0o170000, 0, "the locked zip now stores a type; this test no longer covers it");

  const archive = join(root, "agy_cli_windows_x64.zip");
  await writeFile(archive, zip);
  const staged = await stage(archive, join(root, "staged"));
  assert.ok(Exit.isSuccess(staged), `the locked zip did not stage: ${String(staged)}`);
  const installed = sha256(await readFile(join(root, "staged", "bin", spec.executableName)));

  const linked = Buffer.from(zip);
  linked.writeUInt32LE(
    ((UNIX_LINK << 16) | (linked.readUInt32LE(entry.attributesAt) & 0xffff)) >>> 0,
    entry.attributesAt,
  );
  const linkedArchive = join(root, "linked.zip");
  await writeFile(linkedArchive, linked);
  const refused = await stage(linkedArchive, join(root, "linked"));
  assert.ok(Exit.isFailure(refused), "a zip entry with a link type staged");
  assert.ok(String(refused).includes(sourceText("error.provider.archiveSpecialFile")), String(refused));

  const report = {
    version: spec.version,
    asset: spec.url,
    entryMode: `0${entry.unixMode.toString(8)}`,
    staged: true,
    installedSha256: installed,
    linkTypeRefused: true,
  };
  await mkdir(".openbot-build", { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
