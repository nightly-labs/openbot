import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  CONTENT_ART_DIRECTORY,
  CONTENT_ART_MANIFEST,
  type ContentArtManifest,
  type ContentImageJob,
  contentArtProblems,
  contentImageJobs,
  contentImageKey,
  listContentArt,
  readContentArtManifest,
} from "./content-images";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const appRoot = path.dirname(fileURLToPath(import.meta.url));

const ELECTRON_SILENCE_MS = 90_000;

const started = Date.now();
const jobs = contentImageJobs();
const previous = await readContentArtManifest();
const present = new Set(await listContentArt());
const stale = jobs.filter((job) => !present.has(job.fileName) || previous[job.fileName] !== contentImageKey(job));

if (stale.length > 0) {
  console.log(`content-images: drawing ${stale.length} of ${jobs.length} images.`);
  await renderInElectron(stale);
}

const expected = new Set(jobs.map((job) => job.fileName));
for (const fileName of present) {
  if (expected.has(fileName)) continue;
  await rm(path.join(CONTENT_ART_DIRECTORY, fileName));
  console.log(`content-images: deleted ${fileName}, which belongs to no article.`);
}

const manifest: ContentArtManifest = {};
for (const job of [...jobs].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
  manifest[job.fileName] = contentImageKey(job);
}
await mkdir(CONTENT_ART_DIRECTORY, { recursive: true });
await writeFile(CONTENT_ART_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

const problems = await contentArtProblems();
if (problems.length > 0) throw new Error(`The artwork still does not match:\n${problems.join("\n")}`);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`content-images: ${jobs.length} images match the articles (${stale.length} drawn) in ${seconds} s.`);

async function renderInElectron(jobs: ContentImageJob[]): Promise<void> {
  const electronBinary = resolveElectronBinary();
  const workspace = await mkdtemp(path.join(tmpdir(), "openbot-content-images-"));

  try {
    const control = {
      jobs,
      outputDirectory: CONTENT_ART_DIRECTORY,
      viewportWidth: Math.max(...jobs.map((job) => job.width)),
      viewportHeight: Math.max(...jobs.map((job) => job.height)),
      bundle: await bundlePageScript(workspace),
      fontScript: await buildFontScript(),
    };

    const controlPath = path.join(workspace, "control.json");
    await writeFile(controlPath, JSON.stringify(control));

    await runElectron(electronBinary, [path.join(appRoot, "content-image-electron.mjs"), controlPath]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function resolveElectronBinary(): string {
  try {
    const resolved: string = require("electron");
    if (resolved.length > 0) return resolved;
    throw new Error("the electron package did not report a binary path");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Electron is not available (${reason}). Install without --ignore-scripts.`);
  }
}

async function bundlePageScript(workspace: string): Promise<string> {
  const outFile = path.join(workspace, "page.js");
  await execFileAsync("bun", [
    "build",
    path.join(appRoot, "content-image-page.ts"),
    "--target=browser",
    "--format=iife",
    "--minify",
    `--outfile=${outFile}`,
  ]);
  return await readFile(outFile, "utf8");
}

async function buildFontScript(): Promise<string> {
  const fontPath = require.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");
  const font = await readFile(fontPath, "base64");
  return `(async () => {
    const face = new FontFace("Inter Variable", "url(data:font/woff2;base64,${font}) format('woff2')", { weight: "100 900" });
    await face.load();
    document.fonts.add(face);
  })()`;
}

function runElectron(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "pipe", "inherit"],
      env: electronEnvironment(),
    });

    let timer: NodeJS.Timeout;
    const waitForProgress = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Electron drew nothing for ${ELECTRON_SILENCE_MS / 1000} seconds.`));
      }, ELECTRON_SILENCE_MS);
    };
    waitForProgress();

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      waitForProgress();
      for (const line of chunk.split("\n")) {
        if (line.trim()) console.log(line.trim());
      }
    });

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

function electronEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}
