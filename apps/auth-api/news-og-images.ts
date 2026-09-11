// Bakes the news artwork during `vite build`.
//
// The card gradients come from a WebGL shader and a Cloudflare Worker has no
// WebGL, so the images cannot be made at request time. They are not committed
// either: they are derived from the article title, so committing them would add a
// second copy of something already in the repository, and one that can silently
// drift. Instead Electron — already a devDependency for the desktop app — renders
// them offscreen here, keyed by a content hash so an unchanged article is never
// rendered twice.

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Plugin } from "vite";
import { NEWS_ARTICLES } from "./src/lib/news";
import { newsGradient } from "./src/lib/news-gradient";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const appRoot = path.dirname(fileURLToPath(import.meta.url));

/** Change this when the drawing changes but the article does not, to void the cache. */
const GENERATOR_VERSION = 1;

/** The social card. Fixed by Open Graph, which crops anything else. */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
/** The card artwork on /news. The title sits over it as real text, not pixels.
    2:1 matches the grid card, the frame that shows the most of it. */
const CARD_WIDTH = 1200;
const CARD_HEIGHT = 600;

export interface NewsOgJob {
  /** Path inside the client bundle, for example `news/og/some-article.png`. */
  fileName: string;
  slug: string;
  title: string;
  width: number;
  height: number;
  /** Draw the title into the image. False for the card, which has live text over it. */
  withTitle: boolean;
}

export interface NewsOgImage {
  fileName: string;
  data: Uint8Array;
}

/**
 * `require` — the generator either renders every image or fails the build.
 * `skip` — emit nothing. Used by `api:build:check`, which installs without
 * scripts and so has no Electron binary.
 * Unset — try, and fall back to the CSS gradient with a warning. This is the
 * developer's build; CI always states which one it wants.
 */
type NewsOgMode = "require" | "skip" | "auto";

export function newsOgImages(): Plugin {
  return {
    name: "openbot-news-og-images",
    apply: "build",
    async generateBundle() {
      if (this.environment.name !== "client") return;

      const mode = readNewsOgMode(process.env.OPENBOT_NEWS_OG);
      if (mode === "skip") {
        this.info("OPENBOT_NEWS_OG=skip: news artwork was not rendered.");
        return;
      }

      try {
        for (const image of await renderNewsImages()) {
          this.emitFile({ type: "asset", fileName: image.fileName, source: image.data });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (mode === "require") {
          throw new Error(`News artwork could not be rendered: ${reason}`);
        }
        this.warn(
          `News artwork could not be rendered, so the cards fall back to their CSS gradient: ${reason}\nSet OPENBOT_NEWS_OG=require to make this fail the build.`,
        );
      }
    },
  };
}

export function readNewsOgMode(value: string | undefined): NewsOgMode {
  if (value === "require" || value === "skip") return value;
  if (value === undefined || value.trim() === "") return "auto";
  throw new Error(`OPENBOT_NEWS_OG must be "require" or "skip", not ${JSON.stringify(value)}.`);
}

export function newsOgJobs(): NewsOgJob[] {
  return NEWS_ARTICLES.flatMap((article) => [
    {
      fileName: `news/og/${article.slug}.png`,
      slug: article.slug,
      title: article.title,
      width: OG_WIDTH,
      height: OG_HEIGHT,
      withTitle: true,
    },
    {
      fileName: `news/card/${article.slug}.png`,
      slug: article.slug,
      title: article.title,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      withTitle: false,
    },
  ]);
}

/**
 * The cache key. It covers everything that can change the pixels: the gradient
 * itself, the size, the drawing code and the shader library version. A miss on
 * any of those renders again; a hit reuses bytes from a previous build.
 */
function jobCacheKey(job: NewsOgJob): string {
  const gradient = newsGradient(job.title);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        generator: GENERATOR_VERSION,
        shaders: shadersVersion(),
        job,
        gradient,
      }),
    )
    .digest("hex");
  return digest.slice(0, 32);
}

// Read from this app's manifest rather than the installed package, because the
// library does not export its own package.json. The version is pinned exactly
// there, so the two cannot disagree.
function shadersVersion(): string {
  const manifest: { dependencies?: Record<string, string> } = require("./package.json");
  return manifest.dependencies?.["@paper-design/shaders"] ?? "unknown";
}

export async function renderNewsImages(): Promise<NewsOgImage[]> {
  const jobs = newsOgJobs();
  if (jobs.length === 0) return [];

  const cacheDirectory = path.join(appRoot, "node_modules", ".cache", "openbot-news-og");
  await mkdir(cacheDirectory, { recursive: true });

  const cachePaths = new Map(jobs.map((job) => [job.fileName, path.join(cacheDirectory, `${jobCacheKey(job)}.png`)]));
  const images: NewsOgImage[] = [];
  const missing: NewsOgJob[] = [];

  for (const job of jobs) {
    const cachePath = cachePaths.get(job.fileName);
    const cached = cachePath ? await readIfPresent(cachePath) : undefined;
    if (cached) images.push({ fileName: job.fileName, data: cached });
    else missing.push(job);
  }

  if (missing.length === 0) return images;

  const rendered = await renderInElectron(missing);
  for (const image of rendered) {
    const cachePath = cachePaths.get(image.fileName);
    if (cachePath) await writeFile(cachePath, image.data);
    images.push(image);
  }

  return images;
}

async function readIfPresent(filePath: string): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await readFile(filePath));
  } catch {
    return undefined;
  }
}

async function renderInElectron(jobs: NewsOgJob[]): Promise<NewsOgImage[]> {
  const electronBinary = resolveElectronBinary();
  const workspace = await mkdtemp(path.join(tmpdir(), "openbot-news-og-"));

  try {
    const outputDirectory = path.join(workspace, "out");
    await mkdir(outputDirectory, { recursive: true });

    const control = {
      jobs,
      outputDirectory,
      // The window only has to be large enough to hold the biggest job, because
      // an element outside the viewport never gets a rendering tick.
      viewportWidth: Math.max(...jobs.map((job) => job.width)),
      viewportHeight: Math.max(...jobs.map((job) => job.height)),
      bundle: await bundlePageScript(workspace),
      fontScript: await buildFontScript(),
    };

    const controlPath = path.join(workspace, "control.json");
    await writeFile(controlPath, JSON.stringify(control));

    await runElectron(electronBinary, [path.join(appRoot, "news-og-electron.mjs"), controlPath]);

    return await Promise.all(
      jobs.map(async (job) => ({
        fileName: job.fileName,
        data: new Uint8Array(await readFile(path.join(outputDirectory, job.fileName))),
      })),
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function resolveElectronBinary(): string {
  try {
    // The electron package exports the path of its binary. It throws when the
    // install script did not run, which is exactly the case this must report.
    const resolved: string = require("electron");
    if (resolved.length > 0) return resolved;
    throw new Error("the electron package did not report a binary path");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Electron is not available (${reason}). Install without --ignore-scripts.`);
  }
}

/**
 * One classic script with the shader library inlined. A file:// page cannot load
 * ES modules, and injecting one self-contained script avoids needing a page that
 * can load anything at all.
 */
async function bundlePageScript(workspace: string): Promise<string> {
  const outFile = path.join(workspace, "page.js");
  await execFileAsync("bun", [
    "build",
    path.join(appRoot, "news-og-page.ts"),
    "--target=browser",
    "--format=iife",
    "--minify",
    `--outfile=${outFile}`,
  ]);
  return await readFile(outFile, "utf8");
}

/**
 * Inter is not installed on a build machine, so the baked title would fall back
 * to whatever the system has and the social cards would not match the site. The
 * font travels into the page as a data URL, since the page loads no files.
 */
async function buildFontScript(): Promise<string> {
  const fontPath = require.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");
  const font = await readFile(fontPath, "base64");
  return `(async () => {
    const face = new FontFace("Inter Variable", "url(data:font/woff2;base64,${font}) format('woff2')", { weight: "100 900" });
    await face.load();
    document.fonts.add(face);
  })()`;
}

/**
 * A machine with no window server never reaches `app.whenReady()`, and Electron
 * then waits without printing anything. Without this the whole build waits with
 * it, so a build agent burns its entire time budget on a step that will never
 * finish. Fail instead, and say what to do about it.
 */
const ELECTRON_TIMEOUT_MS = 120_000;

function runElectron(binary: string, args: string[]): Promise<void> {
  const { command, commandArgs } = withVirtualDisplay(binary, args);

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "inherit", "inherit"],
      env: electronEnvironment(),
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `Electron produced no images within ${ELECTRON_TIMEOUT_MS / 1000} seconds. It usually means the machine has no display; run the build where a window server or xvfb is available, or set OPENBOT_NEWS_OG=skip.`,
        ),
      );
    }, ELECTRON_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Electron exited with code ${code}.`));
    });
  });
}

/**
 * `ELECTRON_RUN_AS_NODE` is set by whatever spawned this build in some setups. If
 * it survives into the child, Electron starts as plain Node and fails the moment
 * it reaches BrowserWindow, with an error that says nothing about the cause.
 */
function electronEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

/** A Linux CI runner has no display server, and Chromium will not start without one. */
function withVirtualDisplay(binary: string, args: string[]): { command: string; commandArgs: string[] } {
  if (process.platform !== "linux" || process.env.DISPLAY) {
    return { command: binary, commandArgs: args };
  }
  return {
    command: "xvfb-run",
    commandArgs: ["--auto-servernum", "--server-args=-screen 0 1280x1024x24", binary, ...args],
  };
}
