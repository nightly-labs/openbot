import type { AgentTemplatePreview } from "@openbot/contracts/ipc";
import { avatarHeadColor, createStaticAvatarSvg } from "@openbot/ui/bloub-avatar";
import { loadImage, loadSvg, withAlpha } from "../../avatar-canvas";

/** Slack takes a square app icon of 512 to 2000 px. */
const SIZE = 512;

/**
 * The agent's avatar as the icon of its Slack app: the uploaded image, cropped to fill the square,
 * or the generated Bloub on a soft tint of its own colour. Slack rounds the corners itself.
 */
export async function renderSlackIcon(
  agent: Pick<AgentTemplatePreview, "avatarSeed" | "avatarHue" | "avatarImage">,
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The Slack icon cannot be drawn.");
  if (agent.avatarImage) {
    const { bytes, mimeType } = agent.avatarImage;
    const image = await loadImage(new Blob([new Uint8Array(bytes)], { type: mimeType }));
    const scale = Math.max(SIZE / image.naturalWidth, SIZE / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (SIZE - width) / 2, (SIZE - height) / 2, width, height);
  } else {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, SIZE, SIZE);
    context.fillStyle = withAlpha(avatarHeadColor(agent.avatarSeed, agent.avatarHue), 0.3);
    context.fillRect(0, 0, SIZE, SIZE);
    // Larger than the square, as the app draws a Bloub larger than its avatar box.
    const size = SIZE * 1.05;
    const svg = createStaticAvatarSvg(agent.avatarSeed, agent.avatarHue);
    context.drawImage(await loadSvg(svg, size), (SIZE - size) / 2, (SIZE - size) / 2 - SIZE * 0.04, size, size);
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The Slack icon cannot be encoded.");
  return new Uint8Array(await blob.arrayBuffer());
}
