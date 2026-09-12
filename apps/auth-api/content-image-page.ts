// Runs inside a throwaway Electron page during `vite build`. Bundled to a single
// classic script by content-images.ts and injected with `executeJavaScript`, so
// it must not rely on module loading, the network, or anything on the page.
//
// Workers have no WebGL, so the card artwork cannot be produced at request time.
// This is the one place that turns the shared gradient description into pixels.

import { getShaderColorFromString, meshGradientFragmentShader, ShaderMount } from "@paper-design/shaders";
import type { ContentImageJob } from "./content-images";
import { articleGradient, articleGradientUniforms } from "./src/lib/article-gradient";

declare global {
  interface Window {
    openBotContentImage?: { render: (job: ContentImageJob) => Promise<string> };
  }
}

/** `--openbot-bg-canvas`, as the RGB channels of the scrim. */
const SCRIM_COLOR = "26, 26, 26";
const TITLE_MAX_LINES = 3;

window.openBotContentImage = { render: renderContentImage };

async function renderContentImage(job: ContentImageJob): Promise<string> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${job.width}px;height:${job.height}px;`;
  document.body.append(host);

  const gradient = articleGradient(job.title);
  const mount = new ShaderMount(
    host,
    meshGradientFragmentShader,
    articleGradientUniforms(gradient, getShaderColorFromString),
    // Without this the colour buffer is undefined by the time toDataURL reads it,
    // which shows up as an image that is empty on some machines and correct on
    // others.
    { preserveDrawingBuffer: true },
    0,
    gradient.frame,
  );

  try {
    // The mount sizes its canvas from a ResizeObserver callback, so nothing can
    // be read back until that callback has run at least once.
    await waitForCanvas(mount.canvasElement);
    // Draws synchronously at exactly this frame, which is what makes two runs of
    // the build produce the same bytes.
    mount.setFrame(gradient.frame);

    const canvas = document.createElement("canvas");
    canvas.width = job.width;
    canvas.height = job.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Paper shaders: a 2D canvas context is not available.");

    // The shader canvas is rendered at twice the output size, so this draw is a
    // supersample rather than a stretch.
    context.drawImage(mount.canvasElement, 0, 0, job.width, job.height);
    if (job.title && job.withTitle) drawTitle(context, job);

    return canvas.toDataURL("image/png");
  } finally {
    mount.dispose();
    host.remove();
  }
}

const CANVAS_TIMEOUT_MS = 10_000;

async function waitForCanvas(canvas: HTMLCanvasElement): Promise<void> {
  const deadline = Date.now() + CANVAS_TIMEOUT_MS;
  while (canvas.width === 0 || canvas.height === 0) {
    if (Date.now() > deadline) {
      throw new Error("Paper shaders: the canvas was never sized. The page produced no frames.");
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

function drawTitle(context: CanvasRenderingContext2D, job: ContentImageJob): void {
  const { width, height } = job;
  const padding = Math.round(width * 0.06);

  // A scrim only over the lower half. The gradient stays readable as artwork and
  // the text keeps its contrast whatever colours the title happened to draw.
  const scrim = context.createLinearGradient(0, height * 0.3, 0, height);
  scrim.addColorStop(0, `rgba(${SCRIM_COLOR}, 0)`);
  scrim.addColorStop(1, `rgba(${SCRIM_COLOR}, 0.88)`);
  context.fillStyle = scrim;
  context.fillRect(0, 0, width, height);

  const fontFamily = '"Inter Variable", Inter, system-ui, sans-serif';
  const titleSize = Math.round(width * 0.052);
  const lineHeight = Math.round(titleSize * 1.14);

  context.textBaseline = "alphabetic";
  context.font = `600 ${titleSize}px ${fontFamily}`;
  const lines = wrapText(context, job.title, width - padding * 2, TITLE_MAX_LINES);

  // The block is anchored to the bottom, so a one-line and a three-line title
  // both sit on the same baseline and the set reads as one series.
  const lastBaseline = height - padding;
  const firstBaseline = lastBaseline - (lines.length - 1) * lineHeight;

  context.fillStyle = "#ffffff";
  lines.forEach((line, index) => {
    context.fillText(line, padding, firstBaseline + index * lineHeight);
  });

  const eyebrowSize = Math.round(width * 0.017);
  context.font = `600 ${eyebrowSize}px ${fontFamily}`;
  context.fillStyle = "rgba(255, 255, 255, 0.62)";
  context.fillText(job.eyebrow, padding, firstBaseline - lineHeight);
}

/**
 * Greedy wrap. The last allowed line absorbs the rest of the words and is cut
 * with an ellipsis, so an unexpectedly long title degrades instead of running
 * off the bottom of the image.
 */
function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = candidate;
    }
  }

  const consumed = lines.join(" ");
  const remainder = consumed ? text.slice(consumed.length).trim() : text;
  lines.push(ellipsize(context, remainder, maxWidth));
  return lines;
}

function ellipsize(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}
