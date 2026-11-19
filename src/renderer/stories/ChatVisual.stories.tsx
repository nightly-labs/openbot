import { ChatVisual } from "@openbot/ui/features/conversation/ChatVisual";
import { createEffect, createSignal, For } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  CDN_CHART,
  COMPARISON_MOCKUP,
  IMAGE_COLLAGE,
  INLINE_SVG_CHART,
  INTERACTIVE_CHOICE,
  LINK_OUT,
  publishChatVisualPage,
  TALL_PAGE,
} from "./chat-visual-fixtures";

interface StageProps {
  html: string;
  title: string;
  height?: number | undefined;
  state?: "loading" | "failed" | undefined;
  onOpenLink: (url: string) => void;
  onMessage?: ((text: string) => void) | undefined;
  onContext?: ((text: string) => void) | undefined;
}

function VisualStage(props: StageProps) {
  const [src, setSrc] = createSignal<string>();
  const [unpublished, setUnpublished] = createSignal(false);
  createEffect(
    () => props.html,
    (html) => {
      let current = true;
      setSrc(undefined);
      setUnpublished(false);
      publishChatVisualPage(html).then(
        (url) => current && setSrc(url),
        () => current && setUnpublished(true),
      );
      return () => {
        current = false;
      };
    },
  );
  return (
    <ChatVisual
      src={props.state ? undefined : src()}
      failed={props.state === "failed" || unpublished()}
      title={props.title}
      height={props.height}
      onOpenLink={props.onOpenLink}
      onMessage={props.onMessage}
      onContext={props.onContext}
    />
  );
}

const meta = {
  title: "Conversation/ChatVisual",
  component: VisualStage,
  args: { html: INLINE_SVG_CHART, title: "Agent runs per day", onOpenLink: fn(), onMessage: fn(), onContext: fn() },
  argTypes: { html: { control: false } },
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <main style={{ width: "min(656px, 100vw)", padding: "var(--openbot-space-6)" }}>
      <VisualStage {...args} />
    </main>
  ),
} satisfies Meta<typeof VisualStage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InlineSvgChart: Story = {};

export const CdnChart: Story = {
  args: { html: CDN_CHART, title: "Tokens per week" },
};

export const ComparisonMockup: Story = {
  args: { html: COMPARISON_MOCKUP, title: "Storage options" },
};

export const LinkOut: Story = {
  args: { html: LINK_OUT, title: "Sources" },
};

export const TallPage: Story = {
  args: { html: TALL_PAGE, title: "Nightly runs" },
};

export const AgentHeightLimit: Story = {
  args: { html: TALL_PAGE, title: "Nightly runs", height: 320 },
};

export const ImageCollage: Story = {
  args: { html: IMAGE_COLLAGE, title: "Screenshots" },
};

export const InteractiveChoice: Story = {
  args: { html: INTERACTIVE_CHOICE, title: "Pick a plan" },
};

export const Loading: Story = {
  args: { html: COMPARISON_MOCKUP, title: "Storage options", height: 180, state: "loading" },
};

export const LoadFailed: Story = {
  args: { html: COMPARISON_MOCKUP, title: "Storage options", height: 180, state: "failed" },
};

const VISUALS: { title: string; html: string; height?: number }[] = [
  { title: "Agent runs per day", html: INLINE_SVG_CHART },
  { title: "Tokens per week", html: CDN_CHART },
  { title: "Storage options", html: COMPARISON_MOCKUP },
  { title: "Screenshots", html: IMAGE_COLLAGE },
  { title: "Sources", html: LINK_OUT },
  { title: "Nightly runs", html: TALL_PAGE },
  { title: "Recent runs", html: TALL_PAGE, height: 320 },
];

export const PhoneWidth: Story = {
  render: (args) => (
    <main
      style={{
        width: "360px",
        padding: "var(--openbot-space-4)",
        display: "grid",
        gap: "var(--openbot-space-6)",
      }}
    >
      <For each={VISUALS}>
        {(visual) => (
          <VisualStage html={visual.html} title={visual.title} height={visual.height} onOpenLink={args.onOpenLink} />
        )}
      </For>
    </main>
  ),
};
