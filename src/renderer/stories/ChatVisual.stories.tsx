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

/*
 * A visual reply: a page that an agent publishes above its reply, with its own scripts. The app
 * will serve the page from its own URL with a sandbox policy. Here the Storybook server does the
 * same (`.storybook/chat-visual-pages.ts`); a blob URL does not run scripts in a sandboxed frame
 * in every Chromium build.
 */

interface StageProps {
  html: string;
  title: string;
  height?: number | undefined;
  /** A page that the app is still getting, or that it cannot get. */
  state?: "loading" | "failed" | undefined;
  onOpenLink: (url: string) => void;
  onMessage?: ((text: string) => void) | undefined;
  onContext?: ((text: string) => void) | undefined;
}

/** The page from the Storybook server. A page that the server did not keep shows as failed. */
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

/** A chart that the page's own script draws as SVG with the theme's chart colours. */
export const InlineSvgChart: Story = {};

/** Chart.js from a CDN. It needs the network, as a visual reply can load such files. */
export const CdnChart: Story = {
  args: { html: CDN_CHART, title: "Tokens per week" },
};

/** Boxes that use the card, border, radius and accent variables. */
export const ComparisonMockup: Story = {
  args: { html: COMPARISON_MOCKUP, title: "Storage options" },
};

/** A click on a web link calls `onOpenLink`. The script link does nothing; the page link scrolls. */
export const LinkOut: Story = {
  args: { html: LINK_OUT, title: "Sources" },
};

/** The page is higher than the limit, so the frame stops at 2000 px and the page scrolls in it. */
export const TallPage: Story = {
  args: { html: TALL_PAGE, title: "Nightly runs" },
};

/** The agent asked for 320 px, so the frame stops there and the longer page scrolls in it. */
export const AgentHeightLimit: Story = {
  args: { html: TALL_PAGE, title: "Nightly runs", height: 320 },
};

/** Screenshots that the app put into the page as data URLs when the agent published it. */
export const ImageCollage: Story = {
  args: { html: IMAGE_COLLAGE, title: "Screenshots" },
};

/**
 * A page that answers the agent. A pick calls `onMessage`, and the count calls `onContext`. The
 * expand button or the page's own button shows it full screen, and the count stays. A click on the
 * chart image opens it in the image viewer.
 */
export const InteractiveChoice: Story = {
  args: { html: INTERACTIVE_CHOICE, title: "Pick a plan" },
};

/** While the app gets the page, the box keeps the agent's height and shows nothing. */
export const Loading: Story = {
  args: { html: COMPARISON_MOCKUP, title: "Storage options", height: 180, state: "loading" },
};

/** The app cannot get the page. The text takes the same box, so the messages below do not move. */
export const LoadFailed: Story = {
  args: { html: COMPARISON_MOCKUP, title: "Storage options", height: 180, state: "failed" },
};

/** Each page that the stories above show, except the loading and failed boxes. */
const VISUALS: { title: string; html: string; height?: number }[] = [
  { title: "Agent runs per day", html: INLINE_SVG_CHART },
  { title: "Tokens per week", html: CDN_CHART },
  { title: "Storage options", html: COMPARISON_MOCKUP },
  { title: "Screenshots", html: IMAGE_COLLAGE },
  { title: "Sources", html: LINK_OUT },
  { title: "Nightly runs", html: TALL_PAGE },
  { title: "Recent runs", html: TALL_PAGE, height: 320 },
];

/** The pages at the width of a phone, where the grids wrap to one column. */
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
