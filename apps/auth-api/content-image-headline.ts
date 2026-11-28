import { FONT_FAMILY } from "./content-image-marks";
import type { ContentImageJob } from "./content-images";
import type { ContentImageHeadline } from "./src/lib/content-collection";

const TEXT_LEFT = 64;
const TOPIC = { top: 48, size: 18, spacing: 1, colour: "rgb(194, 176, 204)" };
const LINES = [
  { top: 96, colour: "#ffffff" },
  { top: 172, colour: "rgb(212, 184, 237)" },
];
const TITLE = { size: 64, spacing: -1, width: 524 };
const INTER_ASCENT = 0.96875;

export async function drawIllustration(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  url: string,
): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
  context.drawImage(image, 0, 0, job.width, job.height);
}

export function drawHeadline(
  context: CanvasRenderingContext2D,
  job: ContentImageJob,
  { topic, lines }: ContentImageHeadline,
): void {
  const unit = job.width / 1200;
  context.save();
  context.textAlign = "start";
  context.textBaseline = "alphabetic";

  context.font = `700 ${TOPIC.size * unit}px ${FONT_FAMILY}`;
  context.letterSpacing = `${TOPIC.spacing * unit}px`;
  context.fillStyle = TOPIC.colour;
  context.fillText(topic, TEXT_LEFT * unit, baseline(TOPIC.top, TOPIC.size) * unit);

  context.font = `700 ${TITLE.size * unit}px ${FONT_FAMILY}`;
  context.letterSpacing = `${TITLE.spacing * unit}px`;
  lines.forEach((line, index) => {
    const slot = LINES[index];
    if (!slot) return;
    context.fillStyle = slot.colour;
    context.fillText(line, TEXT_LEFT * unit, baseline(slot.top, TITLE.size) * unit, TITLE.width * unit);
  });
  context.restore();
}

function baseline(top: number, size: number): number {
  return top + size * INTER_ASCENT;
}
