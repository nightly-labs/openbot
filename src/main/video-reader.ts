import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { VOICE_AUDIO_LIMITS } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Option, Schema, Semaphore } from "effect";
import { BrowserWindow, session as electronSession, type Session } from "electron";
import {
  type VideoReaderHost,
  VideoReadFailed,
  type VideoReading,
  type VideoReadRequest,
} from "../backend/agent/video-reader";
import { agentLaunchPath } from "../backend/cli";
import { runCauseEffect } from "../backend/effect-boundary";
import { fileResponse } from "./file-response";
import { downloadArchive } from "./onepassword-cli-installer";
import type { RuntimeTarget } from "./provider-runtime-descriptors";

/**
 * Reads an online video for the `read_video` agent tool.
 *
 * yt-dlp downloads the video to a new temporary folder. A window that is never shown decodes it:
 * Chromium takes the frames and the sound, and the user's voice model transcribes the sound. The
 * window has its own session in memory and can load only the files of this one call. The folder is
 * deleted when the call ends, also when it fails or the agent stops it.
 */

const logger = createOpenBotLogger("video-reader");
const execFileAsync = promisify(execFile);

/**
 * The yt-dlp release that OpenBot installs. Each file's SHA-256 is pinned from the release's own
 * `SHA2-256SUMS`; a new release is a code change.
 */
const YT_DLP_VERSION = "2026.10.26";
const YT_DLP_RELEASES: Record<RuntimeTarget, { name: string; sha256: string }> = {
  // One universal binary for both Mac architectures.
  "darwin-arm64": { name: "yt-dlp_macos", sha256: "0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa" },
  "darwin-x64": { name: "yt-dlp_macos", sha256: "0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa" },
  "linux-x64": { name: "yt-dlp_linux", sha256: "767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795" },
  "linux-arm64": {
    name: "yt-dlp_linux_aarch64",
    sha256: "e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483",
  },
  "win32-x64": { name: "yt-dlp.exe", sha256: "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d" },
};

const VIDEO_PARTITION = "openbot-video-reader";
const VIDEO_SCHEME = "openbot-video";
/** The whole call, which includes the first yt-dlp download and the first load of the speech model. */
const READ_TIMEOUT = "15 minutes";
const INFO_TIMEOUT_MS = 2 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 8 * 60_000;
const DECODE_TIMEOUT = "2 minutes";
const MAX_FILE_SIZE = "500M";
/** A frame larger than this costs the model more than it shows. */
const FRAME_LONG_SIDE = 768;
/** The highest picture that is worth the download: frames are smaller still. */
const MAX_HEIGHT = 720;
/** One transcription call per minute of sound gives a time for each part of the transcript. */
const TRANSCRIPT_PART_SECONDS = 60;
const MAX_TRANSCRIPT_SECONDS = 30 * 60;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_REASON_LENGTH = 300;
const SAMPLE_RATE = VOICE_AUDIO_LIMITS.sampleRate;

/**
 * The functions that the decode window runs. The page is OpenBot's own empty page, so the main world
 * holds nothing else. The sound is kept in the page and read back one part at a time.
 */
const DECODER_SCRIPT = `window.openbotVideo = {
  async frames(url, count, knownDuration, longSide) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("The video file did not load.");
    const source = URL.createObjectURL(await response.blob());
    try {
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error("OpenBot cannot decode the picture of this video."));
        video.src = source;
      });
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : knownDuration;
      const scale = Math.min(1, longSide / Math.max(video.videoWidth, video.videoHeight, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      const frames = [];
      const times = duration > 0 ? Array.from({ length: count }, (_, index) => (duration * (index + 0.5)) / count) : [0];
      for (const time of times) {
        if (Math.abs(video.currentTime - time) > 0.01) {
          await new Promise((resolve) => {
            video.onseeked = resolve;
            video.currentTime = time;
          });
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push({ seconds: Math.round(time * 10) / 10, imageUrl: canvas.toDataURL("image/jpeg", 0.8) });
      }
      return { duration: duration > 0 ? duration : null, frames };
    } finally {
      URL.revokeObjectURL(source);
    }
  },
  async sound(url, sampleRate, maxSeconds) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("The sound file did not load.");
    const data = await response.arrayBuffer();
    let buffer;
    try {
      buffer = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(data);
    } catch {
      return 0;
    }
    const length = Math.min(buffer.length, Math.floor(maxSeconds * sampleRate));
    const pcm = new Int16Array(length);
    const channels = buffer.numberOfChannels;
    const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
    for (let index = 0; index < length; index++) {
      let sample = 0;
      for (const channel of channelData) sample += channel[index];
      sample = Math.max(-1, Math.min(1, sample / channels));
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    this.pcm = pcm;
    return buffer.length;
  },
  part(start, length) {
    const end = Math.min(this.pcm.length, start + length);
    const bytes = new Uint8Array(this.pcm.buffer, start * 2, Math.max(0, end - start) * 2);
    let text = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    }
    return btoa(text);
  },
};
true`;

/** A WAV file of 16 kHz mono 16-bit sound: the input of the voice models. */
function wav(pcm: Uint8Array): Uint8Array {
  const file = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(file.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) file[offset + index] = text.charCodeAt(index);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  file.set(pcm, 44);
  return file;
}

function failure(reason: string) {
  return new VideoReadFailed({ reason: reason.slice(0, MAX_REASON_LENGTH) });
}

/** The last `ERROR:` line of yt-dlp, without the site and video id in front of it. */
function ytDlpReason(error: unknown): string {
  const stderr =
    typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr
      : "";
  const line = stderr
    .split(/\r?\n/u)
    .reverse()
    .find((entry) => entry.startsWith("ERROR:"));
  if (!line) return "OpenBot could not get the video from this link.";
  const message = line.replace(/^ERROR:\s*(\[[^\]]*\]\s*)?([^:\s]+:\s+)?/u, "").trim();
  return `OpenBot could not get the video: ${message}`;
}

/** yt-dlp's JSON. Each field is checked where it is read: a site can leave out or change any of them. */
const Info = Schema.Record(Schema.String, Schema.Unknown);
type Info = typeof Info.Type;
const decodeInfo = Schema.decodeUnknownOption(Schema.fromJsonString(Info));
const decodeFields = Schema.decodeUnknownOption(Info);

interface Format {
  id: string;
  hasVideo: boolean;
  hasAudio: boolean;
  height: number;
  streamed: boolean;
  /** HEVC, which Chromium decodes only with hardware or system support. */
  hevc: boolean;
  m4a: boolean;
  bitrate: number;
}

const PROTOCOLS = new Set(["https", "http", "m3u8_native", "m3u8"]);
const HEVC_CODEC = /^(?:hvc1|hev1|h265|hevc)/iu;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formats(info: Info): Format[] {
  if (!Array.isArray(info.formats)) return [];
  return info.formats.flatMap((entry: unknown): Format[] => {
    const decoded = decodeFields(entry);
    if (Option.isNone(decoded)) return [];
    const format = decoded.value;
    const id = text(format.format_id);
    const protocol = text(format.protocol) ?? "https";
    if (!id || !PROTOCOLS.has(protocol) || format.ext === "mhtml") return [];
    // yt-dlp writes "none" for a track that the format does not have; a missing codec is unknown.
    const hasVideo = format.vcodec !== "none";
    const hasAudio = format.acodec !== "none";
    if (!hasVideo && !hasAudio) return [];
    return [
      {
        id,
        hasVideo,
        hasAudio,
        height: count(format.height) ?? 0,
        streamed: protocol.startsWith("m3u8"),
        hevc: HEVC_CODEC.test(text(format.vcodec) ?? ""),
        m4a: format.ext === "m4a",
        bitrate: count(format.tbr) ?? count(format.abr) ?? 0,
      },
    ];
  });
}

/**
 * The highest picture up to 720 lines, or the smallest when every picture is larger. A direct file
 * wins, and then a codec that every Chromium build decodes.
 */
function bestPicture(candidates: Format[]): Format | undefined {
  const score = (format: Format) => (format.height <= MAX_HEIGHT ? format.height : -format.height);
  return candidates.toSorted(
    (a, b) =>
      Number(a.streamed) - Number(b.streamed) ||
      Number(a.hevc) - Number(b.hevc) ||
      score(b) - score(a) ||
      a.bitrate - b.bitrate,
  )[0];
}

/**
 * The formats to download, as yt-dlp ids. A format with both picture and sound comes first: two
 * separate files would need ffmpeg to join them, so OpenBot downloads them side by side instead.
 * An empty list lets yt-dlp choose, for a link that gives only one file.
 */
function chooseFormats(info: Info): { video: string | null; audio: string | null } {
  const available = formats(info);
  if (available.length === 0) return { video: null, audio: null };
  const both = bestPicture(available.filter((format) => format.hasVideo && format.hasAudio));
  if (both) return { video: both.id, audio: both.id };
  const picture = bestPicture(available.filter((format) => format.hasVideo));
  const sound = available
    .filter((format) => !format.hasVideo && format.hasAudio)
    .toSorted(
      (a, b) => Number(a.streamed) - Number(b.streamed) || Number(b.m4a) - Number(a.m4a) || b.bitrate - a.bitrate,
    )[0];
  return { video: picture?.id ?? null, audio: sound?.id ?? null };
}

function uploadDate(value: unknown): string | null {
  const date = text(value);
  return date && /^\d{8}$/u.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : date;
}

const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4a: "audio/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  weba: "audio/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
};

interface Media {
  video: string | null;
  audio: string | null;
}

/** What the decode window gives back. The window runs only OpenBot's script, on the downloaded file. */
const FramesResult = Schema.Struct({
  duration: Schema.NullOr(Schema.Number),
  frames: Schema.Array(Schema.Struct({ seconds: Schema.Number, imageUrl: Schema.String })),
});

interface VideoReaderOptions {
  /** `<userData>/runtimes/yt-dlp`: the managed yt-dlp, one folder for each release. */
  runtimeDirectory: string;
  target: RuntimeTarget | null;
  /** The user's selected voice model. It fails with a reason that the user can read. */
  transcribe: (wav: Uint8Array) => Effect.Effect<{ text: string }, { readonly cause: unknown }>;
}

export class VideoReader implements VideoReaderHost {
  readonly #options: VideoReaderOptions;
  /** One video at a time: each one is a download, a renderer process and the voice model. */
  readonly #lock = Semaphore.makeUnsafe(1);
  readonly #media = new Map<string, Media>();
  #session: Session | null = null;

  constructor(options: VideoReaderOptions) {
    this.#options = options;
  }

  readonly read = Effect.fn("VideoReader.read")(function* (
    this: VideoReader,
    request: VideoReadRequest,
  ): Effect.fn.Return<VideoReading, VideoReadFailed> {
    return yield* this.#lock.withPermit(
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => mkdtemp(join(tmpdir(), "openbot-video-")),
          catch: () => failure("OpenBot could not make a temporary folder for the video."),
        }),
        (directory) => this.#readInto(directory, request),
        (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true }).catch(() => undefined)),
      ).pipe(
        Effect.timeoutOrElse({
          duration: READ_TIMEOUT,
          orElse: () => Effect.fail(failure("The video took more than 15 minutes to read.")),
        }),
      ),
    );
  });

  readonly #readInto = Effect.fn("VideoReader.readInto")(function* (
    this: VideoReader,
    directory: string,
    request: VideoReadRequest,
  ): Effect.fn.Return<VideoReading, VideoReadFailed> {
    const executable = yield* this.#ytDlp();
    const env = yield* this.#environment();
    const run = (args: string[], timeout: number) =>
      Effect.tryPromise({
        try: (signal) =>
          execFileAsync(executable, ["--ignore-config", "--no-warnings", "--no-playlist", ...args], {
            signal,
            timeout,
            env,
            cwd: directory,
            maxBuffer: 64 * 1024 * 1024,
            windowsHide: true,
          }),
        catch: (error) => failure(ytDlpReason(error)),
      });
    const { stdout } = yield* run(["--dump-single-json", "--", request.url], INFO_TIMEOUT_MS);
    const decodedInfo = decodeInfo(stdout);
    if (Option.isNone(decodedInfo)) return yield* failure("OpenBot could not read the details of the video.");
    const info = decodedInfo.value;
    if (info._type === "playlist") return yield* failure("This link is a list of videos. Give the link of one video.");
    const infoPath = join(directory, "info.json");
    yield* Effect.tryPromise({
      try: () => writeFile(infoPath, stdout, { mode: 0o600 }),
      catch: () => failure("OpenBot could not save the details of the video."),
    });
    const chosen = chooseFormats(info);
    const ids = [...new Set([chosen.video, chosen.audio].filter((id) => id !== null))];
    yield* run(
      [
        "--load-info-json",
        infoPath,
        ...(ids.length > 0 ? ["--format", ids.join(",")] : []),
        "--output",
        join(directory, "media.%(format_id)s.%(ext)s"),
        "--no-progress",
        "--no-part",
        "--no-mtime",
        "--max-filesize",
        MAX_FILE_SIZE,
      ],
      DOWNLOAD_TIMEOUT_MS,
    );
    const files = yield* Effect.tryPromise({
      try: () => readdir(directory),
      catch: () => failure("OpenBot could not find the downloaded video."),
    });
    /** The file of a format id, or, when yt-dlp chose the format, its only file. */
    const fileOf = (prefix: string) => {
      const name = files.find((file) => file.startsWith(prefix));
      return name ? join(directory, name) : null;
    };
    const chosenFile = (id: string | null) => (id === null ? null : fileOf(`media.${id}.`));
    // A format with no sound has no sound file: the picture file is not decoded for sound.
    const media: Media =
      ids.length > 0
        ? { video: chosenFile(chosen.video), audio: chosenFile(chosen.audio) }
        : { video: fileOf("media."), audio: fileOf("media.") };
    if (!media.video && !media.audio)
      return yield* failure("The video is larger than 500 MB, or the site gave no file to download.");
    const decoded = yield* this.#decode(media, request.frames, count(info.duration));
    const description = text(info.description);
    return {
      title: text(info.title) ?? text(info.fulltitle),
      uploader: text(info.uploader) ?? text(info.channel) ?? text(info.uploader_id),
      pageUrl: text(info.webpage_url),
      durationSeconds: count(info.duration) ?? (decoded.duration === null ? null : Math.round(decoded.duration)),
      uploadDate: uploadDate(info.upload_date),
      viewCount: count(info.view_count),
      likeCount: count(info.like_count),
      commentCount: count(info.comment_count),
      description: description ? description.slice(0, MAX_DESCRIPTION_LENGTH) : null,
      transcript: decoded.transcript,
      transcriptNote: decoded.transcriptNote,
      frames: decoded.frames,
      framesNote: decoded.framesNote,
    };
  });

  /** The managed yt-dlp. The first call downloads it and checks its hash. */
  readonly #ytDlp = Effect.fn("VideoReader.ytDlp")(function* (this: VideoReader) {
    const { target, runtimeDirectory } = this.#options;
    if (!target) return yield* failure("OpenBot cannot read videos on this computer.");
    const release = YT_DLP_RELEASES[target];
    const folder = join(runtimeDirectory, YT_DLP_VERSION);
    const executable = join(folder, target === "win32-x64" ? "yt-dlp.exe" : "yt-dlp");
    const installed = yield* Effect.tryPromise(() => stat(executable)).pipe(
      Effect.map((entry) => entry.isFile()),
      Effect.orElseSucceed(() => false),
    );
    if (installed) return executable;
    logger.info(`Installing yt-dlp ${YT_DLP_VERSION} for video reading.`);
    const staging = join(folder, `.download-${randomBytes(8).toString("hex")}`);
    const unavailable = "OpenBot could not get its video tool. Check the internet connection and try again.";
    return yield* Effect.tryPromise({
      try: async (signal) => {
        await mkdir(folder, { recursive: true });
        try {
          const sha256 = await downloadArchive({
            url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/${release.name}`,
            archive: staging,
            failed: unavailable,
            signal,
            fetch: (url, init) => fetch(url, init),
          });
          if (sha256 !== release.sha256) throw new Error("The yt-dlp download does not match its pinned hash.");
          await chmod(staging, 0o755);
          await rename(staging, executable);
          return executable;
        } finally {
          await rm(staging, { force: true }).catch(() => undefined);
        }
      },
      catch: (error) => {
        logger.warn("yt-dlp install failed.", error instanceof Error ? error.message : "unknown");
        return failure(unavailable);
      },
    });
  });

  /** The login shell's `PATH`, so yt-dlp finds ffmpeg or a JavaScript runtime that the user installed. */
  readonly #environment = Effect.fn("VideoReader.environment")(function* () {
    const path = yield* agentLaunchPath();
    return { ...process.env, ...(path ? { PATH: path } : {}) };
  });

  #decoderSession(): Session {
    if (this.#session) return this.#session;
    const session = electronSession.fromPartition(VIDEO_PARTITION);
    session.protocol.handle(VIDEO_SCHEME, async (request) => {
      const url = new URL(request.url);
      const media = this.#media.get(url.hostname);
      const name = url.pathname.slice(1);
      if (!media) return new Response("Not found", { status: 404 });
      if (name === "page")
        return new Response("<!doctype html><meta charset=utf-8><title>Video</title>", {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      const path = name === "video" ? media.video : name === "audio" ? media.audio : null;
      if (!path) return new Response("Not found", { status: 404 });
      const extension = path.split(".").at(-1) ?? "";
      try {
        return await runCauseEffect(
          fileResponse(path, {
            "Content-Type": MEDIA_TYPES[extension] ?? "application/octet-stream",
            "Cache-Control": "no-store",
          }),
        );
      } catch {
        return new Response("Not found", { status: 404 });
      }
    });
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.on("will-download", (event) => event.preventDefault());
    this.#session = session;
    return session;
  }

  readonly #decode = Effect.fn("VideoReader.decode")(function* (
    this: VideoReader,
    media: Media,
    frameCount: number,
    knownDuration: number | null,
  ) {
    return yield* Effect.acquireUseRelease(
      Effect.try({
        try: () => {
          this.#decoderSession();
          const window = new BrowserWindow({
            show: false,
            width: 320,
            height: 240,
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              backgroundThrottling: false,
              partition: VIDEO_PARTITION,
            },
          });
          const token = randomUUID().replaceAll("-", "");
          this.#media.set(token, media);
          return { token, window };
        },
        catch: () => failure("OpenBot could not open a window to decode the video."),
      }),
      ({ token, window }) => this.#decodeIn(window, token, media, frameCount, knownDuration),
      ({ token, window }) =>
        Effect.sync(() => {
          this.#media.delete(token);
          if (!window.isDestroyed()) window.destroy();
        }),
    );
  });

  readonly #decodeIn = Effect.fn("VideoReader.decodeIn")(function* (
    this: VideoReader,
    window: BrowserWindow,
    token: string,
    media: Media,
    frameCount: number,
    knownDuration: number | null,
  ) {
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-redirect", (event) => event.preventDefault());
    const origin = `${VIDEO_SCHEME}://${token}`;
    const script = <A>(code: string, schema: Schema.Decoder<A>, reason: string) =>
      Effect.tryPromise({
        try: () => contents.executeJavaScript(code),
        catch: (error) => {
          logger.warn("Video decode step failed.", error instanceof Error ? error.message : "unknown");
          return failure(reason);
        },
      }).pipe(
        Effect.flatMap((value) => Schema.decodeUnknownEffect(schema)(value)),
        Effect.mapError((error) => (error instanceof VideoReadFailed ? error : failure(reason))),
        Effect.timeoutOrElse({ duration: DECODE_TIMEOUT, orElse: () => Effect.fail(failure(reason)) }),
      );
    yield* Effect.tryPromise({
      try: () => contents.loadURL(`${origin}/page`),
      catch: () => failure("OpenBot could not open its video decoder."),
    });
    yield* script(DECODER_SCRIPT, Schema.Literal(true), "OpenBot could not open its video decoder.");

    let duration = knownDuration;
    let frames: VideoReading["frames"] = [];
    let framesNote: string | null = null;
    // A picture that does not decode leaves the details and the transcript for the agent.
    if (media.video && frameCount > 0) {
      const result = yield* script(
        `openbotVideo.frames(${JSON.stringify(`${origin}/video`)}, ${frameCount}, ${knownDuration ?? 0}, ${FRAME_LONG_SIDE})`,
        FramesResult,
        "OpenBot cannot decode the picture of this video.",
      ).pipe(Effect.catchTag("VideoReadFailed", (error) => Effect.succeed(error)));
      if (result instanceof VideoReadFailed) framesNote = result.reason;
      else {
        frames = [...result.frames];
        duration ??= result.duration;
      }
    } else if (frameCount > 0) framesNote = "The video has no picture.";

    const transcript: VideoReading["transcript"] = [];
    let transcriptNote: string | null = null;
    if (!media.audio) {
      transcriptNote = "The video has no sound.";
    } else {
      const decoded = yield* script(
        `openbotVideo.sound(${JSON.stringify(`${origin}/audio`)}, ${SAMPLE_RATE}, ${MAX_TRANSCRIPT_SECONDS})`,
        Schema.Number,
        "OpenBot cannot decode the sound of this video.",
      ).pipe(Effect.catchTag("VideoReadFailed", (error) => Effect.succeed(error)));
      if (decoded instanceof VideoReadFailed) transcriptNote = decoded.reason;
      const samples = decoded instanceof VideoReadFailed ? 0 : decoded;
      if (samples === 0 && !transcriptNote) transcriptNote = "The video has no sound that OpenBot can decode.";
      duration ??= samples / SAMPLE_RATE;
      const heard = Math.min(samples, MAX_TRANSCRIPT_SECONDS * SAMPLE_RATE);
      const partLength = TRANSCRIPT_PART_SECONDS * SAMPLE_RATE;
      for (let start = 0; start < heard; start += partLength) {
        const encoded = yield* script(
          `openbotVideo.part(${start}, ${partLength})`,
          Schema.String,
          "OpenBot cannot decode the sound of this video.",
        ).pipe(Effect.catchTag("VideoReadFailed", (error) => Effect.succeed(error)));
        if (encoded instanceof VideoReadFailed) {
          transcriptNote = encoded.reason;
          break;
        }
        const heardPart = yield* this.#options.transcribe(wav(Buffer.from(encoded, "base64"))).pipe(
          Effect.map(({ text }) => ({ text: text.trim(), note: null })),
          Effect.catch((error) =>
            Effect.succeed({
              text: "",
              note: `The sound could not be transcribed: ${error.cause instanceof Error ? error.cause.message : "the voice model failed."}`,
            }),
          ),
        );
        if (heardPart.note) {
          transcriptNote = heardPart.note.slice(0, MAX_REASON_LENGTH);
          break;
        }
        if (heardPart.text) transcript.push({ seconds: start / SAMPLE_RATE, text: heardPart.text });
      }
      if (!transcriptNote && samples > heard)
        transcriptNote = `Only the first ${MAX_TRANSCRIPT_SECONDS / 60} minutes are transcribed.`;
      if (!transcriptNote && samples > 0 && transcript.length === 0)
        transcriptNote = "No speech was heard in the video.";
    }
    return { duration, frames, framesNote, transcript, transcriptNote };
  });
}
