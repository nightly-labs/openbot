import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { Bubble, BubbleContent } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { ImageLightbox } from "@openbot/ui/features/conversation/ImageLightbox";
import { MessageBody } from "@openbot/ui/features/conversation/MessageRendering";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

/* Gradients of different sizes, so the justified rows have aspect ratios to balance. */
function sampleImage(id: string, width: number, height: number, hue: number): AttachmentSummary {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue} 70% 58%)'/><stop offset='1' stop-color='hsl(${hue + 50} 65% 32%)'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/></svg>`;
  return {
    id,
    name: `${id}.png`,
    size: 240_000,
    kind: "image",
    mimeType: "image/png",
    previewKind: "image",
    previewUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
  };
}

const IMAGES = [
  sampleImage("dashboard", 1600, 1000, 210),
  sampleImage("mobile-home", 780, 1688, 280),
  sampleImage("settings", 1280, 800, 20),
  sampleImage("chart", 1200, 1200, 140),
  sampleImage("panorama", 2400, 900, 330),
];

function GallerySurface(props: { images: AttachmentSummary[]; body?: string }) {
  const message = (): AgentMessage => ({
    id: `gallery-${props.images.length}`,
    author: "agent",
    body: props.body ?? "",
    time: "10:00",
    attachments: props.images,
  });
  return (
    <div class="message-entry message-entry-agent" style={{ width: "min(640px, 92vw)" }}>
      <Bubble align="start" variant={props.body ? "muted" : "ghost"} data-author="assistant">
        <BubbleContent>
          <MessageBody
            message={message()}
            agents={STORY_AGENTS}
            onSelectAgent={fn()}
            onOpenLink={fn()}
            onPreview={fn()}
            onAttachmentAction={fn()}
            onDownload={fn()}
          />
        </BubbleContent>
      </Bubble>
    </div>
  );
}

const meta = {
  title: "Conversation/ImageLightbox",
  component: GallerySurface,
  args: { images: IMAGES },
  parameters: { layout: "centered" },
} satisfies Meta<typeof GallerySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click an image to open the viewer. It zooms out of the tile and closes back into it. */
export const FiveImages: Story = {};

export const TwoImages: Story = { args: { images: IMAGES.slice(0, 2) } };

export const WithText: Story = {
  args: { images: IMAGES.slice(0, 4), body: "Here are the four screens after the change." },
};

/** The viewer open on the second image, without a thumbnail to zoom from. */
export const Viewer: Story = {
  render: (storyArgs) => (
    <ImageLightbox opening={{ images: storyArgs.images, index: 1 }} onDownload={fn()} onClose={fn()} />
  ),
};
