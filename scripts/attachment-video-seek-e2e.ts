// Runs the real Electron with the attachment file response of `src/main/file-response.ts`:
// 1. A `Range` request gets 206 with the asked bytes: `bytes=100-199` and the suffix `bytes=-100`.
// 2. A range that starts after the end of the file gets 416.
// 3. A <video> loads an MP4 that has its index (`moov`) at the end, as Remotion and ffmpeg write it by
//    default, and seeks to 75% of its duration. Chromium needs a range request for both.
//
// Needs ffmpeg on PATH to make the video. Run: bun scripts/attachment-video-seek-e2e.ts
// It writes .openbot-build/attachment-video-seek-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "attachment-video-seek-e2e");
const electronPath = join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
);

if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
  process.stdout.write("SKIP: ffmpeg is not on PATH\n");
  process.exit(0);
}

interface RangeResult {
  range: string;
  status: number;
  contentRange: string | null;
  acceptRanges: string | null;
  length: number;
  head: number[];
}

interface Probe {
  error?: string;
  size: number;
  ranges: RangeResult[];
  duration: number;
  seekable: number;
  target: number;
  seeked: boolean;
  currentTime: number;
}

await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "openbot-video-seek-"));
let probe: Probe | undefined;
let passed = false;
let error: string | undefined;

try {
  const bundle = join(root, "attachment-video-seek-electron.mjs");
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", "attachment-video-seek-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);
  // No `-movflags +faststart`: the `moov` index stays after the media data.
  const video = join(root, "video.mp4");
  const encode = spawnSync("ffmpeg", [
    ...["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=20"],
    ...["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", video],
  ]);
  assert.equal(encode.status, 0, `ffmpeg failed: ${encode.stderr.toString()}`);
  const bytes = await readFile(video);
  assert.ok(bytes.indexOf("moov") > bytes.indexOf("mdat"), "the moov index is not at the end");
  const reportPath = join(root, "probe.json");
  const child = spawn(
    electronPath,
    [bundle, `--user-data=${join(root, "user-data")}`, `--video=${video}`, `--report=${reportPath}`],
    { env: withoutElectronRuntimeFlags(process.env), stdio: "inherit" },
  );
  const code = await new Promise<number | null>((done) => child.on("exit", done));
  assert.equal(code, 0, `Electron exited with ${code}`);
  const parsed: Probe = JSON.parse(await readFile(reportPath, "utf8"));
  probe = parsed;
  assert.equal(probe.error, undefined, probe.error);
  assert.equal(probe.size, bytes.length);
  const [middle, suffix, after] = probe.ranges;
  assert.deepEqual(
    middle,
    {
      range: "bytes=100-199",
      status: 206,
      contentRange: `bytes 100-199/${bytes.length}`,
      acceptRanges: "bytes",
      length: 100,
      head: [...bytes.subarray(100, 104)],
    },
    "bytes=100-199",
  );
  assert.deepEqual(
    suffix,
    {
      range: "bytes=-100",
      status: 206,
      contentRange: `bytes ${bytes.length - 100}-${bytes.length - 1}/${bytes.length}`,
      acceptRanges: "bytes",
      length: 100,
      head: [...bytes.subarray(bytes.length - 100, bytes.length - 96)],
    },
    "bytes=-100",
  );
  assert.equal(after?.status, 416, "a range after the end of the file");
  assert.equal(after?.contentRange, `bytes */${bytes.length}`);
  assert.ok(probe.seekable >= probe.target, `seekable to ${probe.seekable}s, not to ${probe.target}s`);
  assert.ok(probe.seeked, "the video did not finish the seek");
  assert.ok(Math.abs(probe.currentTime - probe.target) < 1, `the video is at ${probe.currentTime}s`);
  passed = true;
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
} finally {
  await rm(root, { recursive: true, force: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, probe, error }, null, 2)}\n`);
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}
