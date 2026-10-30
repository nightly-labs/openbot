// What the browser does with a logo file: copy its SVG, draw it as PNG and save it, and put every file
// in one zip. The SVG text comes from `lib/brand-assets.ts`, so a copy and a download are the same file.

import { zipSync } from "fflate";
import {
  BRAND_ASSETS,
  BRAND_ICON,
  BRAND_LOCKUP,
  BRAND_ZIP_FILE,
  type BrandAsset,
  brandPngWidth,
} from "../../lib/brand-assets";

/** The file as a data URL: drawing it needs no request. */
function svgDataUrl(asset: BrandAsset): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svg)}`;
}

async function pngBlob(asset: BrandAsset): Promise<Blob | null> {
  const image = new Image();
  image.src = svgDataUrl(asset);
  await image.decode();
  const scale = brandPngWidth(asset) / asset.width;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(asset.width * scale);
  canvas.height = Math.round(asset.height * scale);
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** A browser can read the file after the click returns, so the URL stays valid for a while. */
const REVOKE_AFTER_MS = 60_000;

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

export function copyBrandSvg(asset: BrandAsset): Promise<void> {
  return navigator.clipboard.writeText(asset.svg);
}

/** The header logo menu copies these two. */
export const copyBrandIcon = () => copyBrandSvg(BRAND_ICON);
export const copyBrandLockup = () => copyBrandSvg(BRAND_LOCKUP);

export async function saveBrandPng(asset: BrandAsset): Promise<void> {
  const blob = await pngBlob(asset);
  if (blob) saveBlob(blob, `${asset.file}.png`);
}

/** Every file as SVG and as PNG, in one zip. */
export async function saveBrandZip(): Promise<void> {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  for (const asset of BRAND_ASSETS) {
    files[`openbot-brand/svg/${asset.file}.svg`] = encoder.encode(asset.svg);
    const png = await pngBlob(asset);
    if (png) files[`openbot-brand/png/${asset.file}.png`] = new Uint8Array(await png.arrayBuffer());
  }
  // `zipSync` types its buffer as ArrayBufferLike, and Blob takes only an ArrayBuffer, so copy it.
  saveBlob(new Blob([new Uint8Array(zipSync(files, { level: 6 }))], { type: "application/zip" }), BRAND_ZIP_FILE);
}
