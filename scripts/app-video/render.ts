// Renders the app video: the real OpenBot app, in its browser preview, in a scripted session.
// The page in ./page draws each frame; this script steps a fake clock one frame at a time in
// headless Chrome, plays the page's mouse and key input, takes one screenshot per frame, and
// encodes them with the song into .openbot-build/app-video/.
//
//   bun run video:app                    1920x1080, 60 fps
//   bun run video:app --draft            960x540, 30 fps, fast encode
//   bun run video:app --still=4,12.5     one PNG per time, into stills/
//   bun run video:app --from=10 --to=15  a part of the video
//
// Each run plays the session from 0, because the app's state depends on every earlier frame.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createOpenBotLogger } from "@openbot/logging";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { chromium, type Page } from "playwright-core";
import { createServer } from "vite";
import { z } from "zod";
import { APP_CLOCK_START, DURATION, FPS, type FrameInput, STAGE } from "./cues";
import { MUSIC } from "./music";

const logger = createOpenBotLogger("app-video");
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const out = resolve(repoRoot, ".openbot-build/app-video");
const musicDirectory = resolve(out, "music");

const { values } = parseArgs({
  options: {
    draft: { type: "boolean", default: false },
    still: { type: "string", multiple: true },
    from: { type: "string" },
    to: { type: "string" },
  },
});

const draft = values.draft;
const fps = draft ? 30 : FPS;
const from = seconds(values.from, 0);
const to = seconds(values.to, DURATION);
if (to <= from) throw new Error(`--to (${to}) must be after --from (${from}).`);
const stills = (values.still ?? []).flatMap((value) => value.split(",")).map((value) => seconds(value, 0));

function seconds(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > DURATION) {
    throw new Error(`"${value}" is not a time from 0 to ${DURATION} seconds.`);
  }
  return parsed;
}

/** Runs a command and returns its output. ffmpeg writes its reports to stderr. */
function run(command: string, args: string[], input?: (stdin: NodeJS.WritableStream) => Promise<void>) {
  return new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}:\n${stderr.slice(-2000)}`));
    });
    if (!input) {
      child.stdin.end();
      return;
    }
    input(child.stdin).then(
      () => child.stdin.end(),
      (error: unknown) => {
        child.kill();
        reject(error);
      },
    );
  });
}

function write(stream: NodeJS.WritableStream, chunk: Buffer): Promise<void> {
  return new Promise((resolvePromise) => {
    if (stream.write(chunk)) resolvePromise();
    else stream.once("drain", () => resolvePromise());
  });
}

const LOUDNESS_TARGET = "I=-14:TP=-1.5:LRA=11";
const loudnessSchema = z.object({
  input_i: z.string(),
  input_tp: z.string(),
  input_lra: z.string(),
  input_thresh: z.string(),
  output_i: z.string(),
  output_tp: z.string(),
  target_offset: z.string(),
});

const probeSchema = z.object({ format: z.object({ duration: z.string() }) });

/** The JSON that ffmpeg's loudnorm prints last. */
function parseLoudness(stderr: string) {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("ffmpeg loudnorm printed no measurement.");
  return loudnessSchema.parse(JSON.parse(stderr.slice(start, end + 1)));
}

/** The song from the cache, or from its source on the first run. The hash must match. */
async function song(): Promise<string> {
  const file = resolve(musicDirectory, MUSIC.file);
  const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
  if (existsSync(file) && sha256(readFileSync(file)) === MUSIC.sha256) return file;
  logger.info(`Downloading "${MUSIC.title}" from ${MUSIC.download}.`);
  const response = await fetch(MUSIC.download);
  if (!response.ok) throw new Error(`The song download failed with HTTP ${response.status}.`);
  const data = new Uint8Array(await response.arrayBuffer());
  const hash = sha256(data);
  if (hash !== MUSIC.sha256) throw new Error(`The song has sha256 ${hash}, not ${MUSIC.sha256}.`);
  mkdirSync(musicDirectory, { recursive: true });
  writeFileSync(file, data);
  return file;
}

/** Plays one frame's input. The mouse moves first, so a click lands where the cursor is drawn. */
async function play(page: Page, input: FrameInput, mouse: { x: number; y: number } | null) {
  if (input.mouse && (input.mouse.x !== mouse?.x || input.mouse.y !== mouse?.y)) {
    await page.mouse.move(input.mouse.x, input.mouse.y);
  }
  if (input.down) await page.mouse.down();
  if (input.up) await page.mouse.up();
  if (input.type) await page.keyboard.type(input.type);
  for (const key of input.press) await page.keyboard.press(key);
  return input.mouse ?? mouse;
}

const songFile = stills.length > 0 ? undefined : await song();

const server = await createServer({
  configFile: false,
  root: resolve(here, "page"),
  logLevel: "warn",
  plugins: [solidPlugin(), tailwindcss({ optimize: false })],
  resolve: { dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
  optimizeDeps: { include: ["@norbert_bodziony/bloub"] },
  // A reload during a render would break the frames.
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { allow: [repoRoot] } },
});
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error("The Vite server has no local URL.");

const started = Date.now();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: STAGE,
    // The draft keeps the layout and halves the pixels.
    deviceScaleFactor: draft ? 0.5 : 1,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "no-preference",
  });
  // The clock runs in real time while the app loads, then stops at t = 0 of the video.
  await context.clock.install({ time: APP_CLOCK_START - 120_000 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} ${message.location().url}`.trim());
  });
  await page.goto(`${url}index.html`);
  await page.waitForFunction(() => window.appVideo !== undefined);
  await page.evaluate(() => window.appVideo.ready);
  await page.clock.pauseAt(APP_CLOCK_START);
  if (errors.length > 0) throw new Error(`The page failed to load:\n${errors.join("\n")}`);

  const step = 1000 / fps;
  const last = stills.length > 0 ? Math.max(...stills) : to;
  const frames = Math.floor(last * fps + 1e-6) + 1;
  let mouse: { x: number; y: number } | null = null;

  /** Plays the session up to frame `count - 1`, and gives each frame to `capture`. */
  async function playFrames(count: number, capture: (index: number, t: number) => Promise<void>) {
    for (let index = 0; index < count; index += 1) {
      const t = index / fps;
      if (index > 0) await page.clock.runFor(step);
      const input = await page.evaluate((time) => window.appVideo.frame(time), t);
      mouse = await play(page, input, mouse);
      await capture(index, t);
      if (index % fps === 0) logger.info(`Frame ${index} of ${count}.`);
    }
    if (errors.length > 0) throw new Error(`The page failed while rendering:\n${errors.join("\n")}`);
  }

  if (stills.length > 0) {
    mkdirSync(resolve(out, "stills"), { recursive: true });
    const wanted = new Map(stills.map((t) => [Math.round(t * fps), t]));
    await playFrames(frames, async (index) => {
      const t = wanted.get(index);
      if (t === undefined) return;
      const file = resolve(out, "stills", `still-${t.toFixed(2)}.png`);
      await page.screenshot({ path: file, type: "png" });
      logger.info(`Wrote ${relative(repoRoot, file)}.`);
    });
  } else {
    mkdirSync(out, { recursive: true });
    const name = draft ? "app-video-draft" : "app-video";
    const silent = resolve(out, `${name}.video.mp4`);
    const output = resolve(out, `${name}.mp4`);
    const first = Math.round(from * fps);
    const length = (frames - first) / fps;

    await run(
      "ffmpeg",
      [
        ...["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-"],
        ...["-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", draft ? "22" : "14"],
        ...["-pix_fmt", "yuv420p", "-r", String(fps), silent],
      ],
      (stdin) =>
        playFrames(frames, async (index) => {
          if (index >= first) await write(stdin, await page.screenshot({ type: "png" }));
        }),
    );

    // The song starts at its drop, with a click-free start and a short fade out.
    const sound = ["-ss", String(MUSIC.start + from), "-t", String(length), "-i", songFile ?? ""];
    const fades = `afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, length - 0.6)}:d=0.6,`;
    const measured = parseLoudness(
      (
        await run("ffmpeg", [
          ...["-hide_banner", "-nostats", ...sound],
          ...["-af", `${fades}loudnorm=${LOUDNESS_TARGET}:print_format=json`, "-f", "null", "-"],
        ])
      ).stderr,
    );
    const normalize = [
      `loudnorm=${LOUDNESS_TARGET}`,
      `measured_I=${measured.input_i}`,
      `measured_TP=${measured.input_tp}`,
      `measured_LRA=${measured.input_lra}`,
      `measured_thresh=${measured.input_thresh}`,
      `offset=${measured.target_offset}`,
      "linear=true:print_format=json",
    ].join(":");
    const mixed = parseLoudness(
      (
        await run("ffmpeg", [
          ...["-y", "-hide_banner", "-nostats", "-i", silent, ...sound],
          ...["-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", `${fades}${normalize},aresample=48000`],
          ...["-c:a", "aac", "-b:a", "256k", "-t", String(length), "-movflags", "+faststart", output],
        ])
      ).stderr,
    );
    rmSync(silent);

    const sheet = resolve(out, `${name}.contact-sheet.png`);
    await run("ffmpeg", [
      ...["-y", "-loglevel", "error", "-i", output],
      ...["-vf", `fps=1,scale=480:-1,tile=6x${Math.ceil(length / 6)}`, "-frames:v", "1", sheet],
    ]);

    const probe = (
      await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size", "-of", "json", output])
    ).stdout;
    const { format } = probeSchema.parse(JSON.parse(probe));
    const report = {
      file: relative(repoRoot, output),
      contactSheet: relative(repoRoot, sheet),
      range: { from, to: frames / fps },
      fps,
      frames: frames - first,
      size: draft ? { width: STAGE.width / 2, height: STAGE.height / 2 } : STAGE,
      loudness: { integratedLufs: Number(mixed.output_i), truePeakDbtp: Number(mixed.output_tp) },
      credits: {
        title: MUSIC.title,
        artist: MUSIC.artist,
        source: MUSIC.source,
        licence: MUSIC.licence,
        licenceUrl: MUSIC.licenceUrl,
        credit: MUSIC.credit,
      },
      durationSeconds: Number(format.duration),
      renderSeconds: Math.round((Date.now() - started) / 1000),
    };
    writeFileSync(resolve(out, `${name}.report.json`), `${JSON.stringify(report, null, 2)}\n`);
    logger.info(`Wrote ${report.file} (${report.durationSeconds.toFixed(2)} s) in ${report.renderSeconds} s.`);
  }
} finally {
  await browser.close();
  await server.close();
}
