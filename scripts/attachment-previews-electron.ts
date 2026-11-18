// The Electron half of `attachment-previews-e2e.ts`. It makes real pictures with Electron's `nativeImage`,
// sends them through the real host preview service (`AttachmentPreviews` with `attachmentPreviewImage`,
// as `application-services.ts` builds it), and decodes each copy again to check it. Writes the report
// that the Bun half reads.
import assert from "node:assert/strict";
import { mkdir, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ATTACHMENT_PREVIEW_EDGES } from "@openbot/contracts/team-protocol/attachment-previews-v1";
import { Effect } from "effect";
import { app, type NativeImage, nativeImage } from "electron";
import { attachmentPreviewImage } from "../src/main/agent-image-fit";
import { type AttachmentPreviewFile, AttachmentPreviews } from "../src/main/attachment-previews";

const argument = (name: string) => {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};
const fixtureRoot = argument("fixture-root");
const reportPath = argument("report-path");
const runId = argument("run-id");

interface Case {
  name: string;
  detail: unknown;
}
const cases: Case[] = [];
const measurements: Record<string, number> = {};

void main().catch(async (error: unknown) => {
  await writeReport("failed", error instanceof Error ? error.message : String(error)).catch(() => undefined);
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  app.exit(1);
});

async function main(): Promise<void> {
  app.setPath("userData", join(fixtureRoot, "profile"));
  app.setPath("sessionData", join(fixtureRoot, "session"));
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  await app.whenReady();
  const files = join(fixtureRoot, "files");
  await mkdir(files, { recursive: true });

  let decodes = 0;
  const previews = new AttachmentPreviews({
    root: join(fixtureRoot, "profile", "attachment-previews"),
    make: (bytes, maxEdge) => {
      decodes += 1;
      return attachmentPreviewImage(bytes, maxEdge);
    },
  });
  const preview = (id: string, path: string, size: "small" | "large") =>
    Effect.runPromise(previews.preview({ id, path }, size));

  // A 12-megapixel photo, stored 4000 x 3000 with EXIF orientation 6: it shows 3000 x 4000, turned a
  // quarter to the right. Its stored top-left quarter is red, so the upright copy is red at top right.
  const photoPath = join(files, "photo.jpg");
  const photo = withExifOrientation(quarterPicture(4000, 3000, [0, 0, 255, 255], [255, 255, 255, 255]).toJPEG(92), 6);
  await writeFile(photoPath, photo);
  const started = performance.now();
  const small = await preview("photo", photoPath, "small");
  measurements.smallDecodeMs = Math.round(performance.now() - started);
  const smallImage = decoded(small, "image/jpeg");
  assert.deepEqual(smallImage.getSize(), { width: 576, height: 768 });
  assert.ok(small !== null && small.bytes.byteLength < photo.byteLength / 4, "The small copy is not small.");
  assert.ok(!Buffer.from(small.bytes).includes("Exif"), "The copy keeps EXIF data.");
  assert.ok(isRed(pixel(smallImage, 432, 192)), "The upright copy is not red at its top right.");
  assert.ok(!isRed(pixel(smallImage, 144, 192)), "The upright copy is red at its top left.");
  assert.ok(!isRed(pixel(smallImage, 432, 576)), "The upright copy is red at its bottom right.");
  measurements.photoBytes = photo.byteLength;
  measurements.smallBytes = small.bytes.byteLength;
  cases.push({
    name: "a 12 MP JPEG with EXIF orientation 6 gives an upright 576 x 768 JPEG with no EXIF data, under a quarter of the bytes",
    detail: { size: smallImage.getSize(), bytes: small.bytes.byteLength, original: photo.byteLength },
  });

  const large = await preview("photo", photoPath, "large");
  const largeImage = decoded(large, "image/jpeg");
  assert.deepEqual(largeImage.getSize(), { width: 1536, height: 2048 });
  assert.ok(large !== null && large.bytes.byteLength < photo.byteLength);
  measurements.largeBytes = large.bytes.byteLength;
  cases.push({ name: "the large copy of the photo is 1536 x 2048", detail: largeImage.getSize() });

  const decodesBefore = decodes;
  const smallAgain = await preview("photo", photoPath, "small");
  assert.equal(decodes, decodesBefore, "The second request decoded the photo again.");
  assert.ok(smallAgain !== null && Buffer.from(smallAgain.bytes).equals(Buffer.from(small.bytes)));
  cases.push({ name: "the same copy again comes from the cache on disk, with no decode", detail: { decodes } });

  const later = new Date(Date.now() + 60_000);
  await utimes(photoPath, later, later);
  await preview("photo", photoPath, "small");
  assert.equal(decodes, decodesBefore + 1, "A changed file got the copy of the old file.");
  cases.push({ name: "a file with a new change time gets a new copy, not the saved one", detail: { decodes } });

  const transparentPath = join(files, "transparent.png");
  await writeFile(transparentPath, quarterPicture(1000, 500, [0, 0, 0, 0], [0, 128, 0, 255]).toPNG());
  const transparent = await preview("transparent", transparentPath, "small");
  const transparentImage = decoded(transparent, "image/png");
  assert.deepEqual(transparentImage.getSize(), { width: 768, height: 384 });
  assert.equal(pixel(transparentImage, 10, 10)[3], 0, "The transparent quarter lost its alpha.");
  cases.push({
    name: "a PNG with transparency gives a 768 x 384 PNG that keeps it",
    detail: transparentImage.getSize(),
  });

  const opaquePath = join(files, "opaque.png");
  await writeFile(opaquePath, quarterPicture(900, 600, [0, 0, 255, 255], [0, 128, 0, 255]).toPNG());
  const opaque = await preview("opaque", opaquePath, "small");
  const opaqueImage = decoded(opaque, "image/jpeg");
  assert.deepEqual(opaqueImage.getSize(), { width: 768, height: 512 });
  cases.push({ name: "an opaque PNG gives a 768 x 512 JPEG", detail: opaqueImage.getSize() });

  const tinyPath = join(files, "tiny.jpg");
  await writeFile(tinyPath, quarterPicture(300, 200, [0, 0, 255, 255], [255, 255, 255, 255]).toJPEG(92));
  const tiny = await preview("tiny", tinyPath, "small");
  assert.deepEqual(decoded(tiny, "image/jpeg").getSize(), { width: 300, height: 200 });
  cases.push({ name: "a picture within the size comes back as a new JPEG of the same size", detail: null });

  const textPath = join(files, "notes.txt");
  await writeFile(textPath, "not a picture\n");
  const hugePath = join(files, "huge.png");
  await writeFile(hugePath, pngHeader(20_000, 20_000));
  const damagedPath = join(files, "damaged.jpg");
  await writeFile(damagedPath, Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(512, 7)]));
  const refused = await Promise.all([
    preview("text", textPath, "small"),
    preview("huge", hugePath, "small"),
    preview("damaged", damagedPath, "small"),
  ]);
  assert.deepEqual(refused, [null, null, null]);
  cases.push({
    name: "a text file, a PNG that says it has 400 million pixels and a damaged JPEG give no copy",
    detail: refused,
  });

  // A folder that cannot be made: the copy still comes, from memory.
  const blocked = join(fixtureRoot, "blocked");
  await writeFile(blocked, "a file where the folder must be");
  const uncached = new AttachmentPreviews({ root: join(blocked, "previews"), make: attachmentPreviewImage });
  const fromMemory = await Effect.runPromise(uncached.preview({ id: "photo", path: photoPath }, "small"));
  assert.deepEqual(decoded(fromMemory, "image/jpeg").getSize(), { width: 576, height: 768 });
  cases.push({ name: "a cache folder that cannot be written still gives the copy", detail: null });

  // A budget of about two copies: the oldest copies go, and the newest stays.
  const trimRoot = join(fixtureRoot, "trim");
  const trimmed = new AttachmentPreviews({
    root: trimRoot,
    make: attachmentPreviewImage,
    budgetBytes: small.bytes.byteLength * 2 + 1024,
  });
  for (let index = 0; index < 4; index += 1) {
    await Effect.runPromise(trimmed.preview({ id: `photo-${index}`, path: photoPath }, "small"));
    // Each copy is older than the next one, so the order does not depend on the clock resolution.
    const names = await readdir(trimRoot);
    for (const name of names) {
      const old = new Date(Date.now() - (index + 1) * 60_000);
      await utimes(join(trimRoot, name), old, old);
    }
  }
  const kept = await readdir(trimRoot);
  const keptBytes = (await Promise.all(kept.map((name) => stat(join(trimRoot, name))))).reduce(
    (total, file) => total + file.size,
    0,
  );
  assert.ok(keptBytes <= small.bytes.byteLength * 2 + 1024, "The cache is over its budget.");
  assert.ok(kept.length >= 1 && kept.length < 4, "The trim deleted no copy or every copy.");
  cases.push({ name: "the cache deletes the oldest copies to stay within its budget", detail: { kept, keptBytes } });

  await writeReport("passed", null);
  app.exit(0);
}

/** A picture whose top-left quarter has one colour and the rest another. Colours are BGRA. */
function quarterPicture(
  width: number,
  height: number,
  corner: readonly [number, number, number, number],
  rest: readonly [number, number, number, number],
): NativeImage {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colour = x < width / 2 && y < height / 2 ? corner : rest;
      bitmap.set(colour, (y * width + x) * 4);
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height });
}

/** The JPEG with an EXIF segment that holds only the orientation tag, after its start marker. */
function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.from([
    ...[0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08],
    ...[0x00, 0x01],
    ...[0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00],
    ...[0x00, 0x00, 0x00, 0x00],
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, payload.length + 2]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/** A PNG signature and header that say the size, with no image data. */
function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function decoded(file: AttachmentPreviewFile | null, mimeType: AttachmentPreviewFile["mimeType"]): NativeImage {
  assert.ok(file, "No copy was made.");
  assert.equal(file.mimeType, mimeType);
  const image = nativeImage.createFromBuffer(Buffer.from(file.bytes));
  assert.ok(!image.isEmpty(), "The copy does not decode.");
  const { width, height } = image.getSize();
  const edge = Math.max(width, height);
  assert.ok(edge <= ATTACHMENT_PREVIEW_EDGES.large, `The copy is ${edge} px on its long side.`);
  return image;
}

/** The BGRA bytes of one pixel. */
function pixel(image: NativeImage, x: number, y: number): number[] {
  const { width } = image.getSize();
  const at = (y * width + x) * 4;
  return [...image.toBitmap().subarray(at, at + 4)];
}

function isRed([blue = 0, green = 0, red = 0]: number[]): boolean {
  return red > 200 && green < 60 && blue < 60;
}

async function writeReport(status: "passed" | "failed", reason: string | null): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  const report = { status, runId, reason, cases: cases.map((entry) => entry.name), details: cases, measurements };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
