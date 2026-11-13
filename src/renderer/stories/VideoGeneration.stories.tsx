import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { VideoGeneration, type VideoGenerationProps } from "@openbot/ui/features/conversation/VideoGeneration";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const generatedClip = new URL("../../../packages/ui/src/assets/plush/fishing.webm", import.meta.url).href;

const generatedAttachment: AttachmentSummary = {
  id: "generated-video-1",
  name: "generated-video.webm",
  size: 1_482_752,
  kind: "file",
  mimeType: "video/webm",
  previewKind: "none",
  previewUrl: generatedClip,
};

const baseArgs: VideoGenerationProps = {
  status: "generating",
  prompt: "A plush toy fishing from a small wooden pier at sunset",
  aspectRatio: "landscape",
  durationSeconds: 6,
  resolution: "720p",
  onOpen: fn(),
  onDownload: fn(),
};

const meta = {
  title: "Conversation/VideoGeneration",
  component: VideoGeneration,
  args: baseArgs,
  parameters: { layout: "centered" },
  render: (storyArgs) => (
    <div style={{ width: "min(480px, 92vw)" }}>
      <VideoGeneration {...storyArgs} />
    </div>
  ),
} satisfies Meta<typeof VideoGeneration>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Generating: Story = {};

export const GeneratingPortrait: Story = {
  args: { aspectRatio: "portrait" },
};

export const Completed: Story = {
  args: { status: "completed", attachment: generatedAttachment },
};

export const Failed: Story = {
  args: { status: "failed", error: "Video generation is not available on this plan." },
};

export const Interrupted: Story = {
  args: { status: "interrupted" },
};

export const LongPrompt: Story = {
  args: {
    prompt:
      "A slow cinematic dolly shot of a plush toy fishing from a small wooden pier at sunset, warm rim light on the fabric, gentle ripples on the lake, mist over distant pine trees, shallow depth of field, no text",
  },
};
