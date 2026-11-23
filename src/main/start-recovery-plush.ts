import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("start-recovery");
const CHARACTER = "cloe";

export function recoveryPlushSvg(): string | null {
  try {
    const assets = join(dirname(createRequire(import.meta.url).resolve("@norbert_bodziony/bloub/plush")), "assets");
    const body = webpDataUrl(join(assets, `${CHARACTER}-corps.webp`));
    const eye = webpDataUrl(join(assets, `${CHARACTER}-oeil0-x.webp`));
    return plushSvg(body, eye);
  } catch (error) {
    logger.warn("The recovery window shows no plush:", toLogValue(error));
    return null;
  }
}

function webpDataUrl(path: string): string {
  return `data:image/webp;base64,${readFileSync(path).toString("base64")}`;
}

function plushSvg(body: string, eye: string): string {
  const slice = (x: number, width: number, viewBox: string) =>
    `<svg preserveAspectRatio="none" x="${x}" y="-28.54" width="${width}" height="57.07" viewBox="${viewBox}" style="mix-blend-mode:plus-lighter"><use href="#plush-eye-texture"/></svg>`;
  const eyeSlices = [
    slice(-36.65, 32.15, "0 0 0.5 1"),
    slice(4.5, 32.15, "0.5 0 0.5 1"),
    slice(-4.5, 4.5, "0.5 0 0.07 1"),
    slice(0, 4.5, "0.43 0 0.07 1"),
  ].join("");
  return `<svg class="plush" viewBox="-110 -120 220 200" aria-hidden="true" focusable="false">
<defs>
<image id="plush-eye-texture" width="1" height="1" preserveAspectRatio="none" href="${eye}"/>
<g id="plush-eye" style="isolation:isolate">${eyeSlices}</g>
</defs>
<image x="-158" y="-158" width="316" height="316" href="${body}"/>
<g class="plush-eyes">
<use href="#plush-eye" transform="translate(2.46,-3.84) matrix(0.85,-0.4,0.45,0.89,-31.31,22.88)"/>
<use href="#plush-eye" transform="translate(-4.15,-3.95) matrix(0.81,0.39,-0.44,0.9,44.26,22.41)"/>
</g>
</svg>`;
}
