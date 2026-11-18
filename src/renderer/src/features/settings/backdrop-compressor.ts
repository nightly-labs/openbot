import { CUSTOM_BACKDROP_IMAGE_LIMIT, IMAGE_MIME_TYPES } from "../../custom-backdrops";

/**
 * Checks whether a selected file is an image based on its MIME type or file extension.
 */
export function isLikelyImageFile(file: File): boolean {
  const type = (file.type.split(";", 1)[0] ?? "").trim().toLowerCase();
  if (type.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|avif|gif|bmp|tiff|svg)$/i.test(file.name);
}

/**
 * Prepares an uploaded image file for the custom backdrop store.
 * If the image is already within the 20 MB limit and in a supported format (preserving GIFs),
 * it returns the raw file bytes directly.
 * If the image exceeds the size limit or has very large dimensions, it automatically decodes,
 * bounds the resolution to 4K (max 3840px), and compresses it into high-quality WebP so that
 * any size image can be set as a backdrop without failure.
 */
export async function prepareBackdropImage(file: File): Promise<{
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}> {
  const cleanType = (file.type.split(";", 1)[0] ?? "").trim().toLowerCase();

  // If already under the limit and supported, keep the original bytes intact (especially animated GIFs)
  if (file.size <= CUSTOM_BACKDROP_IMAGE_LIMIT && IMAGE_MIME_TYPES.has(cleanType)) {
    return {
      name: file.name,
      mimeType: cleanType,
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  }

  if (!isLikelyImageFile(file)) {
    throw new Error("UNSUPPORTED_TYPE");
  }

  // Decode the image
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    // Fallback decoding via HTMLImageElement
    bmp = await new Promise<ImageBitmap>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        createImageBitmap(img).then(resolve, reject);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("IMAGE_DECODE_FAILED"));
      };
      img.src = url;
    });
  }

  // Cap maximum dimension at 3840px (4K resolution is optimal for full-screen desktop backdrops)
  const MAX_DIMENSION = 3840;
  let targetWidth = bmp.width;
  let targetHeight = bmp.height;

  if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
    const scale = Math.min(MAX_DIMENSION / targetWidth, MAX_DIMENSION / targetHeight);
    targetWidth = Math.max(1, Math.round(targetWidth * scale));
    targetHeight = Math.max(1, Math.round(targetHeight * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    bmp.close();
    throw new Error("CANVAS_CONTEXT_FAILED");
  }

  ctx.drawImage(bmp, 0, 0, targetWidth, targetHeight);
  bmp.close();

  // Progressive compression targeting WebP
  let targetMime = "image/webp";
  let quality = 0.9;
  let blob: Blob | null = null;

  while (quality >= 0.35) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, targetMime, quality));
    if (blob && blob.size <= CUSTOM_BACKDROP_IMAGE_LIMIT) break;
    quality -= 0.15;
  }

  // Fallback to JPEG if WebP encoding wasn't accepted
  if (!blob) {
    targetMime = "image/jpeg";
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, targetMime, 0.85));
  }

  // If still over the limit (extremely dense image), downscale resolution until it fits
  if (blob && blob.size > CUSTOM_BACKDROP_IMAGE_LIMIT) {
    let curWidth = Math.round(targetWidth * 0.75);
    let curHeight = Math.round(targetHeight * 0.75);
    while (curWidth >= 640 && curHeight >= 360) {
      canvas.width = curWidth;
      canvas.height = curHeight;
      const subCtx = canvas.getContext("2d");
      if (subCtx) {
        subCtx.drawImage(canvas, 0, 0, curWidth, curHeight);
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, targetMime, 0.75));
        if (blob && blob.size <= CUSTOM_BACKDROP_IMAGE_LIMIT) break;
      }
      curWidth = Math.round(curWidth * 0.75);
      curHeight = Math.round(curHeight * 0.75);
    }
  }

  if (!blob || blob.size > CUSTOM_BACKDROP_IMAGE_LIMIT) {
    throw new Error("COMPRESSION_FAILED");
  }

  const baseName = file.name.replace(/\.[^/.]+$/, "");
  const extension = targetMime === "image/webp" ? "webp" : "jpg";
  return {
    name: `${baseName}.${extension}`,
    mimeType: targetMime,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
}
