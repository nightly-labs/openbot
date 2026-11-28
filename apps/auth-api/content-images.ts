import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { Plugin } from "vite";
import type { RivalMarkName } from "./src/components/compare/rival-mark-shapes";
import { COMPARISONS } from "./src/content/compare";
import { articleGradient } from "./src/lib/article-gradient";
import { CONTENT_COLLECTIONS } from "./src/lib/content";
import {
  articleArtPath,
  CONTENT_ART_SHAPES,
  type ContentCollection,
  type ContentImageHeadline,
} from "./src/lib/content-collection";

const require = createRequire(import.meta.url);
const appRoot = path.dirname(fileURLToPath(import.meta.url));

export const CONTENT_ART_DIRECTORY = path.join(appRoot, "content-art");
export const CONTENT_BACKGROUND_DIRECTORY = path.join(appRoot, "content-backgrounds");
export const CONTENT_ART_MANIFEST = path.join(CONTENT_ART_DIRECTORY, "manifest.json");

const GENERATOR_VERSION = 1;

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const CARD_SIZES = {
  featured: { width: 1216, height: 640 },
  card: { width: 1200, height: 600 },
  article: { width: 1260, height: 540 },
} as const;

export interface ContentImageJob {
  fileName: string;
  slug: string;
  title: string;
  eyebrow: string;
  background?: string | undefined;
  layout?: "centered" | "headline" | undefined;
  headline?: ContentImageHeadline | undefined;
  width: number;
  height: number;
  withTitle: boolean;
  lockup?: ContentImageLockup | undefined;
  markRow?: readonly ContentImageMark[] | undefined;
}

export interface ContentImageRenderJob extends ContentImageJob {
  backgroundUrl?: string | undefined;
}

export type ContentImageMark = RivalMarkName | "openbot";

export interface ContentImageLockup {
  rivalMark: RivalMarkName;
  rivalName: string;
  left?: { mark: RivalMarkName; name: string } | undefined;
}

export type ContentArtManifest = Record<string, string>;

export function contentImages(): Plugin {
  return {
    name: "openbot-content-images",
    apply: "build",
    async generateBundle() {
      if (this.environment.name !== "client") return;

      const problems = await contentArtProblems();
      if (problems.length > 0) {
        throw new Error(
          `The committed article artwork does not match the articles:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\nRun \`bun run api:images\` and commit apps/auth-api/content-art.`,
        );
      }

      for (const job of contentImageJobs()) {
        const source = await readFile(path.join(CONTENT_ART_DIRECTORY, job.fileName));
        this.emitFile({ type: "asset", fileName: job.fileName, source });
      }
    },
  };
}

export function contentImageJobs(): ContentImageJob[] {
  return CONTENT_COLLECTIONS.flatMap(collectionJobs);
}

function collectionJobs(collection: ContentCollection): ContentImageJob[] {
  return collection.articles.flatMap((article) => [
    {
      fileName: `${collection.id}/og/${article.slug}.png`,
      slug: article.slug,
      title: article.title,
      eyebrow: collection.imageEyebrow,
      background: collection.imageBackgrounds && `${collection.id}/${article.slug}.jpg`,
      layout: collection.imageLayout,
      headline: article.imageHeadline,
      width: OG_WIDTH,
      height: OG_HEIGHT,
      withTitle: true,
      lockup: comparisonLockup(collection, article.slug),
      markRow: roundupMarkRow(collection, article.slug),
    },
    ...CONTENT_ART_SHAPES.map((shape) => ({
      fileName: articleArtPath(collection, article.slug, shape).slice(1),
      slug: article.slug,
      title: article.title,
      eyebrow: collection.imageEyebrow,
      width: CARD_SIZES[shape].width,
      height: CARD_SIZES[shape].height,
      withTitle: false,
    })),
  ]);
}

function comparisonLockup(collection: ContentCollection, slug: string): ContentImageLockup | undefined {
  const page = collection.id === "compare" ? COMPARISONS[slug] : undefined;
  switch (page?.kind) {
    case undefined:
    case "openbot":
      return page && { rivalMark: page.rival.mark, rivalName: page.rival.name };
    case "matchup": {
      const [a, b] = page.products;
      return { rivalMark: b.mark, rivalName: b.name, left: { mark: a.mark, name: a.name } };
    }
    case "roundup":
      return undefined;
  }
}

function roundupMarkRow(collection: ContentCollection, slug: string): ContentImageMark[] | undefined {
  const page = collection.id === "compare" ? COMPARISONS[slug] : undefined;
  return page?.kind === "roundup" ? page.apps.map((app) => app.mark) : undefined;
}

export function contentImageKey(job: ContentImageJob): string {
  const gradient = articleGradient(job.title);
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        generator: GENERATOR_VERSION,
        shaders: shadersVersion(),
        job,
        gradient,
        background: job.background && backgroundDigest(job.background),
      }),
    )
    .digest("hex");
  return digest.slice(0, 32);
}

function backgroundDigest(background: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(CONTENT_BACKGROUND_DIRECTORY, background)))
    .digest("hex");
}

function shadersVersion(): string {
  const manifest: { workspaces: { catalog: Record<string, string> } } = require("../../package.json");
  return manifest.workspaces.catalog["@paper-design/shaders"] ?? "unknown";
}

export async function contentArtProblems(): Promise<string[]> {
  const manifest = await readContentArtManifest();
  const jobs = contentImageJobs();
  const expected = new Set(jobs.map((job) => job.fileName));
  const present = new Set(await listContentArt());
  const problems: string[] = [];

  for (const job of jobs) {
    if (!present.has(job.fileName)) problems.push(`${job.fileName} is missing.`);
    else if (manifest[job.fileName] !== contentImageKey(job)) problems.push(`${job.fileName} is out of date.`);
  }
  for (const fileName of present) {
    if (!expected.has(fileName)) problems.push(`${fileName} belongs to no article.`);
  }
  return problems;
}

export async function readContentArtManifest(): Promise<ContentArtManifest> {
  let text: string;
  try {
    text = await readFile(CONTENT_ART_MANIFEST, "utf8");
  } catch {
    return {};
  }
  const value = JSON.parse(text);
  if (!isDynamicRecord(value)) throw new Error(`${CONTENT_ART_MANIFEST} must hold one object.`);
  const manifest: ContentArtManifest = {};
  for (const [fileName, key] of Object.entries(value)) {
    if (typeof key === "string") manifest[fileName] = key;
  }
  return manifest;
}

const CONTENT_ART_FILE = /\.(png|webp)$/;

export async function listContentArt(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(CONTENT_ART_DIRECTORY, { recursive: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => CONTENT_ART_FILE.test(entry)).map((entry) => entry.split(path.sep).join("/"));
}
