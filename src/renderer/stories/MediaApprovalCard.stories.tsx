import type { CreditMediaGenerationKind, CreditMediaModel } from "@openbot/contracts/credit-media";
import type { AgentApproval, MediaApprovalOffer } from "@openbot/contracts/ipc";
import { ApprovalCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import type { MediaApprovalControls } from "@openbot/ui/features/conversation/MediaApprovalCard";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const MODELS: CreditMediaModel[] = [
  {
    id: "chatgpt-image-2",
    kind: "image",
    name: "ChatGPT Image 2",
    maker: "OpenAI",
    variant: null,
    aspects: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "5:4", "4:5"],
    defaultAspect: "1:1",
    resolutions: ["1K", "2K", "4K"],
    defaultResolution: "1K",
    durations: [],
    defaultDuration: null,
    frames: 0,
    references: 8,
    audio: false,
    maxCount: 1,
    promptRequired: true,
    prices: [
      { resolution: "1K", unit: "item", credits: 7.1, silentCredits: null },
      { resolution: "2K", unit: "item", credits: 7.1, silentCredits: null },
      { resolution: "4K", unit: "item", credits: 7.1, silentCredits: null },
    ],
  },
  {
    id: "nano-banana-pro",
    kind: "image",
    name: "Nano Banana Pro",
    maker: "Google",
    variant: null,
    aspects: ["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"],
    defaultAspect: "auto",
    resolutions: ["1K", "2K", "4K"],
    defaultResolution: "1K",
    durations: [],
    defaultDuration: null,
    frames: 0,
    references: 8,
    audio: false,
    maxCount: 1,
    promptRequired: true,
    prices: [
      { resolution: "1K", unit: "item", credits: 4.5, silentCredits: null },
      { resolution: "2K", unit: "item", credits: 4.5, silentCredits: null },
      { resolution: "4K", unit: "item", credits: 8.1, silentCredits: null },
    ],
  },
  {
    id: "flux-kontext-max",
    kind: "image",
    name: "Flux Kontext Max",
    maker: "Black Forest Labs",
    variant: null,
    aspects: ["21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "9:21"],
    defaultAspect: "1:1",
    resolutions: [],
    defaultResolution: null,
    durations: [],
    defaultDuration: null,
    frames: 0,
    references: 0,
    audio: false,
    maxCount: 1,
    promptRequired: true,
    prices: [{ resolution: null, unit: "item", credits: 3, silentCredits: null }],
  },
  {
    id: "veo-3.1",
    kind: "video",
    name: "Veo 3.1",
    maker: "Google",
    variant: null,
    aspects: ["16:9", "9:16"],
    defaultAspect: "16:9",
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    durations: [4, 6, 8],
    defaultDuration: 8,
    frames: 0,
    references: 0,
    audio: true,
    maxCount: 1,
    promptRequired: true,
    prices: [
      { resolution: "1080p", unit: "second", credits: 26, silentCredits: 13 },
      { resolution: "720p", unit: "second", credits: 26, silentCredits: 13 },
    ],
  },
  {
    id: "seedance-2.5",
    kind: "video",
    name: "Seedance 2.5",
    maker: "ByteDance",
    variant: null,
    aspects: ["auto", "adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    defaultAspect: "9:16",
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    defaultDuration: 4,
    frames: 2,
    references: 8,
    audio: true,
    maxCount: 1,
    promptRequired: true,
    prices: [
      { resolution: "1080p", unit: "second", credits: 19.2, silentCredits: null },
      { resolution: "480p", unit: "second", credits: 3.5, silentCredits: null },
      { resolution: "720p", unit: "second", credits: 7.8, silentCredits: null },
    ],
  },
  {
    id: "kling-4.0",
    kind: "video",
    name: "Kling 4.0",
    maker: "Kling",
    variant: null,
    aspects: ["16:9", "9:16", "1:1", "21:9"],
    defaultAspect: "16:9",
    resolutions: ["720p", "1080p"],
    defaultResolution: "1080p",
    durations: [
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ],
    defaultDuration: 5,
    frames: 2,
    references: 0,
    audio: false,
    maxCount: 1,
    promptRequired: true,
    prices: [
      { resolution: "1080p", unit: "second", credits: 8, silentCredits: null },
      { resolution: "720p", unit: "second", credits: 5.3, silentCredits: null },
    ],
  },
];

const approval: AgentApproval = {
  requestId: "media-approval-story",
  agentId: "agent-story",
  threadId: "thread-story",
  turnId: "turn-story",
  kind: "permissions",
  command: null,
  cwd: null,
  reason: "Generate an image with ChatGPT Image 2. This uses 7.1 credits.",
  grantRoot: null,
  permissions: null,
};

function offer(kind: CreditMediaGenerationKind, fields: Partial<MediaApprovalOffer> = {}): MediaApprovalOffer {
  const models = MODELS.filter((model) => model.kind === kind);
  const first = models[0];
  if (!first) throw new Error(`No ${kind} story model.`);
  return {
    kind,
    prompt:
      kind === "image"
        ? "A red sailing boat on a calm sea at sunrise, soft light, film grain"
        : "Slow aerial shot over a coastal town at golden hour, waves on the rocks",
    agentModel: first.id,
    choice: {
      model: first.id,
      aspect: first.defaultAspect,
      resolution: first.defaultResolution,
      duration: first.defaultDuration,
      audio: first.audio,
    },
    defaultModel: null,
    canSetDefault: true,
    models,
    ...fields,
  };
}

function controls(media: MediaApprovalOffer | null): MediaApprovalControls {
  return {
    read: fn(async () => ({ media, hold: null })),
    allow: fn(async () => false),
    setDefault: fn(async () => undefined),
  };
}

const meta = {
  title: "Conversation/MediaApprovalCard",
  component: ApprovalCard,
  args: {
    approval,
    onApprove: fn(async () => false),
    onReject: fn(async () => false),
    media: controls(offer("image")),
  },
  decorators: [
    (Story) => (
      <main class="foundation-story">
        <Story />
      </main>
    ),
  ],
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof ApprovalCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Image: Story = {};
export const Video: Story = {
  args: {
    approval: { ...approval, reason: "Generate a video with Veo 3.1. This uses 208 credits." },
    media: controls(offer("video")),
  },
};
export const ServerDefault: Story = {
  args: { media: controls(offer("image", { defaultModel: "nano-banana-pro" })) },
};
export const MemberCannotSetDefault: Story = {
  args: { media: controls(offer("image", { canSetDefault: false })) },
};
export const OlderServer: Story = {
  args: { media: controls(null) },
};

function freeCreditsOffer(): MediaApprovalOffer {
  const models = MODELS.filter((model) => model.kind === "image").map((model) =>
    model.id === "nano-banana-pro" ? { ...model, welcome: true as const } : model,
  );
  const pick = models.find((model) => model.id === "nano-banana-pro");
  if (!pick) throw new Error("No free story model.");
  return offer("image", {
    agentModel: pick.id,
    choice: {
      model: pick.id,
      aspect: pick.defaultAspect,
      resolution: pick.defaultResolution,
      duration: null,
      audio: false,
    },
    models: [pick, ...models.filter((model) => model !== pick)],
    balance: { available: 10, welcome: 10 },
  });
}

export const FreeCreditsOnly: Story = {
  args: {
    approval: { ...approval, reason: "Generate an image with Nano Banana Pro. This uses 4.5 credits." },
    media: controls(freeCreditsOffer()),
  },
};
