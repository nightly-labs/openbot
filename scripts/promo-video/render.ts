// Renders a promo video. The composition in ./composition draws any frame on request; this
// script opens it in headless Chrome, takes one screenshot per frame, pipes them to ffmpeg, and
// muxes the soundtrack: the one that the page synthesizes, or the video's song.
//
//   bun run promo:render               1920x1080, 60 fps, into .openbot-build/promo-video/
//   bun run promo:render --video=team  the team video; the first run downloads its song
//   bun run promo:render --draft       960x540, 30 fps, fast encode
//   bun run promo:render --still=1.05,3  one PNG per time, into stills/
//   bun run promo:render --from=12 --to=15
//   bun run promo:render --serve       serve the page; open it with ?play to watch with sound

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createOpenBotLogger } from "@openbot/logging";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { z } from "zod";
import type { Music } from "./composition/music";
import { FPS, STAGE_HEIGHT, STAGE_WIDTH } from "./composition/timeline";
import { VIDEOS } from "./composition/videos";

const logger = createOpenBotLogger("promo-video");
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const out = resolve(repoRoot, ".openbot-build/promo-video");
const musicDirectory = resolve(out, "music");

const { values } = parseArgs({
  options: {
    draft: { type: "boolean", default: false },
    still: { type: "string", multiple: true },
    from: { type: "string" },
    to: { type: "string" },
    serve: { type: "boolean", default: false },
    video: { type: "string", default: "promo" },
  },
});

const videoName = z.enum(["promo", "team", "everywhere"]).parse(values.video);
const video = VIDEOS[videoName];
const duration = video.duration;

const draft = values.draft;
const fps = draft ? 30 : FPS;
const width = draft ? STAGE_WIDTH / 2 : STAGE_WIDTH;
const height = draft ? STAGE_HEIGHT / 2 : STAGE_HEIGHT;
const from = seconds(values.from, 0);
const to = seconds(values.to, duration);
if (to <= from) throw new Error(`--to (${to}) must be after --from (${from}).`);

function seconds(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > duration) {
    throw new Error(`"${value}" is not a time from 0 to ${duration} seconds.`);
  }
  return parsed;
}

/** Runs ffmpeg or ffprobe and returns its stderr, where ffmpeg writes its reports. */
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

const Loudness = z.object({
  input_i: z.string(),
  input_tp: z.string(),
  input_lra: z.string(),
  input_thresh: z.string(),
  output_i: z.string(),
  output_tp: z.string(),
  target_offset: z.string(),
});

const Probe = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      r_frame_rate: z.string().optional(),
      nb_frames: z.string().optional(),
      sample_rate: z.string().optional(),
      channels: z.number().optional(),
    }),
  ),
  format: z.object({ duration: z.string(), size: z.string() }),
});

const LOUDNESS_TARGET = "I=-14:TP=-1.5:LRA=11";

function parseLoudness(stderr: string): z.infer<typeof Loudness> {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("ffmpeg loudnorm printed no measurement.");
  return Loudness.parse(JSON.parse(stderr.slice(start, end + 1)));
}

/** The song from the cache, or from its source on the first run. The hash must match. */
async function song(music: Music): Promise<string> {
  const file = resolve(musicDirectory, music.file);
  const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
  if (existsSync(file) && sha256(readFileSync(file)) === music.sha256) return file;
  logger.info(`Downloading "${music.title}" from ${music.download}.`);
  const response = await fetch(music.download);
  if (!response.ok) throw new Error(`The song download failed with HTTP ${response.status}.`);
  const data = new Uint8Array(await response.arrayBuffer());
  const hash = sha256(data);
  if (hash !== music.sha256) throw new Error(`The song has sha256 ${hash}, not ${music.sha256}.`);
  mkdirSync(musicDirectory, { recursive: true });
  writeFileSync(file, data);
  return file;
}

const songFile = video.audio === "synth" ? undefined : await song(video.audio);

const server = await createServer({
  configFile: false,
  root: resolve(here, "composition"),
  // The `?play` player of a video with a song fetches it from here.
  publicDir: musicDirectory,
  logLevel: "warn",
  // A reload during a render would break the frames, so only --serve watches the files.
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [repoRoot] },
    ...(values.serve ? {} : { hmr: false, watch: null }),
  },
});
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error("The Vite server has no local URL.");

if (values.serve) {
  logger.info(`Serving the composition at ${url}${video.page}?play. Press Ctrl+C to stop.`);
} else {
  const started = Date.now();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${message.text()} ${message.location().url}`.trim());
    });
    await page.goto(`${url}${video.page}`);
    await page.evaluate(() => window.promo.ready);
    if (errors.length > 0) throw new Error(`The composition failed to load:\n${errors.join("\n")}`);

    const stills = (values.still ?? []).flatMap((value) => value.split(","));
    if (stills.length > 0) {
      mkdirSync(resolve(out, "stills"), { recursive: true });
      for (const still of stills) {
        const t = seconds(still, 0);
        await page.evaluate((time) => window.promo.seek(time), t);
        const file = resolve(out, "stills", `${videoName === "promo" ? "" : `${videoName}-`}still-${t.toFixed(2)}.png`);
        await page.screenshot({ path: file, type: "png" });
        logger.info(`Wrote ${relative(repoRoot, file)}.`);
      }
    } else {
      mkdirSync(out, { recursive: true });
      const name = draft ? `${video.name}-draft` : video.name;
      const silent = resolve(out, `${name}.video.mp4`);
      const wav = resolve(out, `${name}.wav`);
      const output = resolve(out, `${name}.mp4`);
      const first = Math.round(from * fps);
      const frames = Math.round(to * fps) - first;

      await run(
        "ffmpeg",
        [
          ...["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-"],
          ...["-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", draft ? "22" : "14"],
          ...["-pix_fmt", "yuv420p", "-r", String(fps), silent],
        ],
        async (stdin) => {
          for (let frame = 0; frame < frames; frame += 1) {
            await page.evaluate((time) => window.promo.seek(time), (first + frame) / fps);
            await write(stdin, await page.screenshot({ type: "png" }));
            if (frame % fps === 0) logger.info(`Frame ${frame} of ${frames}.`);
          }
        },
      );
      if (errors.length > 0) throw new Error(`The composition failed while rendering:\n${errors.join("\n")}`);

      const length = to - from;
      let sound: string[];
      // The song is cut at the video's first beat, with a click-free start and a short fade out.
      let fades = "";
      if (songFile && video.audio !== "synth") {
        sound = ["-ss", String(video.audio.start + from), "-t", String(length), "-i", songFile];
        fades = `afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, length - 0.5)}:d=0.5,`;
      } else {
        logger.info("Synthesizing the soundtrack.");
        const base64 = await page.evaluate(() => window.promo.renderAudio?.());
        if (!base64) throw new Error("The page has no soundtrack to render.");
        writeFileSync(wav, Buffer.from(base64, "base64"));
        sound = ["-ss", String(from), "-t", String(length), "-i", wav];
      }
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
        ...["-vf", `fps=2,scale=480:-1,tile=6x${Math.ceil((length * 2) / 6)}`, "-frames:v", "1", sheet],
      ]);

      const probe = Probe.parse(
        JSON.parse(
          (await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output])).stdout,
        ),
      );
      const videoStream = probe.streams.find((stream) => stream.codec_type === "video");
      const audioStream = probe.streams.find((stream) => stream.codec_type === "audio");
      const report = {
        file: relative(repoRoot, output),
        contactSheet: relative(repoRoot, sheet),
        range: { from, to },
        video: {
          codec: videoStream?.codec_name,
          width: videoStream?.width,
          height: videoStream?.height,
          frameRate: videoStream?.r_frame_rate,
          frames: Number(videoStream?.nb_frames),
        },
        audio: audioStream
          ? {
              codec: audioStream.codec_name,
              sampleRate: Number(audioStream.sample_rate),
              channels: audioStream.channels,
            }
          : null,
        loudness: { integratedLufs: Number(mixed.output_i), truePeakDbtp: Number(mixed.output_tp) },
        credits:
          video.audio === "synth"
            ? null
            : {
                title: video.audio.title,
                artist: video.audio.artist,
                source: video.audio.source,
                licence: video.audio.licence,
                licenceUrl: video.audio.licenceUrl,
                credit: video.audio.credit,
                songStartSeconds: video.audio.start + from,
              },
        durationSeconds: Number(probe.format.duration),
        bytes: Number(probe.format.size),
        renderSeconds: Math.round((Date.now() - started) / 1000),
      };
      writeFileSync(resolve(out, `${name}.report.json`), `${JSON.stringify(report, null, 2)}\n`);
      logger.info(`Wrote ${report.file} (${report.durationSeconds.toFixed(2)} s) in ${report.renderSeconds} s.`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}
