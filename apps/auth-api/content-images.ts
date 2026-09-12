// The article artwork of every collection: which images there are, where they
// live, and the build step that ships them.
//
// The card gradients come from a WebGL shader. A Cloudflare Worker has no WebGL
// and a CI runner has no GPU, so neither can draw them. `bun run api:images`
// (render-content-images.ts) draws them on a developer's machine into
// `content-art/`, which is committed. The build copies that folder into the site
// and fails when it does not match the articles.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { Plugin } from "vite";
import { articleGradient } from "./src/lib/article-gradient";
import { CONTENT_COLLECTIONS } from "./src/lib/content";
import { articleArtPath, CONTENT_ART_SHAPES, type ContentCollection } from "./src/lib/content-collection";

const require = createRequire(import.meta.url);
const appRoot = path.dirname(fileURLToPath(import.meta.url));

/** The committed images, at the same paths they have in the site. */
export const CONTENT_ART_DIRECTORY = path.join(appRoot, "content-art");
/** File name to input hash, for every image in `CONTENT_ART_DIRECTORY`. Not shipped. */
export const CONTENT_ART_MANIFEST = path.join(CONTENT_ART_DIRECTORY, "manifest.json");

/** Change this when the drawing changes but the article does not, so every image is drawn again. */
const GENERATOR_VERSION = 1;

/** The social card. Fixed by Open Graph, which crops anything else. */
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
/** The card artwork on an index. The title sits over it as real text, not pixels.
    One size per frame, at that frame's own aspect ratio, so the image a reader
    sees before the shader starts is the frame the shader opens on. */
const CARD_SIZES = {
  featured: { width: 1216, height: 640 },
  card: { width: 1200, height: 600 },
  article: { width: 1260, height: 540 },
} as const;

export interface ContentImageJob {
  /** Path inside the client bundle, for example `news/og/some-article.png`. */
  fileName: string;
  slug: string;
  title: string;
  /** The kicker drawn above the title. Ignored unless `withTitle`. */
  eyebrow: string;
  width: number;
  height: number;
  /** Draw the title into the image. False for the card, which has live text over it. */
  withTitle: boolean;
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
      width: OG_WIDTH,
      height: OG_HEIGHT,
      withTitle: true,
    },
    ...CONTENT_ART_SHAPES.map((shape) => ({
      // The one path builder, so the file written here and the file the page
      // asks for cannot drift apart. It is a URL, and a bundle name is relative.
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

/**
 * The hash of everything that can change the pixels: the gradient itself, the
 * size, the drawing code and the shader library version. An image whose hash in
 * the manifest differs was drawn for an older version of its article.
 */
export function contentImageKey(job: ContentImageJob): string {
  const gradient = articleGradient(job.title);
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

/** Each way the committed artwork differs from the articles. Empty when it matches. */
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

/** Every image in `CONTENT_ART_DIRECTORY`, as a bundle path. */
export async function listContentArt(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(CONTENT_ART_DIRECTORY, { recursive: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.endsWith(".png")).map((entry) => entry.split(path.sep).join("/"));
}
