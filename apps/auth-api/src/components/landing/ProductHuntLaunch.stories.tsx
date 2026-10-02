import { createUniqueId } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
// The site's stylesheet, imported here rather than in .storybook/preview.tsx for the reason
// ArticleMedia.stories.tsx gives: it carries global rules that would restyle all of Storybook.
import "../../styles.css";
import "./ProductHuntLaunch.stories.css";
import { ProductHuntLaunchPanel, type ProductHuntLaunchVariant } from "./ProductHuntLaunch";

const meta = {
  title: "Site/Product Hunt launch",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The panel the way a visitor meets it: over the page, on the dialog's backdrop. It is an open
 * dialog rather than a modal one, so the docs page can show every variant at once.
 */
function LaunchStage(props: { variant: ProductHuntLaunchVariant }) {
  const titleId = createUniqueId();
  return (
    <div class="ph-story-stage">
      <div class="ph-story-page" aria-hidden="true">
        <span class="ph-story-headline">Meet OpenBot</span>
      </div>
      <dialog open class="ph-dialog ph-story-dialog" aria-labelledby={titleId}>
        <ProductHuntLaunchPanel variant={props.variant} titleId={titleId} onDismiss={() => {}} />
      </dialog>
    </div>
  );
}

/** The live design: OpenBot beside an upvote tile, with confetti rising behind them. */
export const LaunchPad: Story = { render: () => <LaunchStage variant="launch-pad" /> };

/** A torn launch-day ticket that admits one upvote. */
export const Ticket: Story = { render: () => <LaunchStage variant="ticket" /> };

/** The agents ask themselves, one message at a time, the way they talk in the app. */
export const TeamChat: Story = { render: () => <LaunchStage variant="team-chat" /> };

/** One large upvote button that keeps pressing itself. */
export const BigArrow: Story = { render: () => <LaunchStage variant="big-arrow" /> };

/** The launch as a command that ran, waiting on its last step. */
export const Terminal: Story = { render: () => <LaunchStage variant="terminal" /> };
