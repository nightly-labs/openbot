// The Marketplace share cards: the 1200 × 630 PNG a shared `openbot.run/marketplace/...` link shows.
//
// The review scripts draw one when they approve a version, and `cards` draws the missing ones. The
// card has the agent's Bloub, which only a browser can draw, and Workers have no browser, so Electron
// draws it offscreen on the reviewer's computer, as `bun run api:images` draws the article artwork.
// The Worker only checks the PNG and stores it for the approved version.

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  decodeMarketplaceAgentDetail,
  decodeMarketplaceAgentPage,
  decodeMarketplaceSkillDetail,
  decodeMarketplaceSkillPage,
  isAgentTemplateCardPng,
  type MarketplaceAgentDetail,
  type MarketplaceSkillDetail,
} from "@openbot/contracts/ipc";
import type { MarketplaceCardJob } from "./marketplace-card-page";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));

/** How long to wait for the next line from Electron, not for the whole run. */
const ELECTRON_SILENCE_MS = 90_000;
/** The avatar and icon routes refuse larger uploads; this only stops a wrong response. */
const MAX_IMAGE_BYTES = 2_000_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
/** `MARKETPLACE_MAX_PAGE_SIZE` in the Worker. */
const PAGE_SIZE = 50;

export type MarketplaceCardKind = "agent" | "skill";

export interface MarketplaceAdminApi {
  apiUrl: string;
  token: string;
}

export interface DrawnCard {
  kind: MarketplaceCardKind;
  /** The agent id or the skill id. */
  listingId: string;
  versionId: string;
  name: string;
  png: Uint8Array;
}

/** The approved listings of one kind that have no card yet. */
export async function listingsWithoutCards(api: MarketplaceAdminApi, kind: MarketplaceCardKind): Promise<string[]> {
  const missing: string[] = [];
  let cursor: string | null = null;
  do {
    const url = new URL(kind === "agent" ? "/v1/marketplace/agents" : "/v1/skills", api.apiUrl);
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await getJson(url, (value) => catalogPage(kind, value));
    for (const id of page.ids) {
      const detail = await readDetail(api, kind, id);
      if (!detail.cardUrl) missing.push(id);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return missing;
}

/** Draws the cards of the approved versions of these listings, in one Electron run. */
export async function drawMarketplaceCards(
  api: MarketplaceAdminApi,
  kind: MarketplaceCardKind,
  listingIds: readonly string[],
): Promise<DrawnCard[]> {
  if (listingIds.length === 0) return [];
  const listings = [];
  for (const listingId of listingIds) {
    const detail = await readDetail(api, kind, listingId);
    listings.push({ detail, job: await cardJob(api, kind, detail) });
  }
  const images = await renderMarketplaceCards(listings.map((item) => item.job));
  return listings.map((item, index) => {
    const png = images[index];
    if (!png) throw new Error(`No card was drawn for ${item.detail.id}.`);
    return { kind, listingId: item.detail.id, versionId: item.detail.versionId, name: item.detail.name, png };
  });
}

/**
 * The Worker takes 5 card uploads a minute, agent and skill cards together, so `cards` for a whole
 * catalog meets its limit. The upload then waits the `Retry-After` time the Worker names and sends the
 * card again, a few times at most.
 */
const CARD_UPLOAD_ATTEMPTS = 4;

export async function uploadMarketplaceCard(api: MarketplaceAdminApi, card: DrawnCard): Promise<void> {
  const route = card.kind === "agent" ? "/v1/marketplace/agents/admin/cards/" : "/v1/skills/admin/cards/";
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(new URL(`${route}${encodeURIComponent(card.versionId)}`, api.apiUrl), {
      method: "PUT",
      headers: { Authorization: `Bearer ${api.token}`, "Content-Type": "image/png" },
      body: new Blob([new Uint8Array(card.png)], { type: "image/png" }),
    });
    if (response.ok) return;
    const waitSeconds = Number(response.headers.get("Retry-After"));
    if (response.status !== 429 || !(waitSeconds > 0) || attempt === CARD_UPLOAD_ATTEMPTS) {
      throw new Error(`The card upload for ${card.listingId} failed: ${await response.text()}`);
    }
    await response.body?.cancel();
    process.stdout.write(`The Worker limits card uploads. Sending ${card.name} again in ${waitSeconds} s.\n`);
    await sleep(waitSeconds * 1000);
  }
}

/** Draws, checks and uploads: the step the review scripts run after an approval. */
export async function publishMarketplaceCards(
  api: MarketplaceAdminApi,
  kind: MarketplaceCardKind,
  listingIds: readonly string[],
): Promise<DrawnCard[]> {
  const cards = await drawMarketplaceCards(api, kind, listingIds);
  for (const card of cards) await uploadMarketplaceCard(api, card);
  return cards;
}

/**
 * `card <id>...` and `cards` in the review scripts: draws the cards and uploads them, or writes them
 * to `outDirectory` and uploads nothing.
 */
export async function runCardCommand(
  api: MarketplaceAdminApi,
  kind: MarketplaceCardKind,
  listingIds: readonly string[],
  outDirectory?: string,
): Promise<void> {
  if (listingIds.length === 0) {
    process.stdout.write(`Every approved ${kind} has a card.\n`);
    return;
  }
  const cards = await drawMarketplaceCards(api, kind, listingIds);
  for (const card of cards) {
    if (outDirectory) {
      const filePath = path.resolve(outDirectory, `${kind}-${card.listingId}.png`);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, card.png);
      process.stdout.write(`Wrote the card of ${card.name} to ${filePath}.\n`);
    } else {
      await uploadMarketplaceCard(api, card);
      process.stdout.write(`Uploaded the card of ${card.name} (${card.versionId}).\n`);
    }
  }
}

/**
 * After an approval or a change of the verified state. The review already happened, so a card that
 * fails does not undo it: the listing shows the site's default image until `card <id>` runs.
 */
export async function refreshCardAfterReview(
  api: MarketplaceAdminApi,
  kind: MarketplaceCardKind,
  listingId: string,
): Promise<void> {
  try {
    await runCardCommand(api, kind, [listingId]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`The share card was not updated (${reason}). Run: card ${listingId}\n`);
    process.exitCode = 1;
  }
}

/** The value after `--out`, if the arguments have one. */
export function outDirectoryArgument(args: readonly string[]): string | undefined {
  const index = args.indexOf("--out");
  const value = index >= 0 ? args[index + 1] : undefined;
  if (index >= 0 && !value) throw new Error("--out needs a directory.");
  return value;
}

/** The card of each job as PNG bytes, in the order of the jobs. */
export async function renderMarketplaceCards(jobs: readonly MarketplaceCardJob[]): Promise<Uint8Array[]> {
  if (jobs.length === 0) return [];
  const workspace = await mkdtemp(path.join(tmpdir(), "openbot-marketplace-cards-"));
  try {
    const items = jobs.map((job, index) => ({ job, fileName: `card-${index}.png` }));
    const control = {
      items,
      outputDirectory: workspace,
      bundle: await bundlePageScript(workspace),
      fontScript: await buildFontScript(),
    };
    const controlPath = path.join(workspace, "control.json");
    await writeFile(controlPath, JSON.stringify(control));
    await runElectron(resolveElectronBinary(), [
      path.join(scriptsDirectory, "marketplace-card-electron.mjs"),
      controlPath,
    ]);
    const images: Uint8Array[] = [];
    for (const item of items) {
      const png = new Uint8Array(await readFile(path.join(workspace, item.fileName)));
      if (!isAgentTemplateCardPng(png)) throw new Error(`The card for "${item.job.name}" is not a 1200 × 630 PNG.`);
      images.push(png);
    }
    return images;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function catalogPage(kind: MarketplaceCardKind, value: unknown): { ids: string[]; nextCursor: string | null } {
  if (kind === "agent") {
    const page = decodeMarketplaceAgentPage(value);
    return { ids: page.agents.map((item) => item.id), nextCursor: page.nextCursor };
  }
  const page = decodeMarketplaceSkillPage(value);
  return { ids: page.skills.map((item) => item.id), nextCursor: page.nextCursor };
}

type ListingDetail = MarketplaceAgentDetail | MarketplaceSkillDetail;

async function readDetail(api: MarketplaceAdminApi, kind: MarketplaceCardKind, id: string): Promise<ListingDetail> {
  const route = kind === "agent" ? "/v1/marketplace/agents/" : "/v1/skills/";
  const url = new URL(`${route}${encodeURIComponent(id)}`, api.apiUrl);
  if (kind === "agent") return await getJson(url, decodeMarketplaceAgentDetail);
  return await getJson(url, decodeMarketplaceSkillDetail);
}

async function cardJob(
  api: MarketplaceAdminApi,
  kind: MarketplaceCardKind,
  detail: ListingDetail,
): Promise<MarketplaceCardJob> {
  const common = { name: detail.name, creatorName: detail.creatorName, verified: detail.verified === true };
  if (kind === "agent" && "avatarSeed" in detail) {
    return {
      ...common,
      kind,
      role: detail.title,
      avatarSeed: detail.avatarSeed,
      avatarHue: detail.avatarHue,
      image: detail.avatarUrl ? await imageDataUrl(new URL(detail.avatarUrl, api.apiUrl)) : null,
    };
  }
  if (kind === "skill" && "iconUrl" in detail) {
    return {
      ...common,
      kind,
      role: detail.description,
      avatarSeed: null,
      avatarHue: null,
      image: detail.iconUrl ? await imageDataUrl(new URL(detail.iconUrl, api.apiUrl)) : null,
    };
  }
  throw new Error(`The ${kind} ${detail.id} has no ${kind} detail.`);
}

/** The photo or icon as a `data:` URL: the card page loads nothing over the network. */
async function imageDataUrl(url: URL): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`The image ${url.pathname} could not be read (${response.status}).`);
  const type = response.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "";
  if (!IMAGE_TYPES.has(type)) throw new Error(`The image ${url.pathname} is not a PNG, JPEG or WebP image.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`The image ${url.pathname} is too large.`);
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function getJson<T>(url: URL, decode: (value: unknown) => T): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url.pathname} returned ${response.status}: ${await response.text()}`);
  return decode(await response.json());
}

function resolveElectronBinary(): string {
  try {
    // The electron package exports the path of its binary, and throws when its install script did not run.
    const resolved: string = require("electron");
    if (resolved.length > 0) return resolved;
    throw new Error("the electron package did not report a binary path");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Electron is not available (${reason}). Install without --ignore-scripts.`);
  }
}

/** One classic script: an `about:blank` page cannot load modules. */
async function bundlePageScript(workspace: string): Promise<string> {
  const outFile = path.join(workspace, "page.js");
  await execFileAsync("bun", [
    "build",
    path.join(scriptsDirectory, "marketplace-card-page.ts"),
    "--target=browser",
    "--format=iife",
    "--minify",
    `--outfile=${outFile}`,
  ]);
  return await readFile(outFile, "utf8");
}

/** Inter may not be installed, so the font travels into the page as a data URL. */
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
    // `ELECTRON_RUN_AS_NODE` from the parent would start Electron as plain Node, which fails at
    // BrowserWindow with an error that does not name the cause.
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "inherit"], env: environment });

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
        if (line.trim()) process.stdout.write(`${line.trim()}\n`);
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
