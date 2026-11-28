import { tintRamp } from "@norbert_bodziony/bloub/plush";
import type { BloubAvatarProfile } from "@openbot/ui/bloub-avatar";
import planet from "./felt-card/planet.webp";

const BODIES = import.meta.glob<string>("./felt-card/felt/*.webp", { eager: true, query: "?url", import: "default" });
const EYES = import.meta.glob<string>("./felt-card/eyes/*.webp", { eager: true, query: "?url", import: "default" });

export interface FeltCardArt {
  planet: HTMLImageElement;
  body: HTMLCanvasElement;
  eyes: HTMLImageElement;
}

export async function loadFeltCardArt(profile: BloubAvatarProfile): Promise<FeltCardArt> {
  const bodyUrl = BODIES[`./felt-card/felt/${profile.shape}.webp`];
  const eyesUrl = EYES[`./felt-card/eyes/${profile.shape}-${profile.expression}.webp`];
  if (!bodyUrl || !eyesUrl) throw new Error(`The share card has no felt for ${profile.shape}.`);
  const [planetImage, grey, eyes] = await Promise.all([loadUrl(planet), loadUrl(bodyUrl), loadUrl(eyesUrl)]);
  return { planet: planetImage, body: tinted(grey, profile.color), eyes };
}

async function loadUrl(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function tinted(grey: HTMLImageElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = grey.naturalWidth;
  canvas.height = grey.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The share card cannot be drawn.");
  context.drawImage(grey, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const ramp = tintRamp(color);
  const data = pixels.data;
  for (let index = 0; index < data.length; index += 4) {
    const level = (data[index] ?? 0) * 3;
    data[index] = ramp[level] ?? 0;
    data[index + 1] = ramp[level + 1] ?? 0;
    data[index + 2] = ramp[level + 2] ?? 0;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}
